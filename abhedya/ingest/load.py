"""Ingest steps 1-2 and the account map. Owner: A.

The CSV is read exactly as delivered: typed columns, no cleaning, every row kept.
txn_idx = 0-based data-row number in the file (verified against the file itself).
"""
from pathlib import Path

import duckdb

RAW_COLUMNS = {
    "Transaction_ID": "VARCHAR",
    "Sender_Account": "VARCHAR",
    "Receiver_Account": "VARCHAR",
    "Sender_IFSC": "VARCHAR",
    "Receiver_IFSC": "VARCHAR",
    "Amount": "DECIMAL(18,2)",
    "Timestamp": "TIMESTAMP",
    "Payment_Mode": "VARCHAR",
    "Narration": "VARCHAR",
    "IP_Address": "VARCHAR",
    "Device_Type": "VARCHAR",
}


def _sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def load_raw(con: duckdb.DuckDBPyConnection, csv_path: Path) -> dict:
    """Create txn_raw from the CSV (insertion order preserved). Returns row and reject counts."""
    cols = "{" + ", ".join(f"{_sql_str(k)}: {_sql_str(v)}" for k, v in RAW_COLUMNS.items()) + "}"
    con.execute("SET preserve_insertion_order = true")
    con.execute(
        f"""CREATE OR REPLACE TABLE txn_raw AS
            SELECT * FROM read_csv({_sql_str(str(csv_path))}, header = true, store_rejects = true,
                                   timestampformat = '%Y-%m-%d %H:%M:%S', columns = {cols})"""
    )
    rows = con.execute("SELECT count(*) FROM txn_raw").fetchone()[0]
    rejects = con.execute("SELECT count(*) FROM reject_errors").fetchone()[0]
    return {"rows": rows, "rejects": rejects}


def verify_row_order(con: duckdb.DuckDBPyConnection, csv_path: Path, n_head: int = 1000) -> None:
    """Assert txn_raw.rowid == data-row number by comparing Transaction_IDs with the raw file
    for the first n_head rows and the last row."""
    with open(csv_path, "rb") as f:
        f.readline()  # header
        head = [f.readline().split(b",", 1)[0].decode() for _ in range(n_head)]
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 4096))
        tail_lines = [ln for ln in f.read().splitlines() if ln.strip()]
    last_id = tail_lines[-1].split(b",", 1)[0].decode()
    head = [h for h in head if h]
    got = [r[0] for r in con.execute(
        "SELECT Transaction_ID FROM txn_raw WHERE rowid < ? ORDER BY rowid", [len(head)]).fetchall()]
    if got != head:
        raise RuntimeError("txn_raw row order does not match the CSV (head check failed)")
    last_got = con.execute("SELECT Transaction_ID FROM txn_raw ORDER BY rowid DESC LIMIT 1").fetchone()[0]
    if last_got != last_id:
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
