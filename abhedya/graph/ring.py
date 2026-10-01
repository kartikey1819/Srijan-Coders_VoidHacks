"""One-click syndicate isolation. Owner: A.

Ring = the connected component of suspect accounts (S) that contains the seed, using only
transfers between suspects (optionally inside a time window), plus the victims whose money
enters it. No node cap: on the official file the whole syndicate is ~1,400 nodes.
"""
from __future__ import annotations

from collections import deque
from datetime import datetime, timezone

import numpy as np

from abhedya.graph.build import Graph
from abhedya.graph.trace import fmt_ts
from contracts.models import GraphEdge, GraphNode, RingResult, RiskRow

MAX_ENTRY_SENDERS = 1000


def _epoch(s: str | None, default: int) -> int:
    if not s:
        return default
    return int(datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())


def isolate_ring(g: Graph, seed: int, S: set[int], risk: dict[str, RiskRow],
                 t_from: str | None = None, t_to: str | None = None) -> RingResult:
    lo, hi = _epoch(t_from, -(1 << 62)), _epoch(t_to, 1 << 62)
    in_s = np.zeros(g.V, dtype=bool)
    if S:
        in_s[np.fromiter(S, dtype=np.int64)] = True
    o, n = g.out, g.inn

    def nbrs(u: int, side: dict, suspects_only: bool = True):
        a, b = int(side["ptr"][u]), int(side["ptr"][u + 1])
        for k in range(a, b):
            t = int(side["ts"][k])
            p = int(side["peer"][k])
            if lo <= t <= hi and (in_s[p] or not suspects_only):
                yield k, p

    # component of suspects containing the seed (or the seed's suspect neighbours)
    start = [seed] if in_s[seed] else sorted({p for side in (o, n) for _, p in nbrs(seed, side)})
    members: set[int] = set(start)
    q = deque(start)
    while q:
        u = q.popleft()
        for side in (o, n):
            for _, p in nbrs(u, side):
                if p not in members:
                    members.add(p)
                    q.append(p)
    if not members:  # seed has no link to any suspect
        members = {seed}

    # edges inside the ring; "entry" members receive nothing from other suspects (money enters there)
    agg: dict[tuple[int, int], list] = {}
    has_suspect_in: set[int] = set()
    terminal_in: set[int] = set()

    def add(s: int, d: int, k: int, side: dict):
        t, a, x = int(side["ts"][k]), int(side["amt"][k]), int(side["txn"][k])
        e = agg.setdefault((s, d), [0, 0, t, t, []])
        e[0] += 1
        e[1] += a
        e[2], e[3] = min(e[2], t), max(e[3], t)
        e[4].append(x)

    for u in members:
        for k, p in nbrs(u, o):
            if p in members:
                add(u, p, k, o)
                has_suspect_in.add(p)
                if int(o["cat"][k]) in g.terminal_codes:
                    terminal_in.add(p)
    entry = members - has_suspect_in

    victims: set[int] = set()
    for u in sorted(entry):
        for k, p in nbrs(u, n, suspects_only=False):
            if not in_s[p] and len(victims) < MAX_ENTRY_SENDERS:
                victims.add(p)
                add(p, u, k, n)

    def role(u: int) -> str:
        r = risk.get(str(g.accounts[u]))
        if r is not None and r.role_hint:
            return r.role_hint
        if u in victims:
            return "VICTIM"
        if u in entry:
            return "L1"
        return "L3" if u in terminal_in else "L2"

    nodes = []
    for u in sorted(members | victims, key=lambda u: str(g.accounts[u])):
        a = str(g.accounts[u])
        r = risk.get(a)
        nodes.append(GraphNode(account=a, role="VICTIM" if u in victims else role(u), bank_prefix=a[:4],
                               risk_score=r.score if r else None, risk_band=r.band if r else None))
    edges = [GraphEdge(src=str(g.accounts[s]), dst=str(g.accounts[d]), n_txn=e[0], total_paise=e[1],
                       first_ts=fmt_ts(e[2]), last_ts=fmt_ts(e[3]), txn_idxs=sorted(e[4]))
             for (s, d), e in sorted(agg.items(), key=lambda kv: kv[1][2])]
    return RingResult(seed=str(g.accounts[seed]), nodes=nodes, edges=edges,
                      n_txn=sum(e.n_txn for e in edges), total_paise=sum(e.total_paise for e in edges),
                      t_from=t_from, t_to=t_to)
