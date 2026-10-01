import json

import pytest

from abhedya.graph.trace import trace_core
from tests.conftest import ROOT, make_engine, row
from tests.oracle import chains


@pytest.fixture(scope="module")
def truth(sample_con):
    return chains(sample_con)


def test_all_300_victims_exact(engine, truth):
    assert len(truth) == 300
    g = engine.g
    for victim, t in truth.items():
        core = trace_core(g, g.acct_id(victim))
        roles = {"L1": set(), "L2": set(), "L3": set()}
        for u in core.received:
            roles[core.role(u)].add(str(g.accounts[u]))
        assert roles == {k: t[k] for k in roles}, victim
        assert {e.txn_idx for e in core.edges} == t["txn_idxs"], victim


def test_conservation_time_and_hops(engine, truth):
    for victim in truth:
        r = engine.trace(victim)
        assert sum(n.held_paise for n in r.nodes) == r.loss_paise
        arrived = {}
        for e in r.edges:  # edges are time-ordered; money leaves an account only after it arrived
            if e.hop > 1:
                assert e.src in arrived and arrived[e.src] <= e.ts
            arrived.setdefault(e.dst, e.ts)
            assert 1 <= e.hop <= 4 and 0 < e.attributed_paise <= e.amount_paise
        for n in r.nodes:
            assert n.received_paise - n.sent_paise == n.held_paise or n.role == "VICTIM"


def test_fixture_matches_engine(engine):
    fx = json.loads((ROOT / "contracts" / "fixtures" / "trace_KKBK10000000.json").read_text(encoding="utf-8"))
    got = engine.trace("KKBK10000000").model_dump()
    for key in fx:
        if key not in ("elapsed_ms", "data_sha256"):
            assert got[key] == fx[key], key


def test_unknown_account_raises(engine):
    from abhedya.engine import UnknownAccount
    with pytest.raises(UnknownAccount):
        engine.trace("ZZZZ99999999")


# ---- hand-built cases: rules the engine must follow on any data ----

def test_split_then_passthrough_and_residue_held(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "SBIN10000001", "HDFC10000002", "1000.00", "2026-09-20 10:00:00"),      # victim -> L1
        row(2, "HDFC10000002", "ICIC10000003", "600.00", "2026-09-20 10:05:00"),       # L1 split (5 min)
        row(3, "HDFC10000002", "AXIS10000004", "380.00", "2026-09-20 10:08:00"),       # L1 split (8 min)
        row(4, "ICIC10000003", "PYTM10000005", "580.00", "2026-09-20 11:00:00",        # L2 cash-out, 55 min later
            "UPI/WALLET_LOAD/P2P_CRYPTO_1", "UPI", "194.1.1.1", "Linux_Script"),
    ])
    r = e.trace("SBIN10000001")
    roles = {n.account: n.role for n in r.nodes}
    assert roles == {"SBIN10000001": "VICTIM", "HDFC10000002": "L1", "ICIC10000003": "L2",
                     "AXIS10000004": "L2", "PYTM10000005": "L3"}
    held = {n.account: n.held_paise for n in r.nodes}
    assert held["HDFC10000002"] == 2000 and held["ICIC10000003"] == 2000 and held["AXIS10000004"] == 38000
    assert held["PYTM10000005"] == 58000
    rules = {e.txn_idx: e.rule for e in r.edges}
    assert rules[1] == "window" and rules[3] == "amount_match"


def test_outflow_before_inflow_is_not_attributed(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "HDFC10000002", "ICIC10000003", "500.00", "2026-09-20 09:00:00"),   # before the victim's money
        row(2, "SBIN10000001", "HDFC10000002", "1000.00", "2026-09-20 10:00:00"),
    ])
    r = e.trace("SBIN10000001")
    assert [x.txn_idx for x in r.edges] == [1]
    assert r.freeze_candidates == ["HDFC10000002"]


def test_shared_mule_does_not_leak_residue_to_other_victim(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "SBIN10000001", "HDFC10000009", "1000.00", "2026-09-20 10:00:00"),   # victim A
        row(2, "HDFC10000009", "ICIC10000003", "980.00", "2026-09-20 10:05:00"),    # A's money, 2% residue kept
        row(3, "KKBK10000002", "HDFC10000009", "5000.00", "2026-09-21 10:00:00"),   # victim B, a day later
        row(4, "HDFC10000009", "AXIS10000004", "4900.00", "2026-09-21 10:06:00"),   # B's money
    ])
    r = e.trace("SBIN10000001")
    assert {x.txn_idx for x in r.edges} == {0, 1}
    assert {n.account: n.held_paise for n in r.nodes}["HDFC10000009"] == 2000


def test_old_clean_money_is_not_phantom(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "KKBK10000002", "HDFC10000009", "1000.00", "2026-09-18 10:00:00"),   # old inflow ...
        row(2, "HDFC10000009", "IPOS10000008", "1000.00", "2026-09-18 10:10:00"),   # ... already sent on
        row(3, "SBIN10000001", "HDFC10000009", "1040.00", "2026-09-20 10:00:00"),   # victim
        row(4, "HDFC10000009", "AXIS10000004", "1000.00", "2026-09-20 10:30:00"),   # 30 min later, >= 90%
    ])
    r = e.trace("SBIN10000001")
    assert 3 in {x.txn_idx for x in r.edges}
    assert next(x for x in r.edges if x.txn_idx == 3).attributed_paise == 100000


def test_hop_limit_and_return_to_victim(tmp_path):
    accts = ["SBIN10000001", "HDFC10000002", "ICIC10000003", "AXIS10000004", "PUNB10000005", "BARB10000006"]
    rows = [row(i, accts[i], accts[i + 1], "1000.00", f"2026-09-20 10:{5 * i:02d}:00") for i in range(5)]
    r = make_engine(tmp_path, rows).trace("SBIN10000001")
    assert max(x.hop for x in r.edges) == 4
    assert "BARB10000006" not in {n.account for n in r.nodes}

    back = [row(0, "SBIN10000001", "HDFC10000002", "1000.00", "2026-09-20 10:00:00"),
            row(1, "HDFC10000002", "SBIN10000001", "1000.00", "2026-09-20 10:05:00")]
    (tmp_path / "b").mkdir()
    r2 = make_engine(tmp_path / "b", back).trace("SBIN10000001")
    assert any("back to the victim" in w for w in r2.warnings)
    assert sum(n.held_paise for n in r2.nodes) == 0
