"""Ingest steps 1-2 and the account map. Owner: A.

The CSV is read exactly as delivered: every field as text, nothing cleaned, every data record kept,
even when a value is malformed (derive.py parses values safely and flags failures). Columns are
matched by name, case-insensitively; extra columns are ignored and recorded.
txn_idx = 0-based data-record number in the file (verified against the file itself).
"""
from itertools import islice
from pathlib import Path

import duckdb

from abhedya.ingest.records import field, iter_records

REQUIRED_COLUMNS = ("Transaction_ID", "Sender_Account", "Receiver_Account", "Sender_IFSC", "Receiver_IFSC",
                    "Amount", "Timestamp", "Payment_Mode", "Narration", "IP_Address", "Device_Type")


class IngestError(ValueError):
    """The input file cannot be read as a transaction export (message is shown to the user)."""


def _sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def _ident(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def _reader(csv_path: Path) -> str:
    return (f"read_csv({_sql_str(str(csv_path))}, header = true, delim = ',', quote = '\"', escape = '\"', "
            "all_varchar = true, null_padding = true, strict_mode = false, store_rejects = true)")


def load_raw(con: duckdb.DuckDBPyConnection, csv_path: Path) -> dict:
    """Create txn_raw (the 11 required columns, as text, in file order). Returns counts and extra columns."""
    if csv_path.stat().st_size == 0:
        raise IngestError(f"{csv_path.name} is empty: no header row.")
    con.execute("SET preserve_insertion_order = true")
    try:
        found = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {_reader(csv_path)}").fetchall()]
    except duckdb.Error as e:
        raise IngestError(f"{csv_path.name} could not be read as CSV: {str(e).splitlines()[0]}") from e
    by_name = {c.strip().lstrip("﻿").lower(): c for c in found}
    missing = [c for c in REQUIRED_COLUMNS if c.lower() not in by_name]
    if missing:
        raise IngestError(f"{csv_path.name} is missing required column(s): {', '.join(missing)}. "
                          f"Columns found: {', '.join(found)}")
    extra = [c for c in found if c.strip().lstrip("﻿").lower() not in {r.lower() for r in REQUIRED_COLUMNS}]
    cols = ", ".join(f"{_ident(by_name[c.lower()])} AS {c}" for c in REQUIRED_COLUMNS)
    con.execute(f"CREATE OR REPLACE TABLE txn_raw AS SELECT {cols} FROM {_reader(csv_path)}")
    rows = con.execute("SELECT count(*) FROM txn_raw").fetchone()[0]
    rejects = con.execute("SELECT count(*) FROM reject_errors").fetchone()[0]
    return {"rows": rows, "rejects": rejects, "extra_columns": extra,
            "id_index": found.index(by_name["transaction_id"])}


def verify_row_order(con: duckdb.DuckDBPyConnection, csv_path: Path, id_index: int = 0, n_head: int = 1000) -> None:
    """Assert txn_raw.rowid == data-record number by comparing Transaction_IDs with the raw file
    for the first n_head records and the last record."""
    rows = con.execute("SELECT count(*) FROM txn_raw").fetchone()[0]
    if rows == 0:
        return
    head = [field(r, id_index) for r in islice(iter_records(csv_path), n_head)]
    got = [r[0] or "" for r in con.execute(
        "SELECT Transaction_ID FROM txn_raw WHERE rowid < ? ORDER BY rowid", [len(head)]).fetchall()]
    if got != head:
        raise RuntimeError("txn_raw row order does not match the CSV (head check failed)")
    last_got = con.execute("SELECT Transaction_ID FROM txn_raw ORDER BY rowid DESC LIMIT 1").fetchone()[0] or ""
    with open(csv_path, "rb") as f:   # fast path: the last physical line
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 65536))
        tail = [ln for ln in f.read().splitlines() if ln.strip()]
    if tail and field(tail[-1], id_index) == last_got:
        return
    last = None                        # slow path (e.g. a multi-line last record): walk all records
    for last in iter_records(csv_path):
        pass
    if last is None or field(last, id_index) != last_got:
        raise RuntimeError("txn_raw row order does not match the CSV (tail check failed)")


def build_account_map(con: duckdb.DuckDBPyConnection) -> int:
    """Dense int32 ids, ordered by account string (so a sorted array supports prefix search)."""
    con.execute(
        """CREATE OR REPLACE TABLE acct_map AS
           SELECT (row_number() OVER (ORDER BY account) - 1)::INTEGER AS acct_id, account, ifsc, n_ifsc
           FROM (SELECT account, min(ifsc) AS ifsc, count(DISTINCT ifsc) AS n_ifsc
                 FROM (SELECT Sender_Account AS account, Sender_IFSC AS ifsc FROM txn_raw
                       UNION ALL
                       SELECT Receiver_Account, Receiver_IFSC FROM txn_raw)
                 WHERE account IS NOT NULL
                 GROUP BY account)"""
    )
    return con.execute("SELECT count(*) FROM acct_map").fetchone()[0]
