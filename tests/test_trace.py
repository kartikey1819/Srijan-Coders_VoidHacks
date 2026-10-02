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
    for n in fx["nodes"] + got["nodes"]:   # risk scores are tuned separately; the trace itself must match
        n.pop("risk")
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


def test_own_money_spent_first_so_residue_stays_held(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "KKBK10000002", "HDFC10000009", "5000.00", "2026-09-18 10:00:00", "IMPS/Family/Transfer#1"),
        row(2, "SBIN10000001", "HDFC10000009", "1000.00", "2026-09-20 10:00:00"),   # victim
        row(3, "HDFC10000009", "ICIC10000003", "950.00", "2026-09-20 10:05:00"),    # pass-through, 5% kept
        row(4, "HDFC10000009", "PUNB10000004", "300.00", "2026-09-22 18:00:00", "UPI/Grocery/Store#1", "UPI"),
    ])
    r = e.trace("SBIN10000001")
    assert {x.txn_idx for x in r.edges} == {1, 2}          # the grocery payment is not part of the trail
    assert {n.account: n.held_paise for n in r.nodes}["HDFC10000009"] == 5000


def test_partly_tainted_inflow_passes_through_pro_rata(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "KKBK10000002", "HDFC10000009", "600.00", "2026-09-20 09:59:00", "IMPS/Family/Transfer#1"),
        row(2, "SBIN10000001", "HDFC10000009", "400.00", "2026-09-20 10:00:00"),       # victim
        row(3, "HDFC10000009", "AXIS10000004", "1000.00", "2026-09-20 10:01:00"),      # L1 forwards both (1 min)
        row(4, "AXIS10000004", "PYTM10000005", "950.00", "2026-09-20 11:00:00",        # 59 min later, 95%
            "UPI/WALLET_LOAD/P2P_CRYPTO_1", "IMPS"),
    ])
    r = e.trace("SBIN10000001")
    edge = {x.txn_idx: x for x in r.edges}
    assert edge[3].rule == "amount_match" and edge[3].attributed_paise == 38000   # 400 * 950 / 1000
    assert sum(n.held_paise for n in r.nodes) == r.loss_paise


def test_two_victims_in_one_window_raise_ambiguity_warning(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "SBIN10000001", "HDFC10000009", "1000.00", "2026-09-20 10:00:00"),
        row(2, "KKBK10000002", "HDFC10000009", "1000.00", "2026-09-20 10:02:00"),
        row(3, "HDFC10000009", "ICIC10000003", "500.00", "2026-09-20 10:06:00"),
        row(4, "HDFC10000009", "AXIS10000004", "500.00", "2026-09-20 10:07:00"),
    ])
    assert any("could be funded" in w for w in e.trace("KKBK10000002").warnings)


# ---- the indexed trace must equal the plain ledger replay (tests/trace_reference.py) ----
def _sig(core, g):
    return ([(e.txn_idx, e.src, e.dst, e.ts, e.amount, e.attributed, e.hop, e.delay, e.rule, e.terminal)
             for e in core.edges], core.received, core.sent, core.min_hop, sorted(core.terminal_in),
            {u: core.held(u) for u in core.received}, core.returned, core.warnings, core.ambiguous, core.loss)


def test_indexed_trace_equals_reference_on_the_sample(engine, truth):
    from tests.trace_reference import trace_core as reference
    g = engine.g
    for victim in truth:
        u = g.acct_id(victim)
        assert _sig(trace_core(g, u, max_ledger=None), g) == _sig(reference(g, u), g), victim


def test_indexed_trace_equals_reference_on_a_dense_random_world(tmp_path):
    """Busy accounts, near-repeat amounts (amount_match), 3-15 min hops (window), cash-outs and pre-theft history:
    every account traced as the victim gives exactly the reference result."""
    import random
    from tests.trace_reference import trace_core as reference
    rnd = random.Random(7)
    banks = ("SBIN", "HDFC", "ICIC", "AXIS", "PYTM")
    accts = [f"{banks[i % 5]}{20000000 + i}" for i in range(28)]
    rows, t, got = [], 0, {a: [] for a in accts}
    for i in range(3500):
        t += rnd.randint(5, 240)
        s, d = rnd.sample(accts, 2)
        if got[s] and rnd.random() < 0.45:
            amt = round(rnd.choice(got[s]) * rnd.uniform(0.9, 1.0), 2)      # passes on most of an inflow
        else:
            amt = round(rnd.uniform(100, 5000), 2)
        got[d].append(amt)
        hh, mm, ss = 10 + t // 3600, t // 60 % 60, t % 60
        cash = rnd.random() < 0.05
        rows.append(row(i, s, d, f"{amt:.2f}", f"2026-09-2{1 + hh // 24} {hh % 24:02d}:{mm:02d}:{ss:02d}",
                        "UPI/WALLET_LOAD/P2P_CRYPTO_1" if cash else "IMPS/FriendSplit#1"))
    e = make_engine(tmp_path, rows)
    g = e.g
    for a in accts:
        u = g.acct_id(a)
        assert _sig(trace_core(g, u, max_ledger=None), g) == _sig(reference(g, u), g), a


def test_busy_account_beyond_the_budget_holds_the_money(tmp_path):
    rows = [row(i, f"KKBK{30000000 + i}", "AXIS10000009", "50.00", f"2026-09-20 09:{i:02d}:00") for i in range(40)]
    rows += [row(100, "SBIN10000001", "AXIS10000009", "1000.00", "2026-09-20 10:00:00"),     # victim -> busy account
             row(101, "AXIS10000009", "ICIC10000003", "990.00", "2026-09-20 10:05:00")]
    e = make_engine(tmp_path, rows)
    u = e.g.acct_id("SBIN10000001")
    full = trace_core(e.g, u, max_ledger=None)
    cut = trace_core(e.g, u, max_ledger=10)
    busy = e.g.acct_id("AXIS10000009")
    assert e.g.acct_id("ICIC10000003") in full.received and busy in full.received
    assert busy in cut.not_followed and e.g.acct_id("ICIC10000003") not in cut.received
    assert cut.held(busy) == 100000 and any("very busy" in w and "AXIS10000009" in w for w in cut.warnings)


def test_default_loss_is_the_transfers_to_suspicious_accounts(tmp_path):
    import numpy as np
    from abhedya import config
    e = make_engine(tmp_path, [
        row(1, "SBIN10000001", "HDFC10000002", "1000.00", "2026-09-20 10:00:00"),     # to a scored mule
        row(2, "SBIN10000001", "PUNB10000007", "250.00", "2026-09-20 10:30:00"),      # an ordinary bill
        row(3, "HDFC10000002", "ICIC10000003", "990.00", "2026-09-20 10:05:00"),
    ])
    e._score_arr = np.zeros(len(e.g.accounts), dtype=np.int16)
    e._score_arr[e.g.acct_id("HDFC10000002")] = config.SEED_MIN_SCORE
    r = e.trace("SBIN10000001")
    assert r.loss_paise == 100000 and [x.dst for x in r.edges if x.rule == "seed"] == ["HDFC10000002"]
    assert r.warnings[0].startswith("Traced the 1 of 2 outgoing transfers")
    assert e.trace("SBIN10000001", seed_txns={1}).loss_paise == 25000                 # a chosen transfer still wins
