"""Benchmark harness -> bench/results.md + bench/results.json. Owner: A.

Usage: python bench/run.py [--data data/VoidHacks8_MuleAccount_2M_Transactions.csv] [--runs 5]

Every measured run is a fresh Python process (so each run pays its own imports and cold caches inside the
process, and its peak memory is its own). The operating system's file cache is NOT flushed between runs:
"cold" below means a new process, not a cold disk. Builds its own database (data/bench.duckdb) so a
running server is not disturbed. Only numbers produced here may be quoted.

  Test 1  ingest + index        (CSV -> validated tables -> graph arrays)        budget 60 s
  Test 2  detection             (features + risk for every account, on Test 1's tables)
  Test 3  complete pipeline     (Test 1 + Test 2 in one process)                 budget 60 s
  Test 4  investigation queries (engine load, first and warm trace, account, ring, documents, HTTP)
"""
import argparse
import json
import os
import platform
import random
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from abhedya import config  # noqa: E402

DB = config.DATA_DIR / "bench.duckdb"


# ---------------------------------------------------------------- helpers

def peak_mb() -> float:
    """Peak resident memory of this process so far (exact, from the OS, not sampled)."""
    import psutil
    mi = psutil.Process().memory_info()
    if hasattr(mi, "peak_wset"):  # Windows
        return mi.peak_wset / 2**20
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**10


def ms(fn, *args, **kw) -> tuple[float, object]:
    t0 = time.perf_counter()
    out = fn(*args, **kw)
    return (time.perf_counter() - t0) * 1000, out


def pct(xs: list[float]) -> dict[str, float]:
    xs = sorted(xs)
    q = lambda p: xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]  # noqa: E731
    return {"n": len(xs), "min": xs[0], "p50": q(0.50), "p95": q(0.95), "max": xs[-1]}


def mmm(xs: list[float]) -> str:
    return f"{min(xs):.2f} / {statistics.median(xs):.2f} / {max(xs):.2f}"


def cpu_name() -> str:
    if sys.platform == "win32":
        try:
            import winreg
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            return winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    return platform.processor() or platform.machine()


# ---------------------------------------------------------------- workers (each runs in its own process)

def w_ingest(data: Path) -> dict:
    from abhedya.ingest.pipeline import run_ingest
    info = run_ingest(data, DB, run_detect=False)
    return {"total_s": info["ingest_total_s"], "stages": info["timings_s"], "rows": info["rows"],
            "accounts": info["accounts"], "peak_mb": peak_mb()}


def w_detect(_: Path) -> dict:
    import duckdb

    from abhedya import detect
    con = duckdb.connect(str(DB))
    threads = con.execute("SELECT current_setting('threads')").fetchone()[0]
    t0 = time.perf_counter()
    d = detect.run(con)
    total = time.perf_counter() - t0
    con.close()
    return {"total_s": round(total, 3), "stages": d["timings_s"], "bands": d["bands"], "accounts": d["accounts"],
            "duckdb_threads": threads, "peak_mb": peak_mb()}


def w_pipeline(data: Path) -> dict:
    from abhedya.ingest.pipeline import run_ingest
    t0 = time.perf_counter()
    info = run_ingest(data, DB, run_detect=True)
    return {"total_s": round(time.perf_counter() - t0, 3), "ingest_s": info["ingest_total_s"],
            "detect_s": info["timings_s"]["detect"], "bands": info["detect"]["bands"], "peak_mb": peak_mb()}


def w_query(_: Path) -> dict:
    import numpy as np

    from abhedya.ai import narrator
    from abhedya.ai.fallback import fallback_narrative
    from abhedya.ai.validator import validate_narrative
    from abhedya.docs.render import render_case
    from abhedya.engine import Engine
    from abhedya.evidence.build import build_evidence
    from contracts.models import CaseInfo

    load_ms, e = ms(Engine, DB)
    cur = e.cursor()
    victims = [r[0] for r in cur.execute(
        "SELECT DISTINCT sender FROM txn WHERE narr_category = 'task_refund' ORDER BY 1").fetchall()]
    rng = random.Random(8)
    first_trace_ms, _t = ms(e.trace, victims[0])            # cold: first query in this process
    lat: dict[str, list[float]] = {k: [] for k in (
        "trace (4 hops): 300 victims", "trace: 200 random accounts as 'victim'",
        "trace: 50 busiest accounts as 'victim'", "account summary: 200 random", "account txns (200 rows): 200 random",
        "ring isolation from a victim's L1: 20 victims", "evidence + diary + bank notices (templates): 20 victims",
        "validator on a full narrative: 20 victims", "AI unavailable -> template fallback: 5 victims",
        "full investigation (trace + every trail account + ring + documents): 20 victims")}
    for v in victims:
        lat["trace (4 hops): 300 victims"].append(ms(e.trace, v)[0])
    deg = np.diff(e.g.out["ptr"])
    busiest = [str(e.g.accounts[u]) for u in np.argsort(-deg)[:50]]
    randoms = [str(e.g.accounts[u]) for u in rng.sample(range(e.g.V), 200)]
    for v in randoms:
        lat["trace: 200 random accounts as 'victim'"].append(ms(e.trace, v)[0])
    for v in busiest:
        lat["trace: 50 busiest accounts as 'victim'"].append(ms(e.trace, v)[0])
    for v in randoms:
        lat["account summary: 200 random"].append(ms(e.account, v)[0])
        lat["account txns (200 rows): 200 random"].append(ms(e.account_txns, v)[0])

    narrator.OLLAMA_URL = "http://127.0.0.1:9"  # nothing listens here: measures the fallback path
    out_root = Path(tempfile.mkdtemp(prefix="abhedya_bench_"))
    case = CaseInfo(use_llm=False)
    sample = rng.sample(victims, 20)
    for i, v in enumerate(sample):
        t_all = time.perf_counter()
        tr = e.trace(v)
        for n in tr.nodes:
            e.account(n.account)
        l1 = next(n.account for n in tr.nodes if n.role == "L1")
        lat["ring isolation from a victim's L1: 20 victims"].append(ms(e.ring, l1)[0])

        def docs():
            ev = build_evidence(tr, e.txns([x.txn_idx for x in tr.edges]), case)
            nar = fallback_narrative(ev)
            render_case(ev, nar, out_root / ev.case_id, "templates (benchmark)", False, "benchmark")
            return ev, nar
        t_docs, (ev, nar) = ms(docs)
        lat["evidence + diary + bank notices (templates): 20 victims"].append(t_docs)
        lat["full investigation (trace + every trail account + ring + documents): 20 victims"].append(
            (time.perf_counter() - t_all) * 1000)
        lat["validator on a full narrative: 20 victims"].append(ms(validate_narrative, nar, ev)[0])
        if i < 5:
            lat["AI unavailable -> template fallback: 5 victims"].append(ms(narrator.narrate_with_status, ev)[0])
    e.con.close()
    return {"engine_load_ms": load_ms, "first_trace_ms": first_trace_ms, "lat": {k: pct(v) for k, v in lat.items()},
            "victims": victims, "randoms": randoms, "peak_mb": peak_mb()}


def w_http(victims_file: Path) -> dict:
    import httpx
    victims, randoms = json.loads(victims_file.read_text())
    port = 8019
    env = dict(os.environ, ABHEDYA_DB=str(DB), ABHEDYA_OLLAMA_URL="http://127.0.0.1:9")
    t0 = time.perf_counter()
    srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "abhedya.api.app:app", "--host", "127.0.0.1",
                            "--port", str(port), "--workers", "1", "--log-level", "warning"], cwd=ROOT, env=env)
    out: dict = {}
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=60) as c:
            while True:
                try:
                    c.get("/api/health").raise_for_status()
                    break
                except httpx.TransportError:
                    if time.perf_counter() - t0 > 120:
                        raise
                    time.sleep(0.05)
            out["server_ready_ms"] = (time.perf_counter() - t0) * 1000
            out["first_trace_ms"] = ms(lambda: c.get(f"/api/trace/{victims[0]}").raise_for_status())[0]
            lat = {
                "GET /api/trace: 300 victims": [ms(lambda: c.get(f"/api/trace/{v}").raise_for_status())[0]
                                                for v in victims],
                "GET /api/account: 200 random": [ms(lambda: c.get(f"/api/account/{v}").raise_for_status())[0]
                                                 for v in randoms],
                "GET /api/risk/top (HIGH, 500 rows): 20": [ms(lambda: c.get("/api/risk/top?band=HIGH&limit=500")
                                                              .raise_for_status())[0] for _ in range(20)],
                "POST /api/docs (AI off): 10 victims": [ms(lambda: c.post(f"/api/docs/{v}", json={"use_llm": False})
                                                           .raise_for_status())[0] for v in victims[:10]],
                "POST /api/docs (AI on, model unreachable): 5 victims": [
                    ms(lambda: c.post(f"/api/docs/{v}", json={"use_llm": True}).raise_for_status())[0]
                    for v in victims[10:15]],
            }
            out["lat"] = {k: pct(v) for k, v in lat.items()}
    finally:
        srv.terminate()
        srv.wait(10)
    return out


WORKERS = {"ingest": w_ingest, "detect": w_detect, "pipeline": w_pipeline, "query": w_query, "http": w_http}


def spawn(kind: str, arg: Path) -> dict:
    """Runs one worker in a fresh interpreter; returns its JSON plus the wall time including interpreter start."""
    t0 = time.perf_counter()
    p = subprocess.run([sys.executable, __file__, "--worker", kind, "--data", str(arg)], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8")
    wall = time.perf_counter() - t0
    if p.returncode:
        sys.stderr.write(p.stdout + p.stderr)
        raise SystemExit(f"{kind} worker failed")
    res = json.loads(p.stdout.strip().splitlines()[-1])
    res["process_wall_s"] = round(wall, 3)
    print(f"  {kind:<9} {res.get('total_s', '')!s:>8}  wall {wall:6.2f} s  peak {res['peak_mb'] if 'peak_mb' in res else 0:.0f} MB",
          flush=True)
    return res


def lat_rows(d: dict) -> list[str]:
    return [f"| {k} | {s['n']} | {s['min']:.1f} | {s['p50']:.1f} | {s['p95']:.1f} | {s['max']:.1f} |"
            for k, s in d.items()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=config.DEFAULT_CSV)
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--worker", choices=WORKERS)
    a = ap.parse_args()
    if a.worker:
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):  # stage prints would corrupt the JSON line
            res = WORKERS[a.worker](a.data)
        print(json.dumps(res))
        return

    import duckdb
    import numpy as np
    import psutil
    data = a.data.resolve()
    print(f"Test 1: ingest + index x{a.runs}")
    t1 = [spawn("ingest", data) for _ in range(a.runs)]
    print(f"Test 3: complete pipeline x{a.runs}")
    t3 = [spawn("pipeline", data) for _ in range(a.runs)]
    print(f"Test 2: detection x{a.runs} (on the pipeline's tables)")
    t2 = [spawn("detect", data) for _ in range(a.runs)]
    print("Test 4: investigation queries x3 (fresh process each)")
    t4 = [spawn("query", data) for _ in range(3)]
    vf = Path(tempfile.mkdtemp()) / "victims.json"
    vf.write_text(json.dumps([t4[0]["victims"], t4[0]["randoms"]]))
    print("Test 4b: over HTTP on a real server")
    th = spawn("http", vf)

    vm = psutil.virtual_memory()
    rows, accounts = t1[0]["rows"], t1[0]["accounts"]
    stage_names = list(t1[0]["stages"])
    det_names = list(t2[0]["stages"])
    q = t4[-1]
    lines = [
        "# Benchmark results",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `bench/run.py --runs {a.runs}`. Only these numbers may "
        "be quoted. Every run is a fresh Python process; min / median / max are over those runs. The OS file "
        "cache is not flushed between runs (a first-ever read from disk can be slower).",
        "",
        "## Machine",
        f"- OS: {platform.platform()}",
        f"- CPU: {cpu_name()} ({psutil.cpu_count(logical=False)} cores / {psutil.cpu_count()} threads); "
        f"DuckDB threads: {t2[0]['duckdb_threads']}; the Python feature loops are single-threaded",
        f"- RAM: {vm.total / 2**30:.1f} GB",
        f"- Python {platform.python_version()}, DuckDB {duckdb.__version__}, NumPy {np.__version__}",
        f"- Input: `{data.name}` ({data.stat().st_size / 2**20:.0f} MB, {rows:,} rows, {accounts:,} accounts)",
        "",
        "## Summary (requirement: 2M transactions ingested and indexed in <= 60 s on 16 GB RAM)",
        "| Test | min / median / max (s) | process wall incl. Python start, median (s) | peak memory, max (MB) |",
        "|---|---|---|---|",
        f"| 1. Ingest + index | {mmm([r['total_s'] for r in t1])} | "
        f"{statistics.median(r['process_wall_s'] for r in t1):.2f} | {max(r['peak_mb'] for r in t1):.0f} |",
        f"| 2. Detection (all accounts) | {mmm([r['total_s'] for r in t2])} | "
        f"{statistics.median(r['process_wall_s'] for r in t2):.2f} | {max(r['peak_mb'] for r in t2):.0f} |",
        f"| 3. Complete pipeline (1 + 2) | {mmm([r['total_s'] for r in t3])} | "
        f"{statistics.median(r['process_wall_s'] for r in t3):.2f} | {max(r['peak_mb'] for r in t3):.0f} |",
        f"| 4. Engine load (cold start of the query side) | "
        f"{mmm([r['engine_load_ms'] / 1000 for r in t4])} | - | {max(r['peak_mb'] for r in t4):.0f} |",
        "",
        f"Detection result (every run identical): {t2[0]['bands']} of {t2[0]['accounts']:,} accounts.",
        "",
        "## Test 1: ingest + index, per stage (s)",
        "| Stage | min | median | max |",
        "|---|---|---|---|",
        *[f"| {s} | {min(r['stages'][s] for r in t1):.2f} | {statistics.median(r['stages'][s] for r in t1):.2f} | "
          f"{max(r['stages'][s] for r in t1):.2f} |" for s in stage_names],
        "",
        "## Test 2: detection, per stage (s)",
        "| Stage | min | median | max |",
        "|---|---|---|---|",
        *[f"| {s.strip() if s.startswith(' ') else s}{' (part of features)' if s.startswith(' ') else ''} | "
          f"{min(r['stages'][s] for r in t2):.2f} | {statistics.median(r['stages'][s] for r in t2):.2f} | "
          f"{max(r['stages'][s] for r in t2):.2f} |" for s in det_names],
        "",
        "## Test 3: complete pipeline split (s)",
        "| Part | min / median / max |",
        "|---|---|",
        f"| ingest + index | {mmm([r['ingest_s'] for r in t3])} |",
        f"| detection | {mmm([r['detect_s'] for r in t3])} |",
        "",
        "## Test 4: investigation (requirement: 4-hop trace <= 2 s)",
        f"Cold start, fresh process: engine load {mmm([r['engine_load_ms'] / 1000 for r in t4])} s; "
        f"first trace {mmm([r['first_trace_ms'] for r in t4])} ms. "
        f"HTTP server start to first answer: {th['server_ready_ms'] / 1000:.2f} s; first HTTP trace "
        f"{th['first_trace_ms']:.1f} ms. Warm latencies below are from the last of the 3 query processes.",
        "",
        "| Operation | n | min | p50 | p95 | max (ms) |",
        "|---|---|---|---|---|---|",
        *lat_rows(q["lat"]),
        "",
        "### Over HTTP (uvicorn, 1 worker, AI model unreachable)",
        "| Operation | n | min | p50 | p95 | max (ms) |",
        "|---|---|---|---|---|---|",
        *lat_rows(th["lat"]),
        "",
        "Live AI model latency is measured separately by `bench/llm_check.py` (see `bench/llm_results.md`).",
        "",
    ]
    (ROOT / "bench" / "results.md").write_text("\n".join(lines), encoding="utf-8")
    for r in t4:
        r.pop("victims"), r.pop("randoms")
    (ROOT / "bench" / "results.json").write_text(json.dumps(
        {"ingest": t1, "detect": t2, "pipeline": t3, "query": t4, "http": th}, indent=1), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
