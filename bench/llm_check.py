"""Check the local AI narrator against the real model -> bench/llm_results.md.

Usage: python bench/llm_check.py [--n 10] [--model qwen2.5:3b] [--out bench/llm_results.md]
Needs Ollama running (ollama serve) with the model pulled, and an ingested data/case.duckdb.
"""
import argparse
import os
import platform
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _processor(url: str, model: str) -> str:
    """Where Ollama runs the model (GPU / CPU split), from /api/ps."""
    import httpx
    try:
        for m in httpx.get(f"{url}/api/ps", timeout=5).json().get("models", []):
            if m.get("name", "").startswith(model):
                vram, size = m.get("size_vram", 0), m.get("size", 1)
                return "GPU" if vram >= size else ("CPU" if not vram else f"{100 * vram // size}% GPU")
    except Exception:
        pass
    return "processor unknown"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--model", default=os.environ.get("ABHEDYA_LLM_MODEL", "qwen2.5:3b"))
    ap.add_argument("--out", type=Path, default=ROOT / "bench" / "llm_results.md")
    a = ap.parse_args()
    os.environ["ABHEDYA_LLM_MODEL"] = a.model

    import httpx

    from abhedya.ai import narrator
    from abhedya.ai.validator import validate_narrative
    from abhedya.engine import Engine
    from abhedya.evidence.build import build_evidence
    from contracts.models import CaseInfo

    narrator.MODEL = a.model
    e = Engine()
    victims = [r[0] for r in e.cursor().execute(
        "SELECT DISTINCT sender FROM txn WHERE narr_category = 'task_refund' ORDER BY 1").fetchall()]
    picks = random.Random(8).sample(victims, min(a.n, len(victims)))
    rows, sample = [], None
    for i, v in enumerate(picks):
        tr = e.trace(v)
        ev = build_evidence(tr, e.txns([x.txn_idx for x in tr.edges]), CaseInfo())
        t0 = time.perf_counter()
        with httpx.Client(base_url=narrator.OLLAMA_URL, timeout=narrator.TIMEOUT_S) as c:
            n, reason = narrator.narrate_with_status(ev, c)
        dt = time.perf_counter() - t0
        ok = n is not None and validate_narrative(n, ev) == []
        rows.append((v, ok, dt, reason, sum(len(s.paragraphs) for s in n.sections) if n else 0))
        print(f"{i + 1:>2}/{len(picks)} {v} {'OK ' if ok else 'FALLBACK'} {dt:6.1f}s {reason or ''}", flush=True)
        if ok and sample is None:
            sample = (v, n)
    ok_n = sum(1 for r in rows if r[1])
    warm = sorted(r[2] for r in rows[1:]) or [rows[0][2]]
    L = [
        "# Local AI narrator check", "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `bench/llm_check.py`. Model `{a.model}` via Ollama "
        f"({_processor(narrator.OLLAMA_URL, a.model)}) on {platform.processor() or platform.machine()}, "
        "temperature 0, bounded JSON schema output. The model writes summary, modus operandi and recommendation; "
        "layer and holding paragraphs come from templates.", "",
        f"- Accepted by the validator: **{ok_n} / {len(rows)}** victims (the rest use the template narrative; facts are identical either way)",
        f"- First call (model load included): {rows[0][2]:.1f} s",
        f"- Later calls: median {warm[len(warm) // 2]:.1f} s, max {warm[-1]:.1f} s", "",
        "| Victim | Result | Seconds | Note |", "|---|---|---|---|",
        *[f"| {v} | {'accepted' if ok else 'template fallback'} | {dt:.1f} | {reason or ''} |" for v, ok, dt, reason, _ in rows],
        "",
    ]
    if sample:
        L += [f"## Sample accepted narrative ({sample[0]})", ""]
        for s in sample[1].sections:
            for p in s.paragraphs:
                L.append(f"- **{s.section_id}**: {p.text} _(refs: {', '.join(p.refs) or 'none'})_")
        L.append("")
    a.out.write_text("\n".join(L), encoding="utf-8")
    print("\n".join(L[:9]))


if __name__ == "__main__":
    main()
