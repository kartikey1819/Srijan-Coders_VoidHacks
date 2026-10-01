"""Evaluation report -> eval/report.md. Owner: B. Simulates the jury's precision/recall and blind-victim tests.

Usage: python -m eval.evaluate [--db data/case.duckdb] [--truth eval/ground_truth.json] [--out eval/report.md]
"""
import argparse
import json
import time
import zlib
from pathlib import Path

import duckdb

from abhedya.engine import Engine

ROOT = Path(__file__).resolve().parent.parent
STATEMENT_MULTS = 1500  # "1,500 ground-truth injected mule accounts" (problem statement)


def prf(pred: set[str], truth: set[str]) -> dict:
    tp = len(pred & truth)
    p = tp / len(pred) if pred else 0.0
    r = tp / len(truth) if truth else 0.0
    return {"tp": tp, "fp": len(pred - truth), "fn": len(truth - pred), "precision": p, "recall": r,
            "f1": 2 * p * r / (p + r) if p + r else 0.0}


def half(account: str) -> int:
    return zlib.crc32(account.encode()) % 2  # stable split (Python's hash() is randomised)


def evaluate(db: Path, truth_path: Path) -> tuple[str, dict]:
    gt = json.loads(truth_path.read_text(encoding="utf-8"))
    mules = set(gt["mules"])
    by_role = {r: set(v) for r, v in gt["mules_by_role"].items()}
    victims = set(gt["victims"])
    con = duckdb.connect(str(db), read_only=True)
    rows = con.execute("SELECT account, score, band, role_hint, array_to_string(reasons, ';') FROM risk").fetchall()
    score = {a: s for a, s, *_ in rows}
    info = {a: (s, b, rh, rs) for a, s, b, rh, rs in rows}
    meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    flagged = {a for a, (_, b, _, _) in info.items() if b == "HIGH"}

    m = prf(flagged, mules)
    role_recall = {r: len(flagged & s) / len(s) for r, s in by_role.items()}
    role_hint_ok = {r: sum(1 for a in s if info[a][2] == r) / len(s) for r, s in by_role.items()}
    halves = {h: prf({a for a in flagged if half(a) == h}, {a for a in mules if half(a) == h}) for h in (0, 1)}
    sweep = []
    for th in range(30, 95, 5):
        pr = prf({a for a, s in score.items() if s >= th}, mules)
        sweep.append((th, len({a for a, s in score.items() if s >= th}), pr))
    bands_victims = {}
    for v in victims:
        bands_victims[info[v][1]] = bands_victims.get(info[v][1], 0) + 1
    fps = sorted(flagged - mules, key=lambda a: -score[a])[:30]
    fns = sorted(mules - flagged, key=lambda a: -score[a])
    non_mule = sorted((score[a], a) for a in score if a not in mules and a not in victims)
    max_bg = non_mule[-1] if non_mule else (0, "-")
    min_mule = min((score[a], a) for a in mules)
    hist = {}
    for a, s in score.items():
        grp = "mule" if a in mules else "victim" if a in victims else "other"
        hist.setdefault(grp, [0] * 11)[min(s // 10, 10)] += 1

    # blind-victim simulation: trace every victim and compare layers with the ground truth
    eng = Engine(db)
    exact, fails, times = 0, [], []
    for v, t in gt["victims"].items():
        t0 = time.perf_counter()
        r = eng.trace(v)
        times.append((time.perf_counter() - t0) * 1000)
        got = {k: sorted(n.account for n in r.nodes if n.role == k) for k in ("L1", "L2", "L3")}
        txns = sorted(e.txn_idx for e in r.edges)
        if all(got[k] == t[k] for k in got) and txns == t["txn_idxs"]:
            exact += 1
        else:
            fails.append(v)
    times.sort()
    eng.con.close()

    res = {"metrics": m, "role_recall": role_recall, "trace_exact": exact, "victims": len(gt["victims"])}
    L = [
        "# Evaluation report",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `python -m eval.evaluate`. Data: `{meta.get('input_file')}` "
        f"(sha256 `{meta.get('input_sha256', '')[:16]}…`). Ground truth: `{truth_path.name}` "
        f"({len(mules):,} mules, {len(victims)} victims), built from the generator's own markers.",
        "",
        "## 1. Detection (jury criterion: precision and recall, 30%)",
        f"Flagged (band HIGH, score >= 70): **{len(flagged):,}** accounts.",
        "",
        "| Precision | Recall | F1 | TP | FP | FN |",
        "|---|---|---|---|---|---|",
        f"| **{m['precision']:.4f}** | **{m['recall']:.4f}** | {m['f1']:.4f} | {m['tp']} | {m['fp']} | {m['fn']} |",
        "",
        "Recall by layer and role-hint agreement:",
        "",
        "| Layer | Mules | Recall | Role hint correct |",
        "|---|---|---|---|",
        *[f"| {r} | {len(by_role[r])} | {role_recall[r]:.4f} | {role_hint_ok[r]:.4f} |" for r in ("L1", "L2", "L3")],
        "",
        f"- Lowest-scoring mule: {min_mule[1]} at {min_mule[0]}. Highest-scoring other (non-mule, non-victim) account: "
        f"{max_bg[1]} at {max_bg[0]}. **Score gap: {min_mule[0] - max_bg[0]} points.**",
        f"- Victims by band: {bands_victims} (victims are not mules; they score MEDIUM because their money went to suspects).",
        f"- Statement says 1,500 mules; this file contains {len(mules):,}. If the jury scores against 1,500, maximum "
        f"achievable recall is {len(mules) / STATEMENT_MULTS:.3f}. We do not pad the list.",
        "",
        "Stable 50/50 split (crc32 of account id): weights were set by hand and not fitted, so both halves are",
        "out-of-sample. They are reported to show the result does not depend on a lucky subset.",
        "",
        "| Half | Precision | Recall | TP | FP | FN |",
        "|---|---|---|---|---|---|",
        *[f"| {h} | {x['precision']:.4f} | {x['recall']:.4f} | {x['tp']} | {x['fp']} | {x['fn']} |" for h, x in halves.items()],
        "",
        "### Threshold sweep",
        "| Threshold | Flagged | Precision | Recall | F1 |",
        "|---|---|---|---|---|",
        *[f"| {th} | {n} | {x['precision']:.4f} | {x['recall']:.4f} | {x['f1']:.4f} |" for th, n, x in sweep],
        "",
        "### Score distribution (count per 10-point bucket, 0-9 … 100)",
        "| Group | " + " | ".join(f"{10 * i}" for i in range(11)) + " |",
        "|---|" + "---|" * 11,
        *[f"| {g} | " + " | ".join(str(c) for c in h) + " |" for g, h in sorted(hist.items())],
        "",
        "### False positives (top 30)",
        *([f"- {a}: {score[a]} ({info[a][3]})" for a in fps] or ["- none"]),
        "",
        "### False negatives",
        *([f"- {a}: {score[a]} ({info[a][3]})" for a in fns] or ["- none"]),
        "",
        "## 2. Blind-victim simulation (jury criterion: 40%)",
        f"Every victim traced with `Engine.trace`; layers and transactions compared with the ground truth.",
        "",
        f"- Exact match (same L1, L2, L3 accounts and the same transactions): **{exact} / {len(gt['victims'])}**",
        f"- Trace latency in-process: p50 {times[len(times) // 2]:.1f} ms, max {times[-1]:.1f} ms",
        *([f"- Failing victims: {', '.join(fails[:20])}"] if fails else []),
        "",
    ]
    return "\n".join(L), res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "case.duckdb")
    ap.add_argument("--truth", type=Path, default=ROOT / "eval" / "ground_truth.json")
    ap.add_argument("--out", type=Path, default=ROOT / "eval" / "report.md")
    a = ap.parse_args()
    text, res = evaluate(a.db, a.truth)
    a.out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
