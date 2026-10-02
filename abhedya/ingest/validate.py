"""Data-quality flags (DATA_HANDLING.md section 2). Owner: A.

Flags are attached to rows; no row is ever edited or dropped. Flags never feed the risk score.
The expressions below are evaluated inside derive.py's single CREATE TABLE txn statement,
over a subquery that exposes the raw columns plus amount_paise and dup_count.
"""
import duckdb

from abhedya import config

# flag name -> SQL condition over the raw text columns plus the safely parsed values from derive.py
# (amount_paise, ts_parsed, dup_count). A missing value raises its own flag, never an unrelated one.
DQ_RULES: dict[str, str] = {
    "MISSING_FIELD": "Transaction_ID IS NULL OR Sender_Account IS NULL OR Receiver_Account IS NULL "
                     "OR Amount IS NULL OR Timestamp IS NULL",
    "BAD_AMOUNT": "Amount IS NOT NULL AND amount_paise IS NULL",
    "AMOUNT_PRECISION": r"regexp_matches(trim(Amount), '\.[0-9]{3,}$')",
    "BAD_TIMESTAMP": "Timestamp IS NOT NULL AND ts_parsed IS NULL",
    "BAD_ACCT_ID": f"NOT regexp_full_match(Sender_Account, '{config.ACCT_RE}') "
                   f"OR NOT regexp_full_match(Receiver_Account, '{config.ACCT_RE}')",
    "BAD_IFSC": f"NOT regexp_full_match(Sender_IFSC, '{config.IFSC_RE}') "
                f"OR NOT regexp_full_match(Receiver_IFSC, '{config.IFSC_RE}') "
                "OR substr(Sender_IFSC, 1, 4) <> substr(Sender_Account, 1, 4) "
                "OR substr(Receiver_IFSC, 1, 4) <> substr(Receiver_Account, 1, 4)",
    "DUP_TXN_ID": "dup_count > 1",
    "RTGS_BELOW_MIN": f"Payment_Mode = 'RTGS' AND amount_paise < {config.RTGS_MIN_PAISE}",
    "UPI_ABOVE_P2P_LIMIT": f"Payment_Mode = 'UPI' AND amount_paise > {config.UPI_P2P_LIMIT_PAISE}",
    "IMPS_ABOVE_LIMIT": f"Payment_Mode = 'IMPS' AND amount_paise > {config.IMPS_LIMIT_PAISE}",
    "UNKNOWN_MODE": "coalesce(Payment_Mode, '') NOT IN (" + ", ".join(f"'{m}'" for m in config.MODES) + ")",
    "NONPOSITIVE_AMOUNT": "amount_paise <= 0",
    "TS_OUT_OF_RANGE": f"ts_parsed < TIMESTAMP '{config.DATASET_WINDOW[0]}' "
                       f"OR ts_parsed >= TIMESTAMP '{config.DATASET_WINDOW[1]}'",
    "SELF_LOOP": "Sender_Account = Receiver_Account",
}


def dq_flags_sql() -> str:
    items = ", ".join(f"CASE WHEN coalesce({cond}, false) THEN '{name}' END" for name, cond in DQ_RULES.items())
    return f"list_filter([{items}], lambda x: x IS NOT NULL)"


def write_dq_summary(con: duckdb.DuckDBPyConnection) -> dict[str, int]:
    names = ", ".join(f"('{n}')" for n in DQ_RULES)
    con.execute(
        f"""CREATE OR REPLACE TABLE dq_summary AS
            SELECT f.flag, coalesce(c.n, 0)::BIGINT AS rows
            FROM (VALUES {names}) f(flag)
            LEFT JOIN (SELECT flag, count(*) AS n FROM (SELECT unnest(dq_flags) AS flag FROM txn) GROUP BY flag) c
              ON c.flag = f.flag
            ORDER BY f.flag"""
    )
    return dict(con.execute("SELECT flag, rows FROM dq_summary").fetchall())
