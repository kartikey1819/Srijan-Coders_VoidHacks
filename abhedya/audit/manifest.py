"""Run manifest: what was ingested, by which code, with what result. Owner: A."""
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import orjson

from abhedya import config
from abhedya.audit.log import sha256_bytes


def git_commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=config.ROOT, capture_output=True,
                              text=True, timeout=5).stdout.strip() or None
    except Exception:
        return None


def write_manifest(info: dict, path: Path = config.MANIFEST_PATH) -> str:
    import duckdb
    import numpy

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "python": sys.version.split()[0],
        "duckdb": duckdb.__version__,
        "numpy": numpy.__version__,
        "platform": platform.platform(),
        **info,
    }
    data = orjson.dumps(manifest, option=orjson.OPT_INDENT_2 | orjson.OPT_SORT_KEYS, default=str)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return sha256_bytes(data)
