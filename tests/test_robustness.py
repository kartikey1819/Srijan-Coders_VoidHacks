"""Broken, unusual and hostile input files: every row is kept, problems are flagged, errors are clear."""
import hashlib
import io
import zipfile

import duckdb
import pytest

from abhedya.engine import Engine
from abhedya.ingest.load import IngestError
from abhedya.ingest.pipeline import run_ingest
from tests.conftest import HEADER, SAMPLE, row


def ingest(tmp_path, text: str | bytes, name="x", detect=True):
    p = tmp_path / f"{name}.csv"
    p.write_bytes(text.encode("utf-8") if isinstance(text, str) else text)
    info = run_ingest(p, tmp_path / f"{name}.duckdb", run_detect=detect)
    return info, Engine(tmp_path / f"{name}.duckdb"), p


def txn_rows(e: Engine):
    return e.cursor().execute(
        "SELECT txn_idx, transaction_id, amount_paise, usable, dq_flags FROM txn ORDER BY 1").fetchall()


GOOD = row(1, "SBIN10000001", "HDFC10000002", "1000.00", "2026-09-20 10:00:00")
NEXT = row(2, "HDFC10000002", "ICIC10000003", "980.00", "2026-09-20 10:05:00")


def test_malformed_values_are_kept_and_flagged(tmp_path):
    text = "\n".join([HEADER, GOOD,
                      row(3, "SBIN10000001", "HDFC10000002", "abc", "2026-09-20 10:01:00"),
                      row(4, "SBIN10000001", "HDFC10000002", "5.00", "2026-02-30 25:61:00"),
                      "TXN5,SBIN10000001,HDFC10000002",                     # short row
                      row(6, "SBIN10000001", "HDFC10000002", "-5.00", "2026-09-20 10:02:00"),
                      row(7, "SBIN10000001", "SBIN10000001", "5.00", "2026-09-20 10:02:00"),
                      row(8, "SBIN10000001", "HDFC10000002", "1.005", "2026-09-20 10:02:00"),
                      NEXT]) + "\n"
    info, e, _ = ingest(tmp_path, text)
    rows = txn_rows(e)
    assert info["rows"] == 8 and [r[0] for r in rows] == list(range(8))
    flags = {r[1]: r[4] for r in rows}
    assert "BAD_AMOUNT" in flags["TXN000000003"] and "BAD_TIMESTAMP" in flags["TXN000000004"]
    assert "MISSING_FIELD" in flags["TXN5"] and "NONPOSITIVE_AMOUNT" in flags["TXN000000006"]
    assert "SELF_LOOP" in flags["TXN000000007"] and "AMOUNT_PRECISION" in flags["TXN000000008"]
    assert [r[1] for r in rows if r[3]] == ["TXN000000001", "TXN000000008", "TXN000000002"]   # only these move money
    assert {x.txn_idx for x in e.trace("SBIN10000001").edges} >= {0, 7}


def test_header_only_and_empty_file(tmp_path):
    info, e, _ = ingest(tmp_path, HEADER + "\n", "h")
    assert info["rows"] == 0 and e.dq_summary().rows == 0 and e.search("S") == []
    with pytest.raises(IngestError, match="empty"):
        ingest(tmp_path, b"", "z")


def test_missing_column_is_named(tmp_path):
    with pytest.raises(IngestError, match="Device_Type"):
        ingest(tmp_path, HEADER.replace(",Device_Type", "") + "\n" + GOOD.rsplit(",", 1)[0] + "\n")


def test_reordered_extra_columns_bom_crlf_lowercase(tmp_path):
    cols = HEADER.split(",")
    order = [10, 3, 0, 7, 1, 2, 9, 4, 5, 6, 8]
    head = "﻿" + "Extra," + ",".join(cols[i].lower() for i in order)
    body = ["junk," + ",".join(r.split(",")[i] for i in order) for r in (GOOD, NEXT)]
    info, e, _ = ingest(tmp_path, "\r\n".join([head, *body]) + "\r\n")
    assert info["rows"] == 2 and info["extra_columns_ignored"] == ["Extra"]
    assert [r[1] for r in txn_rows(e)] == ["TXN000000001", "TXN000000002"]
    assert [x.txn_idx for x in e.trace("SBIN10000001").edges] == [0, 1]


def test_quoted_commas_newlines_and_blank_lines_keep_row_numbers(tmp_path):
    tricky = ('"TXN,9",SBIN10000001,HDFC10000002,SBIN0000001,HDFC0000002,500.00,2026-09-20 10:03:00,UPI,'
              '"line one\nline two, with comma",103.1.1.1,Android')
    text = "\n".join([HEADER, GOOD, "", tricky, "", NEXT]) + "\n"
    info, e, p = ingest(tmp_path, text)
    assert [r[1] for r in txn_rows(e)] == ["TXN000000001", "TXN,9", "TXN000000002"]
    z = zipfile.ZipFile(io.BytesIO(e.ring_export("HDFC10000002")))
    exported = z.read("transactions.csv").decode()
    for rec in (GOOD, NEXT):        # whatever the ring holds is byte-identical to the file's records
        if rec.split(",")[0] in exported:
            assert rec in exported


def test_duplicate_rows_and_ids_are_all_kept(tmp_path):
    info, e, _ = ingest(tmp_path, "\n".join([HEADER, GOOD, GOOD, GOOD, NEXT]) + "\n")
    rows = txn_rows(e)
    assert info["rows"] == 4 and sum("DUP_TXN_ID" in r[4] for r in rows) == 3


def test_hostile_text_is_stored_raw_and_never_executed(tmp_path):
    evil = row(3, "SBIN10000001", "HDFC10000002", "10.00", "2026-09-20 10:09:00",
               "<script>alert(1)</script>'; DROP TABLE txn; --", "UPI\"; DELETE")
    info, e, _ = ingest(tmp_path, "\n".join([HEADER, GOOD, evil, NEXT]) + "\n")
    t = e.account_txns("SBIN10000001")
    assert any("<script>" in x.narration for x in t)            # kept as evidence, verbatim
    assert e.cursor().execute("SELECT count(*) FROM txn").fetchone()[0] == 3


def test_source_file_is_never_modified(tmp_path):
    before = hashlib.sha256(SAMPLE.read_bytes()).hexdigest()
    info = run_ingest(SAMPLE, tmp_path / "s.duckdb", run_detect=True)
    assert info["input_sha256"] == before == hashlib.sha256(SAMPLE.read_bytes()).hexdigest()
    con = duckdb.connect(str(tmp_path / "s.duckdb"), read_only=True)
    assert con.execute("SELECT count(*) FROM txn").fetchone()[0] == 50_000
