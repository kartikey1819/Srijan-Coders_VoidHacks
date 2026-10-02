"""Where the victims' money went, case-wide: every identified victim traced once with the same rules as the trace
screen, then summed per layer. Owner: A.

The layer of an account is its layer on the trail that reached it first (collector beats distributor beats
cash-out), so every account is counted once. Money figures are victim money only (attributed amounts).
"""
from __future__ import annotations

import statistics
import time
from collections import defaultdict

import numpy as np

from abhedya import config
from abhedya.graph.build import Graph
from abhedya.graph.trace import trace_core
from abhedya.docs.banks import bank_name
from contracts.models import FlowBank, FlowCollector, FlowLayer, FlowSummary

FAST_S = {"L1": 15 * 60, "L2": 60 * 60}      # "passed on within": 15 minutes for collectors, an hour for distributors
_RANK = {"VICTIM": 0, "L1": 1, "L2": 2, "L3": 3}


def linked_groups(g: Graph, suspects: set[int]) -> list[int]:
    """Sizes of the groups of suspect accounts joined by money sent between suspects, largest first."""
    if not suspects:
        return []
    ids = np.fromiter(sorted(suspects), dtype=np.int64)
    parent = {int(u): int(u) for u in ids}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    ptr, peer = g.out["ptr"], g.out["peer"]
    for u in ids:
        for p in np.unique(peer[int(ptr[u]):int(ptr[u + 1])]):
            p = int(p)
            if p in parent and p != u:
                a, b = find(int(u)), find(p)
                if a != b:
                    parent[a] = b
    sizes: dict[int, int] = defaultdict(int)
    for u in parent:
        sizes[find(u)] += 1
    return sorted(sizes.values(), reverse=True)


def flow_summary(g: Graph, victims: list[int], seeds_for, suspects: set[int]) -> FlowSummary:
    """victims: account ids to trace; seeds_for(v) -> the transfers the trace screen would follow by default."""
    t0 = time.perf_counter()
    layer_of: dict[int, str] = {}
    recv: dict[str, int] = defaultdict(int)
    sent: dict[str, int] = defaultdict(int)
    held: dict[str, int] = defaultdict(int)
    fast: dict[str, int] = defaultdict(int)
    victims_of: dict[int, set[int]] = defaultdict(set)      # collector -> victims who paid it
    cashouts_of: dict[int, set[int]] = defaultdict(set)     # distributor -> cash-out accounts it paid
    landed = landed_term = backwards = 0
    to_l2: list[int] = []
    to_l3: list[int] = []
    losses: list[int] = []
    held_acct: dict[int, int] = defaultdict(int)             # account -> victim money it still holds (all victims)
    coll_recv: dict[int, int] = defaultdict(int)             # collector -> victim money it received
    for v in victims:
        c = trace_core(g, v, seed_txns=seeds_for(v))
        if c.loss <= 0:
            continue
        losses.append(c.loss)
        role = {u: c.role(u) for u in c.received}
        role[v] = "VICTIM"
        for u, r in role.items():
            if u == v:
                continue
            if u not in layer_of or _RANK[r] < _RANK[layer_of[u]]:
                layer_of[u] = r
            recv[r] += c.received[u]
            h = c.held(u)
            if h >= config.FREEZE_MIN_PAISE:
                held[r] += h
                held_acct[u] += h
            if r == "L1":
                coll_recv[u] += c.received[u]
        t_seed = min(e.ts for e in c.edges if e.rule == "seed")
        first: dict[str, int] = {}
        for e in c.edges:
            rs, rd = role.get(e.src, "L2"), role.get(e.dst, "L2")
            if rd in ("L2", "L3"):
                first[rd] = min(first.get(rd, e.ts), e.ts)
            if rs in FAST_S:
                sent[rs] += e.attributed
                if e.delay is not None and e.delay <= FAST_S[rs]:
                    fast[rs] += e.attributed
            if rs == "VICTIM" and rd == "L1":
                victims_of[e.dst].add(v)
            if rs == "L2" and rd == "L3":
                cashouts_of[e.src].add(e.dst)
            if rd == "L3":
                landed += e.attributed
                landed_term += e.attributed if e.terminal else 0
            if rs != "VICTIM" and _RANK[rd] < _RANK[rs]:      # money sent back towards an earlier layer
                backwards += 1
        backwards += 1 if c.returned > 0 else 0
        if "L2" in first:
            to_l2.append(first["L2"] - t_seed)
        if "L3" in first:
            to_l3.append(first["L3"] - t_seed)
    traced_ms = round((time.perf_counter() - t0) * 1000)

    count: dict[str, int] = defaultdict(int)
    for r in layer_of.values():
        count[r] += 1
    loss = sum(losses)
    share = lambda a, b: round(a / b, 4) if b else None  # noqa: E731
    per = lambda groups: round(sum(len(s) for s in groups.values()) / len(groups), 2) if groups else None  # noqa: E731
    layers = [
        FlowLayer(role="VICTIM", accounts=len(losses), received_paise=0, passed_on_paise=loss, held_paise=0,
                  fast_share=None, per_account=None, wallet_share=None),
        FlowLayer(role="L1", accounts=count["L1"], received_paise=recv["L1"], passed_on_paise=sent["L1"],
                  held_paise=held["L1"], fast_share=share(fast["L1"], recv["L1"]), per_account=per(victims_of),
                  wallet_share=None),
        FlowLayer(role="L2", accounts=count["L2"], received_paise=recv["L2"], passed_on_paise=sent["L2"],
                  held_paise=held["L2"], fast_share=share(fast["L2"], recv["L2"]), per_account=per(cashouts_of),
                  wallet_share=None),
        FlowLayer(role="L3", accounts=count["L3"], received_paise=landed, passed_on_paise=0, held_paise=held["L3"],
                  fast_share=None, per_account=None, wallet_share=share(landed_term, landed)),
    ]
    groups = linked_groups(g, suspects)
    # complaints that may be clubbed: victims who paid a collector that another victim also paid
    shared = {c: vs for c, vs in victims_of.items() if len(vs) > 1}
    top_c = max(shared, key=lambda c: (len(shared[c]), -c), default=None)
    name = lambda u: str(g.accounts[u])  # noqa: E731
    by_bank: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for u, h in held_acct.items():
        b = by_bank[name(u)[:4]]
        b[0] += 1
        b[1] += h
    banks = [FlowBank(bank=k, bank_name=bank_name(k), accounts=a, held_paise=h)
             for k, (a, h) in sorted(by_bank.items(), key=lambda kv: (-kv[1][1], kv[0]))]
    top = sorted(shared, key=lambda c: (-len(shared[c]), -coll_recv[c], name(c)))[:5]
    collectors = [FlowCollector(account=name(c), victims=sorted(name(v) for v in shared[c]), received_paise=coll_recv[c])
                  for c in top]
    return FlowSummary(
        victims=len(losses), loss_paise=loss, avg_loss_paise=round(loss / len(losses)) if losses else 0,
        max_loss_paise=max(losses, default=0), layers=layers,
        to_l2_s=round(statistics.median(to_l2)) if to_l2 else None,
        to_l3_s=round(statistics.median(to_l3)) if to_l3 else None,
        freezable_paise=sum(held.values()), traced_ms=traced_ms, suspects=len(suspects),
        linked_largest=groups[0] if groups else 0, linked_groups=len(groups), sent_back=backwards,
        club_victims=len(set().union(*shared.values())) if shared else 0, club_collectors=len(shared),
        club_top_collector=name(top_c) if top_c is not None else None,
        club_top_victims=sorted(name(v) for v in shared[top_c]) if top_c is not None else [],
        banks=banks, top_collectors=collectors, to_l3_each_s=sorted(to_l3))
