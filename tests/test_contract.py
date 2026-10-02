"""The web UI's types (web/src/types.ts) must match the API's models (contracts/models.py) field for field."""
import re

import pytest

import contracts.models as m
from tests.conftest import ROOT

TS = (ROOT / "web" / "src" / "types.ts").read_text(encoding="utf-8")
INTERFACES = {name: body for name, body in re.findall(r"export interface (\w+)\s*\{([^{}]*)\}", TS)}


def ts_fields(name: str) -> set[str]:
    body = re.sub(r"\s+", " ", INTERFACES[name])
    return set(re.findall(r"(\w+)\??\s*:", body)) - {"string", "number", "boolean"}


@pytest.mark.parametrize("name", sorted(INTERFACES))
def test_ui_type_matches_api_model(name):
    model = getattr(m, name)
    assert ts_fields(name) == set(model.model_fields), name


def test_every_api_model_used_by_the_ui_has_a_type():
    used = {"RiskRow", "TraceNode", "TraceEdge", "TraceResult", "Counterparty", "AccountSummary", "TxnRow", "GraphNode",
            "GraphEdge", "RingResult", "VictimCandidate", "DQSummary", "CaseInfo", "CaseOutput"}
    assert used <= set(INTERFACES)
