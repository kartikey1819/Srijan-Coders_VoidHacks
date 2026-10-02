"""Command line: `python -m abhedya ingest --data <csv>` and `python -m abhedya serve [--data <csv>]`. Owner: A.

`serve --data file.csv` is the one-command start: it ingests the file first when there is no database yet or
the database was built from a different file (checked by SHA-256), then starts the local web app.
"""
import argparse
from pathlib import Path

from abhedya import config


def _needs_ingest(csv: Path, db: Path) -> str | None:
    """Why the database must be (re)built for this CSV, or None if it is current."""
    if not db.exists():
        return "no database yet"
    import duckdb

    from abhedya.audit.log import sha256_file
    try:
        con = duckdb.connect(str(db), read_only=True)
        built_from = dict(con.execute("SELECT key, value FROM meta").fetchall()).get("input_sha256")
        has_risk = con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'risk'").fetchone()[0]
        con.close()
    except duckdb.Error:
        return "database unreadable"
    if built_from != sha256_file(csv):
        return "database was built from a different file"
    if not has_risk:
        return "risk scores missing"
    return None


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="abhedya", description="Offline money-mule investigation workstation")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="load + validate + index a transaction CSV, then run detection")
    ing.add_argument("--data", type=Path, default=config.DEFAULT_CSV)
    ing.add_argument("--db", type=Path, default=config.DB_PATH)
    ing.add_argument("--skip-detect", action="store_true")
    srv = sub.add_parser("serve", help="start the local web app on 127.0.0.1 (ingests --data first if needed)")
    srv.add_argument("--data", type=Path, help="transaction CSV; ingested automatically when the database is missing or stale")
    srv.add_argument("--port", type=int, default=8000)
    srv.add_argument("--db", type=Path, default=config.DB_PATH)
    a = ap.parse_args(argv)

    from abhedya.ingest.load import IngestError
    from abhedya.ingest.pipeline import run_ingest
    if a.cmd == "ingest":
        try:
            run_ingest(a.data, a.db, run_detect=not a.skip_detect)
        except (IngestError, FileNotFoundError) as e:
            raise SystemExit(f"ingest failed: {e}")
    elif a.cmd == "serve":
        import os

        import uvicorn
        if a.data is not None:
            if not a.data.exists():
                raise SystemExit(f"serve failed: {a.data} not found")
            from abhedya.audit.log import sha256_file
            from abhedya.datasets import removed_official_sha
            gone = removed_official_sha()
            if gone and gone == sha256_file(a.data):
                reason = None
                print(f"{a.data.name} was removed from Saved cases, so it is not rebuilt; upload it on Home to bring it back")
            else:
                reason = _needs_ingest(a.data, a.db)
            if reason:
                print(f"preparing {a.data.name} ({reason})")
                try:
                    run_ingest(a.data, a.db, run_detect=True)
                except IngestError as e:
                    raise SystemExit(f"ingest failed: {e}")
        elif not a.db.exists() and not any(config.DATA_DIR.glob("datasets/*/case.duckdb")):
            raise SystemExit(f"no database at {a.db}: run `python -m abhedya serve --data <file.csv>`")
        if not (config.WEB_DIST / "index.html").exists():
            print("note: the web UI is not built (cd web && npm install && npm run build); the API still works")
        print(f"Abhedya-Chakra on http://127.0.0.1:{a.port}  (offline; Ctrl+C to stop)")
        os.environ["ABHEDYA_DB"] = str(a.db)
        # one worker: DuckDB allows a single process per database file
        uvicorn.run("abhedya.api.app:app", host="127.0.0.1", port=a.port, workers=1, log_level="warning")
