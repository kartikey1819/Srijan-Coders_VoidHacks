"""flagged.csv / ranked.csv exports. Owner: B."""
import csv
import io
from pathlib import Path

import duckdb

from abhedya.audit import log as audit

COLUMNS = ("account", "ifsc", "bank_name", "score", "band", "role_hint", "reasons",
           "n_in", "n_out", "sum_in_paise", "sum_out_paise")


def csv_bytes(con: duckdb.DuckDBPyConnection, flagged_only: bool) -> bytes:
    where = "WHERE r.band = 'HIGH'" if flagged_only else ""
    rows = con.execute(
        f"""SELECT r.account, a.ifsc, a.bank_name, r.score, r.band, coalesce(r.role_hint, ''),
                   array_to_string(r.reasons, ';'), a.n_in, a.n_out, a.sum_in_paise, a.sum_out_paise
            FROM risk r JOIN account a USING (acct_id) {where}
            ORDER BY r.score DESC, r.account"""
    ).fetchall()
    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLUMNS)
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def write_exports(con: duckdb.DuckDBPyConnection, out_dir: Path) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, flagged in (("flagged.csv", True), ("ranked.csv", False)):
        data = csv_bytes(con, flagged)
        (out_dir / name).write_bytes(data)
        hashes[name] = audit.sha256_bytes(data)
        audit.log("export", {"file": name}, hashes[name])
    return hashes
