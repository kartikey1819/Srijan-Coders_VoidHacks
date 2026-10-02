"""`python -m abhedya ingest`: the ordered ingest pipeline (plan/00_OVERVIEW.md section 2.1). Owner: A."""
import time
from pathlib import Path

import duckdb
import orjson

from abhedya import config
from abhedya.audit import log as audit
from abhedya.audit.manifest import write_manifest
from abhedya.graph.build import build_arrays
from abhedya.ingest.derive import build_account, build_txn
from abhedya.ingest.load import build_account_map, load_raw, verify_row_order
from abhedya.ingest.validate import write_dq_summary


def cache_dir_for(db_path: Path, sha256: str) -> Path:
    return db_path.parent / "cache" / sha256[:16]


def run_ingest(csv_path: Path, db_path: Path = config.DB_PATH, run_detect: bool = True) -> dict:
    csv_path, db_path = Path(csv_path).resolve(), Path(db_path).resolve()
    if not csv_path.exists():
        raise FileNotFoundError(csv_path)
    for p in (db_path, db_path.with_suffix(".duckdb.wal")):
        if p.exists():
            p.unlink()  # fails loudly if a server still holds the database open
    db_path.parent.mkdir(parents=True, exist_ok=True)

    timings: dict[str, float] = {}
    info: dict = {}

    def stage(name, fn):
        t0 = time.perf_counter()
        out = fn()
        timings[name] = round(time.perf_counter() - t0, 3)
        print(f"  {name:<16} {timings[name]:>7.2f} s")
        return out

    print(f"ingest {csv_path.name}")
    con = duckdb.connect(str(db_path))
    sha = stage("hash", lambda: audit.sha256_file(csv_path))
    raw = stage("load_csv", lambda: load_raw(con, csv_path))
    stage("verify_order", lambda: verify_row_order(con, csv_path, raw["id_index"]))
    n_acct = stage("account_map", lambda: build_account_map(con))
    stage("derive+validate", lambda: build_txn(con))
    dq = stage("dq_summary", lambda: write_dq_summary(con))
    stage("account_table", lambda: build_account(con))
    con.execute("DROP TABLE txn_raw")
    con.execute("DROP TABLE acct_map")
    graph = stage("graph_arrays", lambda: build_arrays(con, cache_dir_for(db_path, sha)))
    ingest_total = round(sum(timings.values()), 3)
    print(f"  {'INGEST+INDEX':<16} {ingest_total:>7.2f} s   ({raw['rows']:,} rows, {n_acct:,} accounts)")

    detect_info = None
    if run_detect:
        from abhedya import detect
        from abhedya.detect.export import write_exports
        t0 = time.perf_counter()
        detect_info = detect.run(con)
        timings["detect"] = round(time.perf_counter() - t0, 3)
        detect_info["exports_sha256"] = write_exports(con, db_path.parent / "exports")
        print(f"  {'detect':<16} {timings['detect']:>7.2f} s   bands {detect_info['bands']}")

    info = {
        "input_file": csv_path.name,
        "input_sha256": sha,
        "rows": raw["rows"],
        "rejects": raw["rejects"],
        "extra_columns_ignored": raw["extra_columns"],
        "accounts": n_acct,
        "graph": graph,
        "dq_counts": dq,
        "timings_s": timings,
        "ingest_total_s": ingest_total,
        "detect": detect_info,
    }
    con.execute("CREATE OR REPLACE TABLE meta (key VARCHAR, value VARCHAR)")
    con.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("input_sha256", sha), ("input_file", csv_path.name), ("rows", str(raw["rows"])),
        ("accounts", str(n_acct)), ("timings_s", orjson.dumps(timings).decode()),
        ("ingest_total_s", str(ingest_total)), ("cache_dir", str(cache_dir_for(db_path, sha))), ("input_path", str(csv_path)),
    ])
    con.execute("CHECKPOINT")
    con.close()
    manifest_sha = write_manifest(info, db_path.with_name(db_path.stem + "_manifest.json"))
    audit.log("ingest", {"file": csv_path.name, "rows": raw["rows"]}, sha)
    info["manifest_sha256"] = manifest_sha
    return info
