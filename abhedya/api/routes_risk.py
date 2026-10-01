"""Risk routes (plan/00_OVERVIEW.md section 5.4). Owner: B."""
import duckdb
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from abhedya import detect
from abhedya.detect.export import csv_bytes
from abhedya.engine import UnknownAccount, get_engine
from contracts.models import RiskRow, VictimCandidate

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
