"""0-100 Mule Risk Index. Owner: B.

score = 100 * (1 - prod_g (1 - w_g * s_g)) over four signal groups (each s_g in 0..1, the strongest
signal in the group, so correlated signals are not double-counted), plus floors tied to the
statement's own definitions. Two passes: pass 1 without network position (G4) finds suspects;
pass 2 adds G4 = share of money from / to those suspects.
"""
import duckdb
import numpy as np

from abhedya.detect.params import DetectParams


def _signals(f: dict[str, np.ndarray], p: DetectParams) -> dict[str, np.ndarray]:
    n_out = np.maximum(f["n_out"], 1)
    s = {
        "pt": np.where(f["pt_outflows"] >= p.pt_min_outflows, f["pt_strict"], 0.0),
        "episodes": np.minimum(1.0, f["episodes_3_7"] / 2.0),
        "burst": np.clip((f["burst_senders_60m"] - (p.burst_min_senders - 1)) / 3.0, 0.0, 1.0),
        "cycle": np.minimum(1.0, f["ring_cycles"] / max(p.cycle_min_loops, 1)),
        "drain": np.clip(f["fanin_drain_share"], 0.0, 1.0),
        "term_out": np.where(f["term_out_anom_n"] > 0, 1.0, np.where(f["term_out_n"] > 0, 0.6, 0.0)),
        "term_in_anom": (f["term_in_from_anom"] > 0).astype(float),
        "term_in": np.where(f["term_in_n"] > 0, 0.6 * f["sink_ratio"], 0.0),
        "script": f["script_out_n"] / n_out,
        "foreign": f["foreign_out_n"] / n_out,
    }
    s["G1"] = s["pt"]
    s["G2"] = np.maximum.reduce([s["episodes"], s["burst"], s["cycle"], s["drain"]])
    s["G3"] = np.maximum.reduce([s["term_out"], s["term_in_anom"], s["term_in"], s["script"], s["foreign"]])
    return s


def _noisy_or(parts: list[tuple[float, np.ndarray]]) -> np.ndarray:
    keep = np.ones_like(parts[0][1], dtype=float)
    for w, sig in parts:
        keep *= 1.0 - w * np.clip(sig, 0.0, 1.0)
    return 100.0 * (1.0 - keep)


def _floors(score: np.ndarray, f: dict[str, np.ndarray], p: DetectParams, g4: np.ndarray | None = None) -> np.ndarray:
    """Minimum scores for patterns the statement names outright (each is evidence on its own)."""
    rules = [
        ((f["pt_strict"] >= p.pt_flag_ratio) & (f["pt_outflows"] >= p.pt_min_outflows), p.floor_pass_through),
        ((f["episodes_3_7"] >= 1) & (f["pt_strict"] >= 0.5), p.floor_fanout),
        ((f["term_in_from_anom"] >= 1) & (f["term_in_anom_share"] >= p.anom_cashout_min_share), p.floor_term_in_anom),
        ((f["term_out_anom_n"] >= 1) & (f["term_out_anom_share"] >= p.anom_cashout_min_share), p.floor_term_out_anom),
        (f["ring_cycles"] >= p.cycle_min_loops, p.floor_cycles),
        ((f["fanin_drains"] >= 1) & (f["fanin_drain_share"] >= p.drain_min_share), p.floor_fanin_drain),
    ]
    if g4 is not None:
        rules.append((((f["term_out_n"] >= 1) | (f["term_in_n"] >= 1)) & (g4 >= p.term_linked_min),
                      p.floor_term_linked))
    score = score.copy()
    for mask, floor in rules:
        score[mask] = np.maximum(score[mask], floor)
    return score


def score(f: dict[str, np.ndarray], e: dict[str, np.ndarray], p: DetectParams) -> dict:
    s = _signals(f, p)
    pass1 = _floors(_noisy_or([(p.w_velocity, s["G1"]), (p.w_topology, s["G2"]), (p.w_channel, s["G3"])]), f, p)
    suspect = pass1 >= p.network_seed_min
    src, dst, amt = e["src"], e["dst"], e["amt"].astype(float)
    V = len(pass1)
    from_s = np.bincount(dst, weights=amt * suspect[src], minlength=V)
    to_s = np.bincount(src, weights=amt * suspect[dst], minlength=V)
    with np.errstate(divide="ignore", invalid="ignore"):
        f["in_from_flagged"] = np.where(f["sum_in_paise"] > 0, from_s / np.maximum(f["sum_in_paise"], 1), 0.0)
        f["out_to_flagged"] = np.where(f["sum_out_paise"] > 0, to_s / np.maximum(f["sum_out_paise"], 1), 0.0)
    s["G4"] = np.maximum(f["in_from_flagged"], f["out_to_flagged"])
    final = _floors(_noisy_or([(p.w_velocity, s["G1"]), (p.w_topology, s["G2"]),
                               (p.w_channel, s["G3"]), (p.w_network, s["G4"])]), f, p, s["G4"])
    sc = np.clip(np.rint(final), 0, 100).astype(np.int64)
    band = np.where(sc >= p.band_high, "HIGH", np.where(sc >= p.band_medium, "MEDIUM", "LOW"))
    role = np.full(V, "", dtype=object)
    role[(f["episodes_3_7"] >= 1) | (f["pt_strict"] >= p.pt_flag_ratio)] = "L1"
    role[f["term_out_n"] > 0] = "L2"
    role[(f["term_in_n"] > 0) & (f["sink_ratio"] > 0.5)] = "L3"
    return {"score": sc, "band": band, "role_hint": role, "reasons": _reasons(f, s, p), "signals": s}


def _reasons(f: dict[str, np.ndarray], s: dict[str, np.ndarray], p: DetectParams) -> list[str]:
    """Fired reason codes per account, strongest contribution first, ';'-joined."""
    w1, w2, w3, w4 = p.w_velocity, p.w_topology, p.w_channel, p.w_network
    rules = [  # (code, contribution array, fired mask, value formatter)
        ("PT_STRICT", w1 * s["pt"], s["pt"] >= 0.5, lambda i: f"{f['pt_strict'][i]:.2f}"),
        ("FANOUT_EPISODES", w2 * s["episodes"], f["episodes_3_7"] >= 1, lambda i: f"{f['episodes_3_7'][i]}"),
        ("FANIN_BURST", w2 * s["burst"], s["burst"] > 0, lambda i: f"{f['burst_senders_60m'][i]}"),
        ("CYCLE", w2 * s["cycle"], f["ring_cycles"] > 0, lambda i: f"{f['ring_cycles'][i]}"),
        ("FANIN_DRAIN", w2 * s["drain"], f["fanin_drain_share"] >= 0.2, lambda i: f"{f['fanin_drain_share'][i]:.2f}"),
        ("TERM_IN_FROM_SCRIPT_OR_FOREIGN", w3 * s["term_in_anom"], f["term_in_from_anom"] > 0,
         lambda i: f"{f['term_in_from_anom'][i]}"),
        ("TERM_OUT", w3 * s["term_out"], f["term_out_n"] > 0, lambda i: f"{f['term_out_n'][i]}"),
        ("TERM_IN", w3 * s["term_in"], f["term_in_n"] > 0, lambda i: f"{f['term_in_n'][i]}"),
        ("SCRIPT_DEVICE_OUT", w3 * s["script"], f["script_out_n"] > 0, lambda i: f"{f['script_out_n'][i]}"),
        ("FOREIGN_PROXY_IP_OUT", w3 * s["foreign"], f["foreign_out_n"] > 0, lambda i: f"{f['foreign_out_n'][i]}"),
        ("LINKED_TO_FLAGGED", w4 * s["G4"], s["G4"] >= 0.2, lambda i: f"{s['G4'][i]:.2f}"),
        # informational (not scored on their own)
        ("PT_LENIENT", 0 * s["pt"], (f["pt_lenient"] >= p.pt_flag_ratio) & (f["pt_strict"] < p.pt_flag_ratio),
         lambda i: f"{f['pt_lenient'][i]:.2f}"),
        ("SINK", 0 * s["pt"], (f["term_in_n"] > 0) & (f["sink_ratio"] >= 0.9), lambda i: f"{f['sink_ratio'][i]:.2f}"),
    ]
    V = len(s["pt"])
    out: list[list[tuple[float, str]]] = [[] for _ in range(V)]
    for code, contrib, fired, fmt in rules:
        for i in np.flatnonzero(fired).tolist():
            out[i].append((float(contrib[i]), f"{code}:{fmt(i)}"))
    return [";".join(r for _, r in sorted(x, key=lambda c: -c[0])) for x in out]


def write_tables(con: duckdb.DuckDBPyConnection, f: dict[str, np.ndarray], r: dict, p: DetectParams) -> None:
    V = len(r["score"])
    feats = {"acct_id": np.arange(V, dtype=np.int32)}
    for k, v in f.items():
        feats[k] = np.asarray(v)
    con.register("_features", feats)
    con.execute("CREATE OR REPLACE TABLE features AS SELECT * FROM _features ORDER BY acct_id")
    con.unregister("_features")
    con.register("_risk", {
        "acct_id": np.arange(V, dtype=np.int32),
        "score": r["score"].astype(np.int32),
        "band": np.asarray(r["band"], dtype=str),          # typed text: DuckDB is ~400x slower on object arrays
        "role_hint": np.asarray(r["role_hint"], dtype=str),
        "reasons": np.asarray(r["reasons"], dtype=str),
    })
    con.execute(
        f"""CREATE OR REPLACE TABLE risk AS
            SELECT k.acct_id, a.account, k.score, k.band, NULLIF(k.role_hint, '') AS role_hint,
                   CASE WHEN k.reasons = '' THEN []::VARCHAR[] ELSE string_split(k.reasons, ';') END AS reasons,
                   '{p.hash()}' AS params_hash
            FROM _risk k JOIN account a USING (acct_id) ORDER BY k.acct_id"""
    )
    con.unregister("_risk")
