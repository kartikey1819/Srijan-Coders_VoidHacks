"""Run the engine on independent scenario worlds and score it against the scenario labels.

Usage: python -m tests.adversarial_data.evaluate [--seeds 1-20] [--size small] [--vocab dev] [--out reports/x.md]
Never imported by abhedya/. HIGH band = flagged.
"""
from __future__ import annotations

import argparse
import json
import statistics as st
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path

import duckdb

from abhedya import config
from abhedya.engine import Engine
from abhedya.ingest.pipeline import run_ingest
from tests.adversarial_data.generator import build

ROOT = Path(__file__).resolve().parents[2]


def run_world(seed: int, size: str, vocab: str, work: Path) -> dict:
    w = build(seed, size, vocab)
    csv_path, truth_path = w.write(work, f"{vocab}_{size}_{seed}")
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    db = work / f"{vocab}_{size}_{seed}.duckdb"
    t0 = time.perf_counter()
    info = run_ingest(csv_path, db, run_detect=True)
    t_pipeline = time.perf_counter() - t0
    con = duckdb.connect(str(db), read_only=True)
    risk = {a: (s, b, r) for a, s, b, r in con.execute("SELECT account, score, band, role_hint FROM risk").fetchall()}
    con.close()
    res: dict = {"seed": seed, "size": size, "vocab": vocab, "rows": info["rows"],
                 "pipeline_s": round(t_pipeline, 2), "tiers": defaultdict(lambda: [0, 0]),
                 "families": defaultdict(lambda: [0, 0]), "fp": [], "problems": []}
    for a, lab in truth["accounts"].items():
        score, band, _ = risk.get(a, (None, None, None))
        if score is None:
            if lab["label"] == "mule":
                res["problems"].append(f"mule {a} has no risk row")
            continue
        if not 0 <= score <= 100:
            res["problems"].append(f"score out of range for {a}: {score}")
        flagged = band == "HIGH"
        if lab["tier"] != "NONE":
            res["tiers"][lab["tier"]][0] += flagged
            res["tiers"][lab["tier"]][1] += 1
            key = f"{lab['label']}:{lab['family']}"
            res["families"][key][0] += flagged
            res["families"][key][1] += 1
        if lab["tier"] == "MUST_NOT_FLAG" and flagged:
            res["fp"].append((a, lab["family"], score))
    # victim traces (from the disputed transfer)
    eng = Engine(db)
    tr_stats = []
    for v, t in truth["victims"].items():
        r = eng.trace(v, seed_txns={t["seed_txn"]})
        held = sum(n.held_paise for n in r.nodes)
        if held != r.loss_paise:
            res["problems"].append(f"conservation broken for victim {v}: held {held} != loss {r.loss_paise}")
        got = {k: {n.account for n in r.nodes if n.role == k} for k in ("L1", "L2", "L3")}
        everyone = got["L1"] | got["L2"] | got["L3"]
        true_all = set(t["L1"]) | set(t["L2"]) | set(t["L3"])
        tr_stats.append({"l1_ok": set(t["L1"]) <= got["L1"],
                         "recall": len(true_all & everyone) / len(true_all),
                         "precision": len(true_all & everyone) / len(everyone) if everyone else 1.0,
                         "ms": r.elapsed_ms, "family": t["family"]})
    eng.con.close()
    res["trace"] = {"victims": len(tr_stats), "l1_found": sum(x["l1_ok"] for x in tr_stats),
                    "recall_mean": round(st.mean(x["recall"] for x in tr_stats), 3) if tr_stats else None,
                    "precision_mean": round(st.mean(x["precision"] for x in tr_stats), 3) if tr_stats else None,
                    "max_ms": max((x["ms"] for x in tr_stats), default=0)}
    res["tiers"], res["families"] = dict(res["tiers"]), dict(res["families"])
    return res


def summarize(results: list[dict]) -> str:
    tiers, fams = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    fps: Counter = Counter()
    problems = [p for r in results for p in r["problems"]]
    for r in results:
        for k, (a, b) in r["tiers"].items():
            tiers[k][0] += a
            tiers[k][1] += b
        for k, (a, b) in r["families"].items():
            fams[k][0] += a
            fams[k][1] += b
        fps.update(f for _, f, _ in r["fp"])
    rate = lambda a, b: f"{a}/{b} ({100 * a / b:.1f}%)" if b else "-"  # noqa: E731
    L = [f"Worlds: {len(results)} ({', '.join(sorted({r['size'] for r in results}))}; vocab "
         f"{', '.join(sorted({r['vocab'] for r in results}))}; seeds {min(r['seed'] for r in results)}–"
         f"{max(r['seed'] for r in results)}), {sum(r['rows'] for r in results):,} rows in total.", "",
         "| Tier | Flagged HIGH | Meaning |", "|---|---|---|",
         f"| MUST_FLAG | {rate(*tiers['MUST_FLAG'])} | mules showing ≥ 2 statement indicators: higher is better |",
         f"| SHOULD_FLAG | {rate(*tiers['SHOULD_FLAG'])} | mules showing 1 indicator |",
         f"| EXPECTED_MISS | {rate(*tiers['EXPECTED_MISS'])} | "
         "mules showing none (cannot be found from the statement's signals) |",
         f"| MUST_NOT_FLAG | {rate(*tiers['MUST_NOT_FLAG'])} | "
         "legitimate accounts: **false positives**, lower is better |",
         f"| AMBIGUOUS | {rate(*tiers['AMBIGUOUS'])} | legitimate accounts showing ≥ 2 statement indicators |", "",
         "| Family | Flagged HIGH |", "|---|---|",
         *[f"| {k} | {rate(a, b)} |" for k, (a, b) in sorted(fams.items())], "",
         f"False positives by family: {dict(fps) or 'none'}", "",
         "Victim traces (from the disputed transfer): " + "; ".join(
             f"seed {r['seed']}: L1 {r['trace']['l1_found']}/{r['trace']['victims']}, "
             f"recall {r['trace']['recall_mean']}, precision {r['trace']['precision_mean']}"
             for r in results[:5]) + (" …" if len(results) > 5 else ""),
         f"Mean trace recall {st.mean(r['trace']['recall_mean'] for r in results):.3f}, mean precision "
         f"{st.mean(r['trace']['precision_mean'] for r in results):.3f}, L1 found "
         f"{sum(r['trace']['l1_found'] for r in results)}/{sum(r['trace']['victims'] for r in results)}, "
         f"slowest trace {max(r['trace']['max_ms'] for r in results)} ms.",
         f"Pipeline time per world: median {st.median(r['pipeline_s'] for r in results):.1f} s, max "
         f"{max(r['pipeline_s'] for r in results):.1f} s.", "",
         f"Invariant problems: {len(problems)}"
         + ("" if not problems else "\n" + "\n".join(f"- {p}" for p in problems[:20]))]
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="1-5")
    ap.add_argument("--size", default="small", choices=["small", "medium", "large"])
    ap.add_argument("--vocab", default="dev", choices=["dev", "holdout"])
    ap.add_argument("--out", type=Path)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    lo, _, hi = a.seeds.partition("-")
    seeds = list(range(int(lo), int(hi or lo) + 1))
    work = Path(tempfile.mkdtemp(prefix="advdata_", dir=ROOT / "testdata" if (ROOT / "testdata").exists() else None))
    config.AUDIT_LOG = work / "audit.jsonl"
    results = []
    for s in seeds:
        r = run_world(s, a.size, a.vocab, work)
        print(f"seed {s}: rows {r['rows']}, pipeline {r['pipeline_s']} s, tiers "
              f"{ {k: f'{x}/{y}' for k, (x, y) in r['tiers'].items()} }, "
              f"FP {len(r['fp'])}, problems {len(r['problems'])}", flush=True)
        results.append(r)
    text = summarize(results)
    print(text)
    if a.out:
        a.out.write_text(text + "\n", encoding="utf-8")
    if a.json:
        a.json.write_text(json.dumps(results, indent=1, default=list), encoding="utf-8")


if __name__ == "__main__":
    main()
