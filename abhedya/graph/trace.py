"""Victim money trail: amount-attributed, time-respecting, hop-bounded. Owner: A.

Model: every account on the trail holds *lots*: the victim's (tainted) money it received, and
its other (clean) inflows. All candidate out-edges are processed in one global time order
(ties: CSV row order), so an outflow can only spend money that had already arrived. Each
outflow spends lots in the priority order config.ATTRIBUTION_ORDER:
  window        lot arrived 180-900 s before the outflow   (statement: dispersed within 3-15 min)
  amount_match  outflow carries >= 90% of the lot's original amount (statement: >= 90% passed on)
  oldest        tainted lots first (oldest first), then clean lots
Clean lots matter: when a shared mule later forwards *another* victim's money, the window/amount
rules match that outflow to the other victim's inflow instead of draining this victim's residue.
Money is conserved: sum(held over non-victim accounts) + returned_to_victim == loss.
Receivers of cash-out edges (wallet/crypto) are L3 and are not expanded further.
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from datetime import datetime, timezone

from abhedya import config
from abhedya.graph.build import Graph


@dataclass(slots=True)
class Lot:
    remaining: int
    t: int
    hop: int
    spendable: bool      # tainted and allowed to move further (not cashed out, below max hops)
    tainted: bool = True
    original: int = 0    # amount when the lot arrived (amount_match compares against this)
    src: int = -1        # txn_idx of the inflow that created it (one inflow can be part tainted, part clean)

    def __post_init__(self):
        if not self.original:
            self.original = self.remaining


@dataclass(slots=True)
class EdgeRec:
    txn_idx: int
    src: int
    dst: int
    ts: int
    amount: int
    attributed: int
    hop: int
    delay: int | None
    rule: str
    terminal: bool


@dataclass
class TraceCore:
    victim: int
    loss: int
    edges: list[EdgeRec]
    lots: dict[int, list[Lot]]
    received: dict[int, int]
    sent: dict[int, int]
    min_hop: dict[int, int]
    terminal_in: set[int]
    first_in: dict[int, int]
    returned: int
    warnings: list[str] = field(default_factory=list)
    ambiguous: int = 0   # outflows the rules could fund from this victim's money or from other money

    def held(self, u: int) -> int:
        return sum(l.remaining for l in self.lots.get(u, ()) if l.tainted)

    def role(self, u: int) -> str:
        if u == self.victim:
            return "VICTIM"
        if self.min_hop[u] == 1:
            return "L1"
        return "L3" if u in self.terminal_in else "L2"


def _bundles(rule: str, live: list[Lot], amount: int, t: int) -> list[list[int]]:
    """Candidate bundles (lists of indexes into live) that satisfy `rule`, in priority order.
    amount_match judges a whole inflow transaction (its tainted and clean parts together)."""
    if rule == "window":
        lo, hi = config.PT_WINDOW_S
        return [[i] for i, l in enumerate(live) if lo <= t - l.t <= hi]
    if rule == "amount_match":
        groups: dict[int, list[int]] = {}
        for i, l in enumerate(live):
            key = l.src if l.src >= 0 else -1 - i
            g = groups.get(key)
            if g is None:
                groups[key] = [i]
            else:
                g.append(i)
        ratio = config.AMOUNT_MATCH_MIN
        out = []
        for idxs in groups.values():
            if len(idxs) == 1:
                l = live[idxs[0]]
                orig, rem = l.original, l.remaining
            else:
                orig = rem = 0
                for i in idxs:
                    orig += live[i].original
                    rem += live[i].remaining
            m = ratio * orig
            # one outflow carrying 90-100% of an inflow that is still (>= 90%) unspent is a pass-through of it
            if rem >= m and m <= amount <= orig:
                out.append(idxs)
        return out
    # fallback (lowest-intermediate-balance presumption): the holder's own (clean) money is spent first
    return [[i] for i, l in enumerate(live) if not l.tainted] + [[i] for i, l in enumerate(live) if l.tainted]


def _split(total: int, lots: list[Lot]) -> list[int]:
    """Take `total` from a bundle pro rata to what each lot still holds (exact integer paise)."""
    rem = [l.remaining for l in lots]
    avail = sum(rem)
    if total >= avail:
        return rem
    takes = [total * r // avail for r in rem]
    short = total - sum(takes)
    for i in sorted(range(len(lots)), key=lambda i: -rem[i]):
        if short == 0:
            break
        if takes[i] < rem[i]:
            takes[i] += 1
            short -= 1
    return takes


def trace_core(g: Graph, v: int, max_hops: int = config.MAX_HOPS,
               order: tuple[str, ...] = config.ATTRIBUTION_ORDER,
               seed_txns: set[int] | None = None) -> TraceCore:
    o = g.out
    ptr, peer, ts, amt, txn, cat = o["ptr"], o["peer"], o["ts"], o["amt"], o["txn"], o["cat"]
    ipt, its, iamt, itxn = g.inn["ptr"], g.inn["ts"], g.inn["amt"], g.inn["txn"]
    term_codes = g.terminal_codes
    core = TraceCore(v, 0, [], {}, {}, {}, {}, set(), {}, 0)
    heap: list[tuple[int, int, int, int]] = []   # (ts, txn_idx, account, out-edge position)
    pending: dict[int, int] = {}                 # account -> scheduled out-edge position
    ocur: dict[int, int] = {}                    # account -> next out-edge not yet applied to its ledger
    icur: dict[int, int] = {}                    # account -> next in-edge not yet applied to its ledger
    trail_in: dict[int, dict[int, int]] = {}     # account -> {txn_idx: tainted amount delivered by it}
    rules = order + (() if "oldest" in order else ("oldest",))
    ties = 0

    def process_out(u: int, k: int) -> None:
        """Apply out-edge k of u: spend lots by priority; the tainted part moves to the receiver."""
        nonlocal ties
        t, x, d, a = int(ts[k]), int(txn[k]), int(peer[k]), int(amt[k])
        if a <= 0 or d == u:
            return
        lots = core.lots[u]
        live = [l for l in lots if l.remaining > 0 and l.t <= t and (l.spendable or not l.tainted)]
        if not live:
            return
        need = a
        tparts: list[tuple[Lot, str, int]] = []      # tainted parts only; clean parts just shrink
        used: set[int] = set()
        deciding = True
        for rule in rules:                           # each rule's candidates are built at most once, lazily
            cands = _bundles(rule, live, a, t)
            if deciding and cands:
                deciding = False                     # could the deciding rule be met by this victim's money
                if rule != "oldest" and len(cands) > 1:  # AND by other money? Then say so.
                    has_t = any(live[i].tainted for b in cands for i in b)
                    has_c = any(not live[i].tainted for b in cands for i in b)
                    if has_t and has_c:
                        core.ambiguous += 1
            for idxs in cands:
                fresh = [i for i in idxs if i not in used]
                if not fresh:
                    continue
                used.update(fresh)
                bundle = [live[i] for i in fresh]
                for lot, take in zip(bundle, _split(need, bundle)):
                    if take <= 0:
                        continue
                    lot.remaining -= take
                    need -= take
                    if lot.tainted:
                        tparts.append((lot, rule, take))
                if need == 0:
                    break
            if need == 0:
                break
        if len(lots) > 32 and len(lots) > 2 * len(live):
            lots[:] = [l for l in lots if l.remaining > 0]   # drop spent lots (in place: callers hold this list)
        if not tparts:
            return
        attributed = sum(p[2] for p in tparts)
        terminal = int(cat[k]) in term_codes
        first = tparts[0][0]
        if first.t == t:
            ties += 1
        core.sent[u] = core.sent.get(u, 0) + attributed
        core.edges.append(EdgeRec(x, u, d, t, a, attributed, min(p[0].hop for p in tparts) + 1,
                                  t - first.t, tparts[0][1], terminal))
        for lot, _, take in tparts:
            deliver(d, take, t, lot.hop + 1, terminal, x)

    def advance(u: int, t: int, x: int) -> None:
        """Replay u's own ledger (inflows as clean lots, outflows as spends) strictly before event (t, x),
        so its clean balance is real and not phantom money it had already sent on."""
        lots = core.lots[u]
        iend, oend = int(ipt[u + 1]), int(ptr[u + 1])
        while True:
            ip, op = icur.get(u, int(ipt[u])), ocur.get(u, int(ptr[u]))
            ik = (int(its[ip]), int(itxn[ip])) if ip < iend else None
            ok = (int(ts[op]), int(txn[op])) if op < oend else None
            if ik is not None and ik < (t, x) and (ok is None or ik < ok):
                icur[u] = ip + 1
                rest = int(iamt[ip]) - trail_in.get(u, {}).get(ik[1], 0)
                if rest > 0:
                    lots.append(Lot(rest, ik[0], 0, False, False, src=ik[1]))
            elif ok is not None and ok < (t, x):
                ocur[u] = op + 1
                process_out(u, op)
            else:
                return

    def schedule(u: int) -> None:
        op = ocur.get(u, int(ptr[u]))
        if op < int(ptr[u + 1]):
            pending[u] = op
            heapq.heappush(heap, (int(ts[op]), int(txn[op]), u, op))

    def deliver(u: int, amount: int, t: int, hop: int, terminal: bool, x: int) -> None:
        if u == v:
            core.returned += amount
            return
        spendable = (not terminal) and hop < max_hops
        core.lots.setdefault(u, [])
        if spendable:
            advance(u, t, x)  # bring u's own balance up to this moment first
        tin = trail_in.setdefault(u, {})
        tin[x] = tin.get(x, 0) + amount
        core.lots[u].append(Lot(amount, t, hop, spendable, src=x))
        core.received[u] = core.received.get(u, 0) + amount
        if hop < core.min_hop.get(u, 1 << 30):
            core.min_hop[u] = hop
        if terminal:
            core.terminal_in.add(u)
        if t < core.first_in.get(u, 1 << 62):
            core.first_in[u] = t
        if spendable and u not in pending:
            schedule(u)

    # seed: the victim's outgoing transactions are the reported loss
    for k in range(int(ptr[v]), int(ptr[v + 1])):
        d, a, t = int(peer[k]), int(amt[k]), int(ts[k])
        if d == v or a <= 0 or (seed_txns is not None and int(txn[k]) not in seed_txns):
            continue
        terminal = int(cat[k]) in term_codes
        core.loss += a
        core.sent[v] = core.sent.get(v, 0) + a
        core.edges.append(EdgeRec(int(txn[k]), v, d, t, a, a, 1, None, "seed", terminal))
        deliver(d, a, t, 1, terminal, int(txn[k]))

    # global time order: an outflow is applied only after everything that happened before it
    while heap:
        t, x, u, k = heapq.heappop(heap)
        if pending.get(u) != k:
            continue
        advance(u, t, x)                      # inflows (and any skipped outflows) before this outflow
        if ocur.get(u, int(ptr[u])) == k:
            ocur[u] = k + 1
            process_out(u, k)
        nxt = ocur[u]
        if nxt < int(ptr[u + 1]) and any(l.spendable and l.remaining > 0 for l in core.lots[u]):
            pending[u] = nxt
            heapq.heappush(heap, (int(ts[nxt]), int(txn[nxt]), u, nxt))
        else:
            pending.pop(u, None)

    n_seed = sum(1 for e in core.edges if e.rule == "seed")
    if n_seed == 0:
        core.warnings.append("Victim account has no outgoing transactions to trace.")
    elif n_seed > 1:
        core.warnings.append(f"Victim has {n_seed} outgoing transactions; all are treated as the reported loss.")
    if core.returned:
        core.warnings.append("Part of the traced money flowed back to the victim account.")
    if ties:
        core.warnings.append(f"{ties} transfer(s) spent money that arrived in the same second (ordered by file row).")
    if core.ambiguous:
        core.warnings.append(
            f"{core.ambiguous} transfer(s) could be funded by this victim's money or by other money that arrived "
            "at the same account in the same way (e.g. several victims within 15 minutes); the earliest inflow "
            "was used. Review these accounts before freezing.")
    return core


def fmt_ts(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
