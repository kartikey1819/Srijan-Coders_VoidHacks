"""Engine routes (plan/00_OVERVIEW.md section 5.4). Owner: A."""
from fastapi import APIRouter, Query
from fastapi.responses import Response

from abhedya import config
from abhedya.engine import get_engine
from contracts.models import AccountSummary, DQSummary, RingResult, TraceResult, TxnRow

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    return {"ok": True, "data_sha256": get_engine().data_sha256}


@router.get("/stats", response_model=DQSummary)
def stats():
    return get_engine().dq_summary()


@router.get("/dq/summary", response_model=DQSummary)
def dq_summary():
    return get_engine().dq_summary()


@router.get("/search", response_model=list[str])
def search(q: str = "", limit: int = Query(20, ge=1, le=100)):
    return get_engine().search(q, limit)


@router.get("/trace/{victim}", response_model=TraceResult)
def trace(victim: str, max_hops: int = Query(config.MAX_HOPS, ge=1, le=8)):
    return get_engine().trace(victim, max_hops=max_hops)


@router.get("/account/{acct}", response_model=AccountSummary)
def account(acct: str):
    return get_engine().account(acct)


@router.get("/account/{acct}/txns", response_model=list[TxnRow])
def account_txns(acct: str, limit: int = Query(200, ge=1, le=5000), offset: int = Query(0, ge=0)):
    return get_engine().account_txns(acct, limit, offset)


@router.get("/ring/{acct}", response_model=RingResult)
def ring(acct: str, t_from: str | None = None, t_to: str | None = None):
    return get_engine().ring(acct, t_from, t_to)


@router.get("/ring/{acct}/export.zip")
def ring_export(acct: str, t_from: str | None = None, t_to: str | None = None):
    data = get_engine().ring_export(acct, t_from, t_to)
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="ring_{acct.upper()}.zip"'})
