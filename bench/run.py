"""Benchmark harness -> bench/results.md. Owner: A.

Usage: python bench/run.py [--data data/VoidHacks8_MuleAccount_2M_Transactions.csv] [--runs 3]
Builds its own database (data/bench.duckdb) so a running server is not disturbed.
Only numbers produced here may be quoted in the demo.
"""
import argparse
import os
import platform
import random
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
import psutil

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from abhedya import config  # noqa: E402
from abhedya.engine import Engine  # noqa: E402
from abhedya.ingest.pipeline import run_ingest  # noqa: E402


class PeakRSS:
    """Samples this process's resident memory every 100 ms."""

    def __init__(self):
        self.proc, self.peak, self._stop = psutil.Process(), 0, threading.Event()

    def __enter__(self):
        self.peak = self.proc.memory_info().rss
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        return self

    def _run(self):
        while not self._stop.wait(0.1):
            self.peak = max(self.peak, self.proc.memory_info().rss)

    def __exit__(self, *exc):
        self._stop.set()
        self._t.join()


def pct(xs: list[float]) -> dict[str, float]:
    xs = sorted(xs)
    q = lambda p: xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]  # noqa: E731
    return {"n": len(xs), "p50": q(0.50), "p95": q(0.95), "p99": q(0.99), "max": xs[-1]}


def timed(fn, items) -> list[float]:
    out = []
    for it in items:
        t0 = time.perf_counter()
        fn(it)
        out.append((time.perf_counter() - t0) * 1000)
    return out


def row(name: str, s: dict, unit: str = "ms") -> str:
    return f"| {name} | {s['n']} | {s['p50']:.1f} | {s['p95']:.1f} | {s['p99']:.1f} | {s['max']:.1f} | {unit} |"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=config.DEFAULT_CSV)
    ap.add_argument("--runs", type=int, default=3)
    a = ap.parse_args()
    db = config.DATA_DIR / "bench.duckdb"

    # 1. ingest + index (budget: 60 s), peak memory
    ingest = []
    for i in range(a.runs):
        with PeakRSS() as mem:
            info = run_ingest(a.data, db, run_detect=False)
        ingest.append((info["ingest_total_s"], info["timings_s"], mem.peak))
    best = min(ingest, key=lambda x: x[0])

    # 2. in-process latency
    e = Engine(db)
    rng = random.Random(8)
    cur = e.cursor()
    victims = [r[0] for r in cur.execute("SELECT DISTINCT sender FROM txn WHERE narr_category = 'task_refund'")
               .fetchall()]
    deg = np.diff(e.g.out["ptr"])
    busiest = [str(e.g.accounts[u]) for u in np.argsort(-deg)[:50]]
    randoms = [str(e.g.accounts[u]) for u in rng.sample(range(e.g.V), 200)]
    for x in victims[:5]:
        e.trace(x)  # warm-up
    lat = {
        "trace: 300 victims": pct(timed(e.trace, victims)),
        "trace: 200 random accounts as 'victim'": pct(timed(e.trace, randoms)),
        "trace: 50 busiest accounts as 'victim'": pct(timed(e.trace, busiest)),
        "account summary: 200 random": pct(timed(e.account, randoms)),
        "account txns (200 rows): 200 random": pct(timed(e.account_txns, randoms)),
        "ring isolation from a victim: 10 runs": pct(timed(e.ring, [victims[0]] * 10)),
    }
    e.con.close()

    # 3. end-to-end over HTTP on a real server
    port = 8019
    env = dict(os.environ, ABHEDYA_DB=str(db))
    srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "abhedya.api.app:app", "--host", "127.0.0.1",
                            "--port", str(port), "--workers", "1", "--log-level", "warning"], cwd=ROOT, env=env)
    try:
        import httpx
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as c:
            for _ in range(100):
                try:
                    c.get("/api/health")
                    break
                except httpx.TransportError:
                    time.sleep(0.2)
            c.get(f"/api/trace/{victims[0]}")
            lat["HTTP GET /api/trace: 300 victims"] = pct(timed(lambda v: c.get(f"/api/trace/{v}").raise_for_status(),
                                                               victims))
            lat["HTTP GET /api/account: 200 random"] = pct(timed(
                lambda v: c.get(f"/api/account/{v}").raise_for_status(), randoms))
    finally:
        srv.terminate()
        srv.wait(10)

    vm = psutil.virtual_memory()
    lines = [
        "# Benchmark results",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `bench/run.py`. Only these numbers may be quoted.",
        "",
        "## Machine",
        f"- OS: {platform.platform()}",
        f"- CPU: {platform.processor() or platform.machine()} ({psutil.cpu_count(logical=False)} cores / "
        f"{psutil.cpu_count()} threads)",
        f"- RAM: {vm.total / 2**30:.1f} GB",
        f"- Python {platform.python_version()}, DuckDB {__import__('duckdb').__version__}, "
        f"NumPy {np.__version__}",
        f"- Input: `{a.data.name}` ({a.data.stat().st_size / 2**20:.0f} MB, {info['rows']:,} rows)",
        "",
        "## Ingest + index (requirement: <= 60 s for 2M rows on 16 GB)",
        f"Runs: {', '.join(f'{x[0]:.2f} s' for x in ingest)}. Best: **{best[0]:.2f} s**. "
        f"Peak process memory: **{max(x[2] for x in ingest) / 2**20:.0f} MB**.",
        "",
        "| Stage | Seconds (best run) |",
        "|---|---|",
        *[f"| {k} | {v:.2f} |" for k, v in best[1].items()],
        "",
        "## Latency (requirement: 4-hop trace <= 2 s)",
        "| Operation | n | p50 | p95 | p99 | max | unit |",
        "|---|---|---|---|---|---|---|",
        *[row(k, v) for k, v in lat.items()],
        "",
    ]
    out = ROOT / "bench" / "results.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
