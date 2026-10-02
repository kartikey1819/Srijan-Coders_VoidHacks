"""Why an account has its Mule Risk Index, check by check. Owner: B.

The score is not a sum: four checks are combined so that overlapping evidence is not counted twice
(100 * (1 - prod(1 - w * s))), and a pattern the problem statement names outright sets a minimum score. This module
recomputes both from the stored features with the same functions the scoring used, so the explanation always adds up
to the stored score.
"""
import duckdb
import numpy as np

from abhedya.detect.params import DetectParams
from abhedya.detect.risk import _floors, _noisy_or, _signals
from contracts.models import ScoreCheck, ScoreExplain

CHECKS = [  # (key, label, weight attribute, signal group)
    ("SPEED", "Passes money on fast", "w_velocity", "G1"),
    ("SHAPE", "Splits, gathers or circles money", "w_topology", "G2"),
    ("CHANNEL", "Cash-out channel, script device or foreign IP", "w_channel", "G3"),
    ("NETWORK", "Money from or to other suspect accounts", "w_network", "G4"),
]


def _pct(x: float) -> str:
    return f"{round(100 * float(x))}%"


def _detail(key: str, f: dict, s: dict) -> str:
    """The strongest signal inside one check, in plain words."""
    v = lambda k: float(np.asarray(f[k]).ravel()[0])  # noqa: E731
    g = lambda k: float(np.asarray(s[k]).ravel()[0])  # noqa: E731
    if key == "SPEED":
        return (f"Passed on {_pct(v('pt_strict'))} of the money it received within 3-15 minutes"
                if g("pt") > 0 else "Did not pass money on within 3-15 minutes")
    if key == "SHAPE":
        opts = [(g("episodes"), f"Split an incoming amount to 3-7 accounts within 15 minutes {int(v('episodes_3_7'))} time(s)"),
                (g("burst"), f"Received from {int(v('burst_senders_60m'))} different senders within one hour"),
                (g("cycle"), f"Money went round the same ring {int(v('ring_cycles'))} time(s) within 24 hours"),
                (g("drain"), f"Collected from many senders, then emptied {_pct(v('fanin_drain_share'))} of it within 15 minutes")]
    elif key == "CHANNEL":
        opts = [(g("term_out"), f"Sent money to wallet / crypto channels {int(v('term_out_n'))} time(s)"),
                (g("term_in_anom"), "Received wallet / crypto money sent from a script device or foreign proxy IP"),
                (g("term_in"), f"Received wallet / crypto money {int(v('term_in_n'))} time(s) and kept most of it"),
                (g("script"), f"{_pct(g('script'))} of its payments were sent from a script / emulator device"),
                (g("foreign"), f"{_pct(g('foreign'))} of its payments were sent from a foreign proxy IP (185.x / 194.x)")]
    else:
        return f"{_pct(g('G4'))} of its money came from or went to other suspect accounts"
    best = max(opts, key=lambda o: o[0])
    return best[1] if best[0] > 0 else "Nothing found in this check"


def _floor_reason(f: dict, g4: float, p: DetectParams) -> tuple[int, str] | None:
    """The named pattern that set a minimum score, if any (the highest one that applies)."""
    v = lambda k: float(np.asarray(f[k]).ravel()[0])  # noqa: E731
    rules = [
        (v("pt_strict") >= p.pt_flag_ratio and v("pt_outflows") >= p.pt_min_outflows, p.floor_pass_through,
         "Passed on 90% or more of its money within 3-15 minutes (the statement's pass-through pattern)"),
        (v("episodes_3_7") >= 1 and v("pt_strict") >= 0.5, p.floor_fanout,
         "Split incoming money into 3-7 accounts within minutes (the statement's distributor pattern)"),
        (v("term_in_from_anom") >= 1 and v("term_in_anom_share") >= p.anom_cashout_min_share, p.floor_term_in_anom,
         "Mainly receives wallet / crypto money sent from script devices or foreign proxy IPs"),
        (v("term_out_anom_n") >= 1 and v("term_out_anom_share") >= p.anom_cashout_min_share, p.floor_term_out_anom,
         "Mainly sends wallet / crypto money from script devices or foreign proxy IPs"),
        (v("ring_cycles") >= p.cycle_min_loops, p.floor_cycles, "Money went round the same ring of accounts repeatedly"),
        (v("fanin_drains") >= 1 and v("fanin_drain_share") >= p.drain_min_share, p.floor_fanin_drain,
         "Collected from many senders within an hour, then emptied within 15 minutes"),
        ((v("term_out_n") >= 1 or v("term_in_n") >= 1) and g4 >= p.term_linked_min, p.floor_term_linked,
         "Uses a cash-out channel and at least half its money is from or to suspect accounts"),
    ]
    fired = [(floor, why) for ok, floor, why in rules if ok]
    return max(fired, key=lambda x: x[0]) if fired else None


def explain(con: duckdb.DuckDBPyConnection, account: str, p: DetectParams | None = None) -> ScoreExplain | None:
    p = p or DetectParams()
    row = con.execute("SELECT r.acct_id, r.score FROM risk r WHERE r.account = ?", [account]).fetchone()
    if row is None:
        return None
    acct_id, stored = int(row[0]), int(row[1])
    cur = con.execute("SELECT * FROM features WHERE acct_id = ?", [acct_id])
    names = [d[0] for d in cur.description]
    f = {k: np.asarray([val]) for k, val in zip(names, cur.fetchone())}
    s = _signals(f, p)
    s["G4"] = np.maximum(f.get("in_from_flagged", np.zeros(1)), f.get("out_to_flagged", np.zeros(1))).astype(float)
    parts = [(getattr(p, w), s[g]) for _, _, w, g in CHECKS]
    combined = int(np.rint(_noisy_or(parts))[0])
    final = int(np.clip(np.rint(_floors(_noisy_or(parts), f, p, s["G4"])), 0, 100)[0])
    floor = _floor_reason(f, float(s["G4"][0]), p)
    checks = [ScoreCheck(key=k, label=label, max_points=round(100 * getattr(p, w)),
                         points=round(100 * getattr(p, w) * float(np.clip(s[g][0], 0, 1))), detail=_detail(k, f, s))
              for k, label, w, g in CHECKS]
    return ScoreExplain(account=account, score=stored, combined=combined,
                        floor=floor[0] if floor and floor[0] > combined else None,
                        floor_reason=floor[1] if floor and floor[0] > combined else None,
                        checks=checks, matches_stored=final == stored)
