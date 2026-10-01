"""Append-only JSONL audit log and file hashing. Owner: A."""
import hashlib
import threading
from datetime import datetime, timezone
from pathlib import Path

import orjson

from abhedya import config

_lock = threading.Lock()


def sha256_file(path: Path, chunk: int = 8 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while b := f.read(chunk):
            h.update(b)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def log(action: str, params: dict, result_sha256: str | None = None) -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "action": action,
        "params": params,
        "result_sha256": result_sha256,
    }
    line = orjson.dumps(entry, default=str) + b"\n"
    config.AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _lock, open(config.AUDIT_LOG, "ab") as f:
        f.write(line)
