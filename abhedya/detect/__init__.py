"""Mule detection: features -> 0-100 risk score with reason codes (plan/00_OVERVIEW.md section 3). Owner: B."""
import time

import duckdb

from abhedya.detect import features as _features
from abhedya.detect import risk as _risk
from abhedya.detect.params import DetectParams
from abhedya.detect.reasons import REASON_LABELS
from contracts.models import RiskRow, VictimCandidate

__all__ = ["run", "get_risk_many", "top", "flagged_accounts", "candidate_victims", "REASON_LABELS", "DetectParams"]


def run(con: duckdb.DuckDBPyConnection, params: DetectParams | None = None) -> dict:
    """Compute features and risk for every account; writes tables `features` and `risk`."""
    p = params or DetectParams()
    t0 = time.perf_counter()
    f, e = _features.compute(con, p)
    t1 = time.perf_counter()
    r = _risk.score(f, e, p)
    _risk.write_tables(con, f, r, p)
    t2 = time.perf_counter()
    bands = {b: int((r["band"] == b).sum()) for b in ("HIGH", "MEDIUM", "LOW")}
    return {"accounts": len(r["score"]), "bands": bands, "params_hash": p.hash(),
            "timings_s": {"features": round(t1 - t0, 3), "risk": round(t2 - t1, 3)}}


def _row(r) -> RiskRow:
    return RiskRow(account=r[0], score=r[1], band=r[2], role_hint=r[3], reasons=list(r[4] or []))


def get_risk_many(con: duckdb.DuckDBPyConnection, accounts: list[str]) -> dict[str, RiskRow]:
    if not accounts:
        return {}
    quoted = ",".join("'" + a.replace("'", "''") + "'" for a in accounts)  # inline: list params are slow
    rows = con.execute(f"SELECT account, score, band, role_hint, reasons FROM risk WHERE account IN ({quoted})")
    return {r[0]: _row(r) for r in rows.fetchall()}


def top(con: duckdb.DuckDBPyConnection, limit: int = 100, band: str | None = None) -> list[RiskRow]:
    rows = con.execute(
        """SELECT account, score, band, role_hint, reasons FROM risk
           WHERE ? IS NULL OR band = ? ORDER BY score DESC, account LIMIT ?""", [band, band, limit]).fetchall()
    return [_row(r) for r in rows]


def flagged_accounts(con: duckdb.DuckDBPyConnection) -> set[str]:
    return {r[0] for r in con.execute("SELECT account FROM risk WHERE band = 'HIGH'").fetchall()}


def candidate_victims(con: duckdb.DuckDBPyConnection, limit: int = 50) -> list[VictimCandidate]:
    """Unflagged accounts whose money went into flagged first-layer (collector) accounts."""
    rows = con.execute(
        """SELECT s.account, sum(t.amount_paise), strftime(min(t.ts), '%Y-%m-%d %H:%M:%S')
           FROM txn t
           JOIN risk d ON d.acct_id = t.dst_id AND d.band = 'HIGH' AND d.role_hint = 'L1'
           JOIN risk s ON s.acct_id = t.src_id AND s.band <> 'HIGH'
           WHERE t.usable
           GROUP BY s.account ORDER BY 2 DESC, 1 LIMIT ?""", [limit]).fetchall()
    return [VictimCandidate(account=a, out_paise_to_flagged=int(p), first_ts=t) for a, p, t in rows]
