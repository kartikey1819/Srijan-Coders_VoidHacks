"""Adversarial boundaries, timestamp ties and extreme network shapes.

Boundaries: the 3-15 minute window is inclusive at 180 s and 900 s, exclusive just outside.
Ties: transfers in the same second are ordered by their row order in the file (the only order the data gives).
Shapes: hubs and dense cliques must stay computationally practical (seconds, not minutes) and keep the
money-conservation invariant.
"""
import time

import pytest

from tests.conftest import make_engine, row
from tests.test_detect import at, feats

V, L1 = "SBIN10000001", "HDFC10000002"


def balanced(r) -> bool:
    """Every traced paisa is either held by an account on the trail or came back to the victim."""
    held = sum(n.held_paise for n in r.nodes if n.role != "VICTIM")
    returned = sum(n.received_paise for n in r.nodes if n.role == "VICTIM")
    return held + returned == r.loss_paise


# ---- trace window boundaries: which rule attributes the L1's outflow ----

@pytest.mark.parametrize("delay,amount,rule", [
    (179, "500.00", "oldest"),        # just before the window, < 90 % of the inflow
    (180, "500.00", "window"),        # first second of the window
    (181, "500.00", "window"),
    (899, "500.00", "window"),
    (900, "500.00", "window"),        # last second of the window
    (901, "500.00", "oldest"),        # just after the window
    (179, "950.00", "amount_match"),  # outside the window but >= 90 % of the inflow
    (901, "900.00", "amount_match"),  # exactly 90 %
    (901, "899.99", "oldest"),        # one paisa under 90 %
])
def test_trace_window_and_amount_boundaries(tmp_path, delay, amount, rule):
    e = make_engine(tmp_path, [
        row(1, V, L1, "1000.00", at(0)),
        row(2, L1, "ICIC10000003", amount, at(delay)),
    ])
    r = e.trace(V)
    edge = next(x for x in r.edges if x.txn_idx == 1)
    assert edge.rule == rule and edge.delay_s == delay
    assert balanced(r)


@pytest.mark.parametrize("d1,d2,strict", [(181, 899, 1.0), (180, 901, 0.5), (179, 900, 0.5)])
def test_pass_through_window_edges(tmp_path, d1, d2, strict):
    e = make_engine(tmp_path, [
        row(1, V, L1, "1000.00", at(0)),
        row(2, L1, "ICIC10000003", "500.00", at(d1)),
        row(3, L1, "AXIS10000004", "500.00", at(d2)),
    ], detect=True)
    assert feats(e, L1)["pt_strict"] == pytest.approx(strict)


# ---- timestamp ties ----

def test_outflow_in_the_same_second_as_the_inflow(tmp_path):
    """Row order decides: an outflow listed after the inflow in the same second can carry its money."""
    e = make_engine(tmp_path, [
        row(1, V, L1, "1000.00", at(0)),
        row(2, L1, "ICIC10000003", "1000.00", at(0)),
    ])
    r = e.trace(V)
    assert {x.txn_idx for x in r.edges} == {0, 1}
    assert balanced(r)


def test_outflow_listed_before_the_inflow_in_the_same_second(tmp_path):
    """Listed first = happened first: it cannot carry money that had not yet arrived."""
    e = make_engine(tmp_path, [
        row(1, L1, "ICIC10000003", "1000.00", at(0)),
        row(2, V, L1, "1000.00", at(0)),
    ])
    r = e.trace(V)
    assert [x.txn_idx for x in r.edges] == [1]
    assert r.freeze_candidates == [L1]


def test_many_outflows_in_one_second_conserve_money(tmp_path):
    rows = [row(1, V, L1, "1000.00", at(0))]
    rows += [row(2 + i, L1, f"ICIC1{i:07d}", "100.00", at(300)) for i in range(12)]   # 1,200 out of 1,000
    r = make_engine(tmp_path, rows).trace(V)
    assert sum(x.attributed_paise for x in r.edges if x.hop == 2) == 100000
    assert balanced(r)


# ---- extreme shapes: practical runtime, invariants hold ----

def test_hub_with_thousands_of_edges(tmp_path):
    """One L1 receives from 3,000 senders and pays 3,000 receivers inside one day."""
    rows = [row(1, V, L1, "5000.00", at(0))]
    rows += [row(2 + i, f"KKBK1{i:07d}", L1, "100.00", at(10 + i)) for i in range(3000)]
    rows += [row(3002 + i, L1, f"ICIC1{i:07d}", "100.00", at(200 + i)) for i in range(3000)]
    t0 = time.perf_counter()
    e = make_engine(tmp_path, rows, detect=True)
    built = time.perf_counter() - t0
    t0 = time.perf_counter()
    r = e.trace(V)
    traced = time.perf_counter() - t0
    assert traced < 2.0 and built < 30
    assert balanced(r)


def test_dense_clique_of_repeated_equal_transfers(tmp_path):
    """40 accounts all paying each other the same amount minutes apart: the worst case for ring search."""
    accts = [f"AXIS1{i:07d}" for i in range(40)]
    rows, k = [], 0
    for rnd in range(3):
        for i, a in enumerate(accts):
            for j, b in enumerate(accts):
                if a != b:
                    k += 1
                    rows.append(row(k, a, b, "1000.00", at(rnd * 3600 + (i * 40 + j) % 1800)))
    t0 = time.perf_counter()
    e = make_engine(tmp_path, rows, detect=True)
    assert time.perf_counter() - t0 < 60, "ring search must stay bounded on dense graphs"
    r = e.trace(accts[0])
    assert balanced(r) and any("back to the victim" in w for w in r.warnings)


def test_long_chain_beyond_the_hop_limit(tmp_path):
    accts = [V] + [f"PUNB1{i:07d}" for i in range(30)]
    rows = [row(i, accts[i], accts[i + 1], "1000.00", at(300 * i)) for i in range(30)]
    r = make_engine(tmp_path, rows, detect=True).trace(V)
    assert max(x.hop for x in r.edges) == 4
    assert balanced(r)
