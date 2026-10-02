"""Victim money trail: amount-attributed, time-respecting, hop-bounded. Owner: A.

Model: every account on the trail holds *lots*: the victim's (tainted) money it received, and
its other (clean) inflows. All candidate out-edges are processed in one global time order
(ties: CSV row order), so an outflow can only spend money that had already arrived. Each
outflow spends lots in the priority order config.ATTRIBUTION_ORDER:
  window        lot arrived 180-900 s before the outflow   (statement: dispersed within 3-15 min)
  amount_match  outflow carries >= 90% of the lot's original amount (statement: >= 90% passed on)
  oldest        the holder's own clean lots first, then tainted lots (each oldest first)
Clean lots matter: when a shared mule later forwards *another* victim's money, the window/amount
rules match that outflow to the other victim's inflow instead of draining this victim's residue.
Money is conserved: sum(held over non-victim accounts) + returned_to_victim == loss.
Receivers of cash-out edges (wallet/crypto) are L3 and are not expanded further.

Speed: each account keeps a _Book of its lots in arrival order with three indexes, so an outflow never rescans the
whole ledger: arrival times (binary search for the window rule), amount buckets (amount_match only looks at lots
within 10% of the outflow), and a pointer past spent clean lots (oldest). Busy accounts with tens of thousands of
inflows cost about the same per outflow as quiet ones. An inflow that no later outflow of the account could pick by
the window or amount_match rule can only ever be spent as the holder's own balance (oldest first), so a run of such
inflows is kept as one balance lot instead of thousands of single ones; the result is the same. And an account's
history before the victim's money first reaches it is all its own money: wherever that balance was exactly zero,
everything before was spent and can never matter again, so the replay starts there (_fresh_start). tests/trace_reference.py is the plain version; both give the
same edges, amounts and holdings (tests/test_trace.py checks this).
"""
from __future__ import annotations

import heapq
import math

import numpy as np
from bisect import bisect_left, bisect_right
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
    inert: bool = False  # a run of clean inflows no rule but oldest can ever pick (see _inert_inflows)

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


_LOGR = -math.log(config.AMOUNT_MATCH_MIN)   # amount bucket width: one bucket spans a factor of 1 / 0.9


def _bucket(paise: int) -> int:
    return int(math.log(paise) / _LOGR)


def _inert_inflows(g: Graph, u: int) -> np.ndarray:
    """For each inflow of u (in-edge order): True if no outflow of u could ever pick it by the window rule (none
    180-900 s after it) or by amount_match (none at or after it carrying 90-100% of it). Such a lot is only ever spent
    by the oldest rule. Borderline amounts count as pickable, so the shortcut never changes a result. Cached per graph."""
    cache = g.__dict__.setdefault("_inert_cache", {})
    hit = cache.get(u)
    if hit is not None:
        return hit
    i0, i1 = int(g.inn["ptr"][u]), int(g.inn["ptr"][u + 1])
    o0, o1 = int(g.out["ptr"][u]), int(g.out["ptr"][u + 1])
    t_in = g.inn["ts"][i0:i1].astype(np.int64)
    a_in = g.inn["amt"][i0:i1].astype(np.int64)
    t_out = g.out["ts"][o0:o1].astype(np.int64)            # sorted: the out-CSR is ordered by (ts, txn_idx)
    if o1 == o0:
        res = np.ones(i1 - i0, dtype=bool)
    else:
        lo, hi = config.PT_WINDOW_S
        in_window = np.searchsorted(t_out, t_in + hi, "right") > np.searchsorted(t_out, t_in + lo, "left")
        a_out = g.out["amt"][o0:o1].astype(np.int64)
        order = np.argsort(a_out, kind="stable")
        a_sorted, t_by_amt = a_out[order], t_out[order]
        # range-max table over t_by_amt: is there an outflow in the amount range at or after the inflow?
        levels = [t_by_amt]
        while (1 << len(levels)) <= len(t_by_amt):
            prev, step = levels[-1], 1 << (len(levels) - 1)
            levels.append(np.maximum(prev[:-step], prev[step:]))
        a_lo = np.searchsorted(a_sorted, np.floor(config.AMOUNT_MATCH_MIN * a_in) - 1, "left")
        a_hi = np.searchsorted(a_sorted, a_in, "right")
        n = a_hi - a_lo
        matched = np.zeros(i1 - i0, dtype=bool)
        has = n > 0
        if has.any():
            k = np.floor(np.log2(np.maximum(n, 1))).astype(np.int64)
            lo_i, hi_i = a_lo[has], a_hi[has]
            kk = k[has]
            best = np.empty(len(lo_i), dtype=np.int64)
            for lv in np.unique(kk):
                sel = kk == lv
                tab = levels[lv]
                best[sel] = np.maximum(tab[lo_i[sel]], tab[hi_i[sel] - (1 << lv)])
            matched[has] = best >= t_in[has]
        res = ~(in_window | matched)
    cache[u] = res
    return res


def _fresh_start(g: Graph, u: int, t: int, x: int) -> tuple[int, int]:
    """Before any victim money reaches u, every lot is its own and an outflow spends min(amount, balance). Returns the
    in- and out-edge positions just after the last event before (t, x) at which that balance was exactly zero (all
    earlier lots fully spent), or the start of the ledger. Outflows the trace ignores (amount <= 0, to itself) spend
    nothing here either."""
    i0, i1 = int(g.inn["ptr"][u]), int(g.inn["ptr"][u + 1])
    o0, o1 = int(g.out["ptr"][u]), int(g.out["ptr"][u + 1])
    if i1 == i0 or o1 == o0:
        return i0, o0
    it, ix = g.inn["ts"][i0:i1].astype(np.int64), g.inn["txn"][i0:i1].astype(np.int64)
    ot, ox = g.out["ts"][o0:o1].astype(np.int64), g.out["txn"][o0:o1].astype(np.int64)
    n_in = int(np.count_nonzero((it < t) | ((it == t) & (ix < x))))
    n_out = int(np.count_nonzero((ot < t) | ((ot == t) & (ox < x))))
    if n_in == 0 or n_out == 0:
        return i0, o0
    ia = np.maximum(g.inn["amt"][i0:i0 + n_in].astype(np.int64), 0)
    oa = g.out["amt"][o0:o0 + n_out].astype(np.int64)
    oa = np.where((oa > 0) & (g.out["peer"][o0:o0 + n_out] != u), oa, 0)
    keys_t = np.concatenate([it[:n_in], ot[:n_out]])
    keys_x = np.concatenate([ix[:n_in], ox[:n_out]])
    is_out = np.concatenate([np.zeros(n_in, dtype=bool), np.ones(n_out, dtype=bool)])
    # same order as the replay: (ts, txn_idx); on an equal key (a self-transfer) advance applies the outflow first
    order = np.lexsort((~is_out, keys_x, keys_t))
    step = np.concatenate([ia, -oa])[order]
    s_cum = np.cumsum(step)
    bal = s_cum - np.minimum(np.minimum.accumulate(s_cum), 0)   # balance never goes below zero
    zero = np.flatnonzero((bal == 0) & is_out[order])
    if len(zero) == 0:
        return i0, o0
    z = int(zero[-1])
    taken = is_out[order][: z + 1]
    return i0 + int(np.count_nonzero(~taken)), o0 + int(np.count_nonzero(taken))


class _Book:
    """One account's lots in arrival order, indexed for the three attribution rules."""
    __slots__ = ("lots", "times", "ordered", "tainted", "chead", "buckets", "srcs", "multi", "inert")

    def __init__(self):
        self.lots: list[Lot] = []
        self.times: list[int] = []
        self.ordered = True                      # arrival times non-decreasing (binary search allowed)
        self.tainted: list[int] = []             # positions of tainted lots
        self.chead = 0                           # every clean lot before this position is spent
        self.buckets: dict[int, list[int]] = {}  # amount bucket -> positions of lots alone in their inflow group
        self.srcs: dict[int, list[int]] = {}     # inflow txn_idx -> positions of its lots
        self.multi: set[int] = set()             # inflows split into several lots (tainted and clean parts)
        self.inert = None                        # per-inflow flags from _inert_inflows, loaded on first replay

    def add(self, lot: Lot) -> None:
        pos = len(self.lots)
        if self.times and lot.t < self.times[-1]:
            self.ordered = False
        self.lots.append(lot)
        self.times.append(lot.t)
        if lot.tainted:
            self.tainted.append(pos)
        if lot.src >= 0:
            g = self.srcs.setdefault(lot.src, [])
            g.append(pos)
            if len(g) > 1:
                self.multi.add(lot.src)
        if lot.original > 0:
            self.buckets.setdefault(_bucket(lot.original), []).append(pos)

    def add_inert(self, amount: int, t: int) -> None:
        """Clean money only the oldest rule can spend: extend the balance lot at the end, or start one."""
        last = self.lots[-1] if self.lots else None
        if last is not None and last.inert and last.remaining > 0:   # never revive a spent lot (chead may be past it)
            last.remaining += amount
            last.original += amount
            return
        if self.times and t < self.times[-1]:
            self.ordered = False
        self.lots.append(Lot(amount, t, 0, False, False, inert=True))
        self.times.append(t)

    def has_spendable(self) -> bool:
        return any(self.lots[p].spendable and self.lots[p].remaining > 0 for p in self.tainted)


@dataclass
class TraceCore:
    victim: int
    loss: int
    edges: list[EdgeRec]
    lots: dict[int, list[Lot]]       # account -> its lots in arrival order (the lists the books index)
    received: dict[int, int]
    sent: dict[int, int]
    min_hop: dict[int, int]
    terminal_in: set[int]
    first_in: dict[int, int]
    returned: int
    warnings: list[str] = field(default_factory=list)
    ambiguous: int = 0   # outflows the rules could fund from this victim's money or from other money
    not_followed: dict[int, int] = field(default_factory=dict)  # busy account -> its ledger size (budget reached)

    books: dict[int, _Book] = field(default_factory=dict)

    def held(self, u: int) -> int:
        b = self.books.get(u)
        return sum(b.lots[p].remaining for p in b.tainted) if b else 0

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
               seed_txns: set[int] | None = None, max_ledger: int | None = config.TRACE_MAX_LEDGER) -> TraceCore:
    """max_ledger: ledger entries (inflows + outflows of the accounts followed) the trace may replay. Victim money
    reaching an unopened account that would exceed it stays held there and is reported (core.not_followed);
    None = no limit."""
    o = g.out
    ptr, peer, ts, amt, txn, cat = o["ptr"], o["peer"], o["ts"], o["amt"], o["txn"], o["cat"]
    ipt, its, iamt, itxn = g.inn["ptr"], g.inn["ts"], g.inn["amt"], g.inn["txn"]
    term_codes = g.terminal_codes
    core = TraceCore(v, 0, [], {}, {}, {}, {}, set(), {}, 0)
    books = core.books
    heap: list[tuple[int, int, int, int]] = []   # (ts, txn_idx, account, out-edge position)
    pending: dict[int, int] = {}                 # account -> scheduled out-edge position
    ocur: dict[int, int] = {}                    # account -> next out-edge not yet applied to its ledger
    icur: dict[int, int] = {}                    # account -> next in-edge not yet applied to its ledger
    trail_in: dict[int, dict[int, int]] = {}     # account -> {txn_idx: tainted amount delivered by it}
    rules = order + (() if "oldest" in order else ("oldest",))
    opened: set[int] = set()                     # accounts whose ledgers the trace replays
    work = 0                                     # their ledger entries, against max_ledger
    seeding = True     # seed delivery runs ledgers ahead of the clock: a later, earlier-dated tainted part could
                       # still join one of those inflows, so only inflows from before the theft are merged until it ends
    t_theft = min((int(ts[k]) for k in range(int(ptr[v]), int(ptr[v + 1]))
                   if seed_txns is None or int(txn[k]) in seed_txns), default=0)   # no victim money moves before this
    ties = 0

    def process_out(u: int, k: int) -> None:
        """Apply out-edge k of u: spend lots by priority; the tainted part moves to the receiver."""
        nonlocal ties
        t, x, d, a = int(ts[k]), int(txn[k]), int(peer[k]), int(amt[k])
        if a <= 0 or d == u:
            return
        book = books[u]
        lots = book.lots
        used: set[int] = set()

        def live(p: int) -> bool:
            """In this outflow's starting snapshot: unspent, already arrived, and allowed to move."""
            if p in used:
                return True                      # only lots this outflow used have changed since it started
            l = lots[p]
            return l.remaining > 0 and l.t <= t and (l.spendable or not l.tainted)

        def window() -> list[list[int]]:
            lo, hi = config.PT_WINDOW_S
            if book.ordered:
                rng = range(bisect_left(book.times, t - hi), bisect_right(book.times, t - lo))
            else:
                rng = [p for p in range(len(lots)) if lo <= t - lots[p].t <= hi]
            return [[p] for p in rng if not lots[p].inert and live(p)]

        def amount_match() -> list[list[int]]:
            """Inflows (tainted and clean parts together) of which this outflow passes on 90-100%."""
            ratio = config.AMOUNT_MATCH_MIN
            found: list[tuple[int, list[int]]] = []
            base = _bucket(a)
            for b in range(base - 1, base + 3):
                lst = book.buckets.get(b)
                if not lst:
                    continue
                keep = []
                for p in lst:
                    l = lots[p]
                    if (l.src >= 0 and l.src in book.multi) or l.remaining < ratio * l.original \
                            or (l.tainted and not l.spendable):
                        continue                 # can never be a lone candidate again: drop from the index
                    keep.append(p)
                    if live(p):
                        m = ratio * l.original
                        if l.remaining >= m and m <= a <= l.original:
                            found.append((p, [p]))
                if len(keep) != len(lst):
                    book.buckets[b] = keep
            for src in book.multi:
                idxs = [p for p in book.srcs[src] if live(p)]
                if not idxs:
                    continue
                orig = sum(lots[p].original for p in idxs)
                rem = sum(lots[p].remaining for p in idxs)
                m = ratio * orig
                if rem >= m and m <= a <= orig:
                    found.append((idxs[0], idxs))
            found.sort(key=lambda f: f[0])
            return [f[1] for f in found]

        def oldest():
            """The holder's own (clean) money first, oldest first; then the victim's money, oldest first."""
            n = len(lots)
            while book.chead < n and (lots[book.chead].tainted or lots[book.chead].remaining == 0):
                book.chead += 1
            for p in range(book.chead, n):
                l = lots[p]
                if l.t > t and book.ordered:
                    break
                if not l.tainted and p not in used and live(p):
                    yield [p]
            for p in book.tainted:
                if p not in used and live(p):
                    yield [p]

        need = a
        tparts: list[tuple[Lot, str, int]] = []  # tainted parts only; clean parts just shrink
        deciding = True
        for rule in rules:                       # each rule's candidates are built at most once, lazily
            if rule == "oldest":
                cands = oldest()
                deciding = False
            else:
                cands = window() if rule == "window" else amount_match()
                if deciding and cands:
                    deciding = False             # could the deciding rule be met by this victim's money
                    if len(cands) > 1:           # AND by other money? Then say so.
                        has_t = any(lots[p].tainted for b in cands for p in b)
                        has_c = any(not lots[p].tainted for b in cands for p in b)
                        if has_t and has_c:
                            core.ambiguous += 1
            for idxs in cands:
                fresh = [p for p in idxs if p not in used]
                if not fresh:
                    continue
                bundle = [lots[p] for p in fresh]
                takes = _split(need, bundle)
                used.update(fresh)
                for lot, take in zip(bundle, takes):
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
        book = books[u]
        iend, oend = int(ipt[u + 1]), int(ptr[u + 1])
        if book.inert is None:
            book.inert = _inert_inflows(g, u)
            if u not in icur and u not in ocur and not book.lots:   # first replay: all of u's own money so far
                icur[u], ocur[u] = _fresh_start(g, u, t, x)
        i_base = int(ipt[u])
        while True:
            ip, op = icur.get(u, int(ipt[u])), ocur.get(u, int(ptr[u]))
            ik = (int(its[ip]), int(itxn[ip])) if ip < iend else None
            ok = (int(ts[op]), int(txn[op])) if op < oend else None
            if ik is not None and ik < (t, x) and (ok is None or ik < ok):
                icur[u] = ip + 1
                part = trail_in.get(u, {}).get(ik[1], 0)
                rest = int(iamt[ip]) - part
                if rest > 0:
                    if not part and (not seeding or ik[0] < t_theft) and book.inert[ip - i_base]:
                        book.add_inert(rest, ik[0])
                    else:
                        book.add(Lot(rest, ik[0], 0, False, False, src=ik[1]))
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
        nonlocal work
        if u == v:
            core.returned += amount
            return
        spendable = (not terminal) and hop < max_hops
        if spendable and u not in opened:
            size = int(ipt[u + 1] - ipt[u]) + int(ptr[u + 1] - ptr[u])
            if u in core.not_followed or (max_ledger is not None and work + size > max_ledger):
                spendable = False                # too busy to follow within the budget: the money is held here
                core.not_followed[u] = size
            else:
                opened.add(u)
                work += size
        if u not in books:
            books[u] = _Book()
            core.lots[u] = books[u].lots
        if spendable:
            advance(u, t, x)  # bring u's own balance up to this moment first
        tin = trail_in.setdefault(u, {})
        tin[x] = tin.get(x, 0) + amount
        books[u].add(Lot(amount, t, hop, spendable, src=x))
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

    seeding = False
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
        if nxt < int(ptr[u + 1]) and books[u].has_spendable():
            pending[u] = nxt
            heapq.heappush(heap, (int(ts[nxt]), int(txn[nxt]), u, nxt))
        else:
            pending.pop(u, None)

    n_seed = sum(1 for e in core.edges if e.rule == "seed")
    if n_seed == 0:
        core.warnings.append("Victim account has no outgoing transactions to trace.")
    elif n_seed > 1 and seed_txns is None:
        core.warnings.append(f"Victim has {n_seed} outgoing transactions; all are treated as the reported loss.")
    if core.returned:
        core.warnings.append("Part of the traced money flowed back to the victim account.")
    if ties:
        core.warnings.append(f"{ties} transfer(s) spent money that arrived in the same second (ordered by file row).")
    if core.not_followed:
        names = ", ".join(str(g.accounts[u]) for u in sorted(core.not_followed, key=lambda u: -core.not_followed[u])[:5])
        more = len(core.not_followed) - 5
        core.warnings.append(
            f"{len(core.not_followed)} very busy account(s) were not followed further ({names}"
            f"{f' and {more} more' if more > 0 else ''}): the victim money that reached them is shown as held there. "
            "Their onward transfers need a separate check.")
    if core.ambiguous:
        core.warnings.append(
            f"{core.ambiguous} transfer(s) could be funded by this victim's money or by other money that arrived "
            "at the same account in the same way (e.g. several victims within 15 minutes); the earliest inflow "
            "was used. Review these accounts before freezing.")
    return core


def fmt_ts(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
