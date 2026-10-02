"""Ingest steps 3-5: derived columns, data-quality flags, dense ids, account table. Owner: A.

Raw values are kept next to every derived value (DATA_HANDLING.md section 3).
"""
import duckdb

from abhedya import config
from abhedya.docs.banks import BANKS
from abhedya.ingest.validate import dq_flags_sql


def _narr_category_sql(col: str) -> str:
    whens = " ".join(f"WHEN regexp_matches({col}, '{pat}') THEN '{cat}'" for cat, pat in config.NARR_RULES)
    return f"CASE {whens} ELSE 'other' END"


def bank_name_sql(col: str) -> str:
    whens = " ".join(f"WHEN '{p}' THEN '{n}'" for p, n in BANKS.items())
    return f"CASE {col} {whens} ELSE 'Unknown bank (' || {col} || ')' END"


def build_txn(con: duckdb.DuckDBPyConnection) -> None:
    octets = ", ".join(str(o) for o in config.FOREIGN_PROXY_OCTETS)
    scripts = ", ".join(f"'{d}'" for d in config.SCRIPT_DEVICES)
    con.execute(
        f"""CREATE OR REPLACE TABLE txn AS
        WITH p AS (   -- every value arrives as text; parse safely, never drop the row
            SELECT rowid::INTEGER AS txn_idx, *,
                   TRY_CAST(replace(trim(Amount), ',', '') AS DECIMAL(18,2)) AS amount_dec,
                   coalesce(TRY_STRPTIME(trim(Timestamp), '%Y-%m-%d %H:%M:%S'),
                            TRY_CAST(trim(Timestamp) AS TIMESTAMP)) AS ts_parsed
            FROM txn_raw
        ), r AS (
            SELECT *,
                   (amount_dec * 100)::BIGINT AS amount_paise,
                   count(*) OVER (PARTITION BY Transaction_ID) AS dup_count,
                   upper(Narration) AS narr_upper,
                   TRY_CAST(split_part(IP_Address, '.', 1) AS SMALLINT) AS ip_octet1
            FROM p
        )
        SELECT r.txn_idx,
               r.Transaction_ID AS transaction_id,
               r.Sender_Account AS sender, r.Receiver_Account AS receiver,
               r.Sender_IFSC AS sender_ifsc, r.Receiver_IFSC AS receiver_ifsc,
               r.amount_paise,
               r.Amount AS amount_raw,
               r.ts_parsed AS ts,
               r.Timestamp AS ts_raw,
               epoch(r.ts_parsed)::BIGINT AS ts_epoch,
               r.Payment_Mode AS mode,
               r.Narration AS narration,
               regexp_replace(r.Narration, '[#_]?[0-9]+$', '') AS narr_base,
               {_narr_category_sql('r.narr_upper')} AS narr_category,
               coalesce(regexp_matches(r.narr_upper, '{config.INSTRUCTION_LIKE_RE}'), false) AS narr_instruction_like,
               r.IP_Address AS ip,
               r.ip_octet1,
               CASE WHEN NOT coalesce(regexp_full_match(r.IP_Address, '[0-9]{{1,3}}(\\.[0-9]{{1,3}}){{3}}'), false)
                         THEN 'invalid'
                    WHEN r.ip_octet1 IN ({octets}) THEN 'foreign_proxy'
                    ELSE 'domestic' END AS ip_class,
               r.Device_Type AS device,
               CASE WHEN r.Device_Type IN ({scripts}) THEN 'script' ELSE 'human' END AS device_class,
               {dq_flags_sql()} AS dq_flags,
               s.acct_id AS src_id,
               d.acct_id AS dst_id,
               -- a row moves money in the graph only if it can: positive amount, valid time, two distinct accounts
               (coalesce(r.amount_paise, 0) > 0 AND r.ts_parsed IS NOT NULL AND s.acct_id IS NOT NULL
                AND d.acct_id IS NOT NULL AND s.acct_id <> d.acct_id) AS usable
        FROM r
        LEFT JOIN acct_map s ON s.account = r.Sender_Account     -- LEFT: a row is never dropped
        LEFT JOIN acct_map d ON d.account = r.Receiver_Account
        ORDER BY r.txn_idx"""
    )


def build_account(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(
        f"""CREATE OR REPLACE TABLE account AS
        SELECT m.acct_id, m.account, m.ifsc, m.n_ifsc,
               substr(m.account, 1, 4) AS bank_prefix,
               {bank_name_sql('substr(m.account, 1, 4)')} AS bank_name,
               coalesce(i.n_in, 0)::BIGINT AS n_in, coalesce(o.n_out, 0)::BIGINT AS n_out,
               coalesce(i.sum_in, 0)::BIGINT AS sum_in_paise, coalesce(o.sum_out, 0)::BIGINT AS sum_out_paise,
               least(coalesce(i.first_in, o.first_out), coalesce(o.first_out, i.first_in)) AS first_ts,
               greatest(coalesce(i.last_in, o.last_out), coalesce(o.last_out, i.last_in)) AS last_ts
        FROM acct_map m
        LEFT JOIN (SELECT dst_id, count(*) AS n_in, sum(amount_paise) AS sum_in,
                          min(ts) AS first_in, max(ts) AS last_in
                   FROM txn GROUP BY dst_id) i ON i.dst_id = m.acct_id
        LEFT JOIN (SELECT src_id, count(*) AS n_out, sum(amount_paise) AS sum_out,
                          min(ts) AS first_out, max(ts) AS last_out
                   FROM txn GROUP BY src_id) o ON o.src_id = m.acct_id
        ORDER BY m.acct_id"""
    )
