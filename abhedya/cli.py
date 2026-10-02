"""Command line: `python -m abhedya ingest --data <csv>` and `python -m abhedya serve`. Owner: A."""
import argparse
from pathlib import Path

from abhedya import config


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="abhedya", description="Offline money-mule investigation workstation")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="load + validate + index a transaction CSV, then run detection")
    ing.add_argument("--data", type=Path, default=config.DEFAULT_CSV)
    ing.add_argument("--db", type=Path, default=config.DB_PATH)
    ing.add_argument("--skip-detect", action="store_true")
    srv = sub.add_parser("serve", help="start the local web app on 127.0.0.1")
    srv.add_argument("--port", type=int, default=8000)
    srv.add_argument("--db", type=Path, default=config.DB_PATH)
    a = ap.parse_args(argv)

    if a.cmd == "ingest":
        from abhedya.ingest.load import IngestError
        from abhedya.ingest.pipeline import run_ingest
        try:
            run_ingest(a.data, a.db, run_detect=not a.skip_detect)
        except (IngestError, FileNotFoundError) as e:
            raise SystemExit(f"ingest failed: {e}")
    elif a.cmd == "serve":
        import os

        import uvicorn
        os.environ["ABHEDYA_DB"] = str(a.db)
        # one worker: DuckDB allows a single process per database file
        uvicorn.run("abhedya.api.app:app", host="127.0.0.1", port=a.port, workers=1)
