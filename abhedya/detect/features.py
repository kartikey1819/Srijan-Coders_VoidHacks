"""Per-account detection features. Owner: B.

Definitions follow the problem statement (plan/B_DETECTION.md B2). IP address and device describe
the SENDER of a transaction, so channel features are counted on an account's outgoing transfers;
cash-out receivers (L3) are recognised by what they receive.
"""
import time
from bisect import bisect_left, bisect_right

import duckdb
import numpy as np

from abhedya.detect.params import DetectParams

FEATURES = (
    "n_in", "n_out", "sum_in_paise", "sum_out_paise", "uniq_senders", "uniq_receivers",
    "pt_strict", "pt_lenient", "pt_outflows", "episodes_3_7", "max_episode_k", "burst_senders_60m",
    "term_out_n", "term_out_anom_n", "term_in_n", "term_in_from_anom", "script_out_n", "foreign_out_n",
    "sink_ratio", "ring_cycles", "fanin_drains", "fanin_drain_share", "term_in_anom_share", "term_out_anom_share",
)


def load_edges(con: duckdb.DuckDBPyConnection, p: DetectParams) -> dict[str, np.ndarray]:
    cats = ", ".join(f"'{c}'" for c in p.terminal_categories)
    d = con.execute(
        f"""SELECT src_id, dst_id, ts_epoch, amount_paise, txn_idx,
                   narr_category IN ({cats}) AS term,
                   device_class = 'script' AS script,
                   ip_class = 'foreign_proxy' AS foreign_ip
            FROM txn WHERE usable"""
    ).fetchnumpy()
    return {
        "src": np.asarray(d["src_id"], dtype=np.int64),
        "dst": np.asarray(d["dst_id"], dtype=np.int64),
        "ts": np.asarray(d["ts_epoch"], dtype=np.int64),
        "amt": np.asarray(d["amount_paise"], dtype=np.int64),
        "txn": np.asarray(d["txn_idx"], dtype=np.int64),
        "term": np.asarray(d["term"], dtype=bool),
        "script": np.asarray(d["script"], dtype=bool),
        "foreign": np.asarray(d["foreign_ip"], dtype=bool),
    }


def _count(idx: np.ndarray, V: int, mask: np.ndarray | None = None) -> np.ndarray:
    return np.bincount(idx if mask is None else idx[mask], minlength=V).astype(np.int64)


def _sum(idx: np.ndarray, w: np.ndarray, V: int) -> np.ndarray:
    out = np.zeros(V, dtype=np.int64)
    np.add.at(out, idx, w)
    return out


def compute(con: duckdb.DuckDBPyConnection, p: DetectParams,
            timings: dict | None = None) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    timings = {} if timings is None else timings
    t0 = time.perf_counter()
    V = con.execute("SELECT count(*) FROM account").fetchone()[0]
    e = load_edges(con, p)
    timings["load_edges"] = round(time.perf_counter() - t0, 3)
    t0 = time.perf_counter()
    src, dst, ts, amt, txn = e["src"], e["dst"], e["ts"], e["amt"], e["txn"]
    anom = e["script"] | e["foreign"]
    f: dict[str, np.ndarray] = {
        "n_in": _count(dst, V), "n_out": _count(src, V),
        "sum_in_paise": _sum(dst, amt, V), "sum_out_paise": _sum(src, amt, V),
        "term_out_n": _count(src, V, e["term"]),
        "term_out_anom_n": _count(src, V, e["term"] & anom),
        "term_in_n": _count(dst, V, e["term"]),
        "term_in_from_anom": _count(dst, V, e["term"] & anom),
        "script_out_n": _count(src, V, e["script"]),
        "foreign_out_n": _count(src, V, e["foreign"]),
    }
    cash_anom = e["term"] & anom          # cash-out transfers sent from a script device or foreign proxy
    with np.errstate(divide="ignore", invalid="ignore"):
        f["term_in_anom_share"] = np.where(f["sum_in_paise"] > 0, _sum(dst[cash_anom], amt[cash_anom], V)
                                           / np.maximum(f["sum_in_paise"], 1), 0.0)
        f["term_out_anom_share"] = np.where(f["sum_out_paise"] > 0, _sum(src[cash_anom], amt[cash_anom], V)
                                            / np.maximum(f["sum_out_paise"], 1), 0.0)
    pairs = np.unique(src * V + dst)
    f["uniq_receivers"] = np.bincount(pairs // V, minlength=V).astype(np.int64)
    f["uniq_senders"] = np.bincount(pairs % V, minlength=V).astype(np.int64)
    with np.errstate(divide="ignore", invalid="ignore"):
        f["sink_ratio"] = np.where(f["sum_in_paise"] > 0,
                                   np.clip(1 - f["sum_out_paise"] / np.maximum(f["sum_in_paise"], 1), 0, 1), 0.0)

    # per-account timelines, ordered by (ts, txn_idx) like the trace
    oo, io = np.lexsort((txn, ts, src)), np.lexsort((txn, ts, dst))
    optr = np.searchsorted(src[oo], np.arange(V + 1)).tolist()
    iptr = np.searchsorted(dst[io], np.arange(V + 1)).tolist()
    S = {
        "o_ts": ts[oo].tolist(), "o_amt": amt[oo].tolist(), "o_dst": dst[oo].tolist(), "o_txn": txn[oo].tolist(),
        "i_ts": ts[io].tolist(), "i_amt": amt[io].tolist(), "i_src": src[io].tolist(), "i_txn": txn[io].tolist(),
    }
    timings["counts_channels"] = round(time.perf_counter() - t0, 3)
    t0 = time.perf_counter()
    stream = _stream_features(V, optr, iptr, S, f["sum_in_paise"], p)
    f.update(stream)
    timings["pass_through_fanout_fanin"] = round(time.perf_counter() - t0, 3)
    t0 = time.perf_counter()

    f["ring_cycles"] = _cycles(V, np.flatnonzero(f["n_out"] > 0).tolist(), optr, S, p)
    timings["cycles"] = round(time.perf_counter() - t0, 3)
    return f, e


def _stream_features(V, optr, iptr, S, sum_in, p: DetectParams) -> dict[str, np.ndarray]:
    o_ts, o_amt, o_dst, o_txn = S["o_ts"], S["o_amt"], S["o_dst"], S["o_txn"]
    i_ts, i_amt, i_src, i_txn = S["i_ts"], S["i_amt"], S["i_src"], S["i_txn"]
    lo, hi = p.pt_window_s
    ew, (kmin, kmax) = p.episode_window_s, p.episode_k
    bw = p.burst_window_s
    pt_s, pt_l = np.zeros(V), np.zeros(V)
    pt_o, ep, maxk, burst, drains = (np.zeros(V, dtype=np.int64) for _ in range(5))
    drained = np.zeros(V)

    for u in range(V):
        a0, a1, b0, b1 = iptr[u], iptr[u + 1], optr[u], optr[u + 1]
        if a0 == a1:
            continue
        # -- pass-through: each outflow spends inflow lots that arrived 3-15 min earlier first (oldest first),
        #    then < 3 min earlier, then the oldest remaining lots (FIFO). No opening balance is assumed.
        if b0 < b1:
            lt: list[int] = []
            lr: list[int] = []
            head = m_s = m_l = outs = 0
            i = a0
            for j in range(b0, b1):
                t, need = o_ts[j], o_amt[j]
                key = (t, o_txn[j])
                while i < a1 and (i_ts[i], i_txn[i]) < key:
                    lt.append(i_ts[i])
                    lr.append(i_amt[i])
                    i += 1
                if not lt or need <= 0:
                    continue
                k_old = bisect_left(lt, t - hi)          # first lot at most 15 min old
                k_mid = bisect_right(lt, t - lo)         # lots in [k_old, k_mid) are 3-15 min old
                hit = False
                for k in range(k_old, len(lt)):
                    if need == 0:
                        break
                    r = lr[k]
                    if r:
                        take = need if need < r else r
                        lr[k] = r - take
                        need -= take
                        m_l += take
                        if k < k_mid:
                            m_s += take
                            hit = True
                while need and head < len(lr):
                    r = lr[head]
                    if r:
                        take = need if need < r else r
                        lr[head] = r - take
                        need -= take
                    if lr[head] == 0:
                        head += 1
                outs += hit
            if sum_in[u] > 0:
                pt_s[u] = m_s / sum_in[u]
                pt_l[u] = m_l / sum_in[u]
            pt_o[u] = outs
        # -- dispersal episodes: an inflow followed within 15 min by outflows to k distinct receivers
        if b1 - b0 >= kmin:
            for ii in range(a0, a1):
                t_in = i_ts[ii]
                jb = bisect_right(o_ts, t_in, b0, b1)
                je = bisect_right(o_ts, t_in + ew, b0, b1)
                if je - jb >= kmin:
                    k = len(set(o_dst[jb:je]))
                    if k > maxk[u]:
                        maxk[u] = k
                    if kmin <= k <= kmax:
                        ep[u] += 1
        # -- fan-in burst: most distinct senders inside any 60-min window; and "drains": a burst of
        #    >= burst_min_senders senders whose money (>= pt_flag_ratio of it) leaves within 15 min of the
        #    burst's last credit (a collector account emptied at once)
        if a1 - a0 >= p.burst_min_senders:
            pre = [0]
            for j in range(b0, b1):
                pre.append(pre[-1] + o_amt[j])
            cnt: dict[int, int] = {}
            left, best, w_sum = a0, 0, 0
            for r in range(a0, a1):
                cnt[i_src[r]] = cnt.get(i_src[r], 0) + 1
                w_sum += i_amt[r]
                while i_ts[r] - i_ts[left] > bw:
                    s = i_src[left]
                    cnt[s] -= 1
                    if not cnt[s]:
                        del cnt[s]
                    w_sum -= i_amt[left]
                    left += 1
                if len(cnt) > best:
                    best = len(cnt)
                if len(cnt) >= p.burst_min_senders and b0 < b1:
                    jb = bisect_right(o_ts, i_ts[r], b0, b1)
                    je = bisect_right(o_ts, i_ts[r] + ew, b0, b1)
                    if pre[je - b0] - pre[jb - b0] >= p.pt_flag_ratio * w_sum:
                        drains[u] += 1
                        drained[u] += w_sum
                        cnt.clear()
                        w_sum, left = 0, r + 1
            burst[u] = best
    return {"pt_strict": pt_s, "pt_lenient": pt_l, "pt_outflows": pt_o, "episodes_3_7": ep,
            "max_episode_k": maxk, "burst_senders_60m": burst, "fanin_drains": drains,
            # how much of the account's money went through collect-then-empty events
            "fanin_drain_share": np.where(sum_in > 0, drained / np.maximum(sum_in, 1), 0.0)}


def _cycles(V, starts, optr, S, p: DetectParams) -> np.ndarray:
    """Smurfing rings: time-respecting loops through 3..cycle_max_len accounts that return to their start
    within cycle_window_s, each hop within +-cycle_amount_tol of the hop before (rings take a cut per hop).
    Two-account back-and-forth (couples, sweeps between one's own accounts) is everyday legitimate behaviour
    and is not counted. Returns, per account, how many times money went round the SAME ring (busy accounts
    close one-off loops by chance; smurfing repeats a ring). A loop is only visible from the account that
    starts it, so every member of a found ring is credited."""
    o_ts, o_amt, o_dst = S["o_ts"], S["o_amt"], S["o_dst"]
    rings: dict[frozenset, int] = {}
    tol, win, max_len, cap = p.cycle_amount_tol, p.cycle_window_s, p.cycle_max_len, p.cycle_cap
    for s in starts:
        found = 0
        budget = 20_000  # bound the work per start account
        for j in range(optr[s], optr[s + 1]):
            if found >= cap or budget <= 0:
                break
            t0, a0, d0 = o_ts[j], o_amt[j], o_dst[j]
            if d0 == s:
                continue
            tend = t0 + win
            stack = [(d0, t0, (s, d0), a0)]
            while stack and found < cap and budget > 0:
                u, t, path, prev = stack.pop()
                budget -= 1
                b, e = optr[u], optr[u + 1]
                amin, amax = prev * (1 - tol), prev * (1 + tol)
                for k in range(bisect_right(o_ts, t, b, e), bisect_right(o_ts, tend, b, e)):
                    if not amin <= o_amt[k] <= amax:
                        continue
                    v = o_dst[k]
                    if v == s:
                        if len(path) >= 3:
                            found += 1
                            ring = frozenset(path)
                            rings[ring] = rings.get(ring, 0) + 1
                    elif len(path) < max_len and v not in path:
                        stack.append((v, o_ts[k], path + (v,), o_amt[k]))
    out = np.zeros(V, dtype=np.int64)
    for ring, n in rings.items():
        for a in ring:
            out[a] = max(out[a], n)
    return np.minimum(out, cap)
