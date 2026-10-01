"""Per-account detection features. Owner: B.

Definitions follow the problem statement (plan/B_DETECTION.md B2). IP address and device describe
the SENDER of a transaction, so channel features are counted on an account's outgoing transfers;
cash-out receivers (L3) are recognised by what they receive.
"""
from bisect import bisect_left, bisect_right

import duckdb
import numpy as np

from abhedya.detect.params import DetectParams

FEATURES = (
    "n_in", "n_out", "sum_in_paise", "sum_out_paise", "uniq_senders", "uniq_receivers",
    "pt_strict", "pt_lenient", "pt_outflows", "episodes_3_7", "max_episode_k", "burst_senders_60m",
    "term_out_n", "term_out_anom_n", "term_in_n", "term_in_from_anom", "script_out_n", "foreign_out_n",
    "sink_ratio", "cycles_2_4",
)


def load_edges(con: duckdb.DuckDBPyConnection, p: DetectParams) -> dict[str, np.ndarray]:
    cats = ", ".join(f"'{c}'" for c in p.terminal_categories)
    d = con.execute(
        f"""SELECT src_id, dst_id, ts_epoch, amount_paise, txn_idx,
                   narr_category IN ({cats}) AS term,
                   device_class = 'script' AS script,
                   ip_class = 'foreign_proxy' AS foreign_ip
            FROM txn WHERE src_id IS NOT NULL AND dst_id IS NOT NULL"""
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


def compute(con: duckdb.DuckDBPyConnection, p: DetectParams) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    V = con.execute("SELECT count(*) FROM account").fetchone()[0]
    e = load_edges(con, p)
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
    stream = _stream_features(V, optr, iptr, S, f["sum_in_paise"], p)
    f.update(stream)

    cand = np.flatnonzero((f["pt_lenient"] >= 0.5) | (f["episodes_3_7"] > 0) | (f["term_out_n"] > 0)
                          | (f["term_in_n"] > 0) | (f["script_out_n"] > 0) | (f["foreign_out_n"] > 0))
    f["cycles_2_4"] = _cycles(V, cand.tolist(), optr, S, p)
    return f, e


def _stream_features(V, optr, iptr, S, sum_in, p: DetectParams) -> dict[str, np.ndarray]:
    o_ts, o_amt, o_dst, o_txn = S["o_ts"], S["o_amt"], S["o_dst"], S["o_txn"]
    i_ts, i_amt, i_src, i_txn = S["i_ts"], S["i_amt"], S["i_src"], S["i_txn"]
    lo, hi = p.pt_window_s
    ew, (kmin, kmax) = p.episode_window_s, p.episode_k
    bw = p.burst_window_s
    pt_s, pt_l = np.zeros(V), np.zeros(V)
    pt_o, ep, maxk, burst = (np.zeros(V, dtype=np.int64) for _ in range(4))

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
        # -- fan-in burst: most distinct senders inside any 60-min window
        if a1 - a0 >= p.burst_min_senders:
            cnt: dict[int, int] = {}
            left = a0
            best = 0
            for r in range(a0, a1):
                cnt[i_src[r]] = cnt.get(i_src[r], 0) + 1
                while i_ts[r] - i_ts[left] > bw:
                    s = i_src[left]
                    cnt[s] -= 1
                    if not cnt[s]:
                        del cnt[s]
                    left += 1
                if len(cnt) > best:
                    best = len(cnt)
            burst[u] = best
    return {"pt_strict": pt_s, "pt_lenient": pt_l, "pt_outflows": pt_o, "episodes_3_7": ep,
            "max_episode_k": maxk, "burst_senders_60m": burst}


def _cycles(V, cands, optr, S, p: DetectParams) -> np.ndarray:
    """Time-respecting loops of length 2..cycle_max_len that return to the start within cycle_window_s,
    every hop within +-cycle_amount_tol of the first amount. Bounded search from candidates only."""
    o_ts, o_amt, o_dst = S["o_ts"], S["o_amt"], S["o_dst"]
    out = np.zeros(V, dtype=np.int64)
    tol, win, max_len, cap = p.cycle_amount_tol, p.cycle_window_s, p.cycle_max_len, p.cycle_cap
    for s in cands:
        n = 0
        budget = 20_000  # bound the work per account
        for j in range(optr[s], optr[s + 1]):
            if n >= cap or budget <= 0:
                break
            t0, a0, d0 = o_ts[j], o_amt[j], o_dst[j]
            if d0 == s:
                continue
            amin, amax, tend = a0 * (1 - tol), a0 * (1 + tol), t0 + win
            stack = [(d0, t0, 1)]
            while stack and n < cap and budget > 0:
                u, t, depth = stack.pop()
                budget -= 1
                b, e = optr[u], optr[u + 1]
                for k in range(bisect_right(o_ts, t, b, e), bisect_right(o_ts, tend, b, e)):
                    if not amin <= o_amt[k] <= amax:
                        continue
                    v = o_dst[k]
                    if v == s:
                        n += 1
                    elif depth + 1 < max_len:
                        stack.append((v, o_ts[k], depth + 1))
        out[s] = min(n, cap)
    return out
