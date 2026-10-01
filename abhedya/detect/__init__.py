"""STUB created by A at bootstrap. B replaces this package with the real detection engine.

Signatures follow plan/00_OVERVIEW.md section 3; the engine works (without risk) while this is a stub.
"""
from contracts.models import RiskRow, VictimCandidate

REASON_LABELS: dict[str, str] = {}


def run(con, params=None) -> dict:
    return {"stub": True}


def get_risk_many(con, accounts: list[str]) -> dict[str, RiskRow]:
    return {}


def top(con, limit: int = 100, band: str | None = None) -> list[RiskRow]:
    return []


def flagged_accounts(con) -> set[str]:
    return set()


def candidate_victims(con, limit: int = 50) -> list[VictimCandidate]:
    return []
