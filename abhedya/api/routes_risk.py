"""Risk routes (plan/00_OVERVIEW.md section 5.4). Owner: B."""
import duckdb
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from abhedya import detect
from abhedya.detect.export import csv_bytes
from abhedya.engine import UnknownAccount, get_engine
from abhedya.docs.banks import bank_name
from contracts.models import CountRow, DayActivity, FlowSummary, Overview, RiskRow, VictimCandidate

router = APIRouter(prefix="/api")
_NO_RISK = "Risk scores not computed: run `python -m abhedya ingest` without --skip-detect."


def _cur():
    return get_engine().cursor()


def _guard(fn):
    try:
        return fn()
    except duckdb.CatalogException:
        raise HTTPException(status_code=503, detail=_NO_RISK)


@router.get("/risk/top", response_model=list[RiskRow])
def risk_top(limit: int = Query(100, ge=1, le=25_000), band: str | None = Query(None, pattern="^(HIGH|MEDIUM|LOW)$")):
    return _guard(lambda: detect.top(_cur(), limit, band))


@router.get("/overview", response_model=Overview)
def overview():
    """Aggregates for the Overview screen. Computed once per engine (the data never changes while serving)."""
    eng = get_engine()
    cached = getattr(eng, "_overview", None)
    if cached is None:
        cached = eng._overview = _guard(lambda: _overview(eng.cursor()))
    return cached


def _overview(cur) -> Overview:
    hist = [0] * 20
    for b, n in cur.execute("SELECT least(score // 5, 19), count(*) FROM risk GROUP BY 1").fetchall():
        hist[int(b)] = int(n)
    bands = dict(cur.execute("SELECT band, count(*) FROM risk GROUP BY 1").fetchall())
    roles = {"L1": "L1 collector", "L2": "L2 distributor", "L3": "L3 cash-out"}
    by_role = [CountRow(key=k or "none", label=roles.get(k, "No layer hint"), count=n) for k, n in cur.execute(
        "SELECT role_hint, count(*) FROM risk WHERE band = 'HIGH' GROUP BY 1 ORDER BY 1 NULLS LAST").fetchall()]
    by_bank = [CountRow(key=k, label=bank_name(k), count=n) for k, n in cur.execute(
        "SELECT substr(account, 1, 4), count(*) FROM risk WHERE band = 'HIGH' GROUP BY 1 ORDER BY 2 DESC, 1").fetchall()]
    reasons = [CountRow(key=k, label=detect.REASON_LABELS.get(k, k), count=n) for k, n in cur.execute(
        """SELECT split_part(r, ':', 1), count(*) FROM (SELECT unnest(reasons) AS r FROM risk WHERE band = 'HIGH')
           GROUP BY 1 ORDER BY 2 DESC, 1""").fetchall()]
    activity = [DayActivity(day=d, n_txn=n, n_flagged=f) for d, n, f in cur.execute(
        """SELECT strftime(t.ts, '%Y-%m-%d'), count(*),
                  count(*) FILTER (WHERE s.band = 'HIGH' OR d.band = 'HIGH')
           FROM txn t JOIN risk s ON s.acct_id = t.src_id JOIN risk d ON d.acct_id = t.dst_id
           WHERE t.usable GROUP BY 1 ORDER BY 1""").fetchall()]
    return Overview(accounts=sum(hist), score_hist=hist, bands=bands, flagged_by_role=by_role,
                    flagged_by_bank=by_bank, flagged_reasons=reasons, activity=activity)


@router.get("/flow", response_model=FlowSummary)
def flow():
    """Where the victims' money went: every identified victim traced once, summed per layer (Dashboard)."""
    return _guard(lambda: get_engine().flow())


@router.get("/risk/reasons")
def risk_reasons() -> dict[str, str]:
    return detect.REASON_LABELS


@router.get("/risk/{acct}", response_model=RiskRow)
def risk_one(acct: str):
    a = acct.strip().upper()
    found = _guard(lambda: detect.get_risk_many(_cur(), [a]))
    if a not in found:
        raise UnknownAccount(f"Unknown account: {acct}")
    return found[a]


@router.get("/victims", response_model=list[VictimCandidate])
def victims(limit: int = Query(50, ge=1, le=1000)):
    return _guard(lambda: detect.candidate_victims(_cur(), limit))


@router.get("/export/flagged.csv")
def export_flagged():
    return Response(_guard(lambda: csv_bytes(_cur(), True)), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="flagged_accounts.csv"'})


@router.get("/export/ranked.csv")
def export_ranked():
    return Response(_guard(lambda: csv_bytes(_cur(), False)), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="ranked_accounts.csv"'})
