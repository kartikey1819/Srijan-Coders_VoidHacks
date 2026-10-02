import duckdb
import pytest

from tests.conftest import FULL_DB, SAMPLE


def test_sample_counts(sample_con):
    assert sample_con.execute("SELECT count(*) FROM txn").fetchone()[0] == 50_000
    n_acct = sample_con.execute("SELECT count(*) FROM account").fetchone()[0]
    distinct = sample_con.execute(
        "SELECT count(*) FROM (SELECT sender FROM txn UNION SELECT receiver FROM txn)").fetchone()[0]
    assert n_acct == distinct


def test_txn_idx_is_file_row_number(sample_con):
    with open(SAMPLE, encoding="utf-8") as f:
        f.readline()
        lines = [f.readline().rstrip("\n").split(",") for _ in range(200)]
    got = sample_con.execute(
        "SELECT txn_idx, transaction_id, sender, amount_paise FROM txn WHERE txn_idx < 200 ORDER BY txn_idx"
    ).fetchall()
    for (_, tid, snd, paise), ln in zip(got, lines, strict=True):
        assert tid == ln[0] and snd == ln[1]
        assert paise == round(float(ln[5]) * 100)


def test_raw_values_kept_and_derived(sample_con):
    r = sample_con.execute(
        """SELECT narration, narr_base, narr_category, ip, ip_class, device, device_class
           FROM txn WHERE transaction_id = 'TXN515751130'""").fetchone()
    assert r == ("UPI/WALLET_LOAD/P2P_CRYPTO_2360", "UPI/WALLET_LOAD/P2P_CRYPTO", "crypto",
                 "194.159.153.195", "foreign_proxy", "Linux_Script", "script")
    assert sample_con.execute("SELECT count(*) FROM txn WHERE narr_category = 'other'").fetchone()[0] == 0


def test_no_row_dropped_and_ids_are_strings(sample_con):
    assert sample_con.execute("SELECT count(*) FROM txn WHERE src_id IS NULL OR dst_id IS NULL").fetchone()[0] == 0
    types = dict(sample_con.execute(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'txn'").fetchall())
    assert types["sender"] == "VARCHAR" and types["sender_ifsc"] == "VARCHAR" and types["amount_paise"] == "BIGINT"


@pytest.mark.skipif(not FULL_DB.exists(), reason="full dataset not ingested on this machine")
def test_full_dataset_facts():
    con = duckdb.connect(str(FULL_DB), read_only=True)
    assert con.execute("SELECT count(*) FROM txn").fetchone()[0] == 2_000_000
    assert con.execute("SELECT count(*) FROM account").fetchone()[0] == 24_873
    dq = dict(con.execute("SELECT flag, rows FROM dq_summary").fetchall())
    assert dq["DUP_TXN_ID"] == 4_502
    assert dq["RTGS_BELOW_MIN"] == 59_747
    assert dq["UPI_ABOVE_P2P_LIMIT"] == 355
    assert all(dq[f] == 0 for f in ("BAD_ACCT_ID", "BAD_IFSC", "IMPS_ABOVE_LIMIT", "SELF_LOOP",
                                     "TS_OUT_OF_RANGE", "UNKNOWN_MODE", "NONPOSITIVE_AMOUNT"))
    assert float(dict(con.execute("SELECT key, value FROM meta").fetchall())["ingest_total_s"]) < 60
    con.close()
