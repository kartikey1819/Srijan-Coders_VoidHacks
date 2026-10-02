"""Saved datasets: every uploaded CSV becomes its own case (source kept byte for byte, own database).

The official file is dataset `official` (the database the server was started with). Uploads are analysed one at a
time in a background thread by the unchanged `run_ingest`; progress is reported per stage. Activating a dataset
swaps the engine the API uses. Nothing is ever overwritten.
"""
from __future__ import annotations

import hashlib
import json
import os
import queue
import shutil
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from abhedya import config
from abhedya import engine as engine_mod
from abhedya.ingest.load import REQUIRED_COLUMNS
from contracts.models import DatasetInfo, DatasetProgress

DIR = config.DATA_DIR / "datasets"
MAX_BYTES = 1 << 30                      # 1 GB upload cap
STAGES = ("hash", "load_csv", "verify_order", "account_map", "derive+validate", "dq_summary", "account_table",
          "graph_arrays", "detect")

_lock = threading.Lock()
_progress: dict[str, DatasetProgress] = {}
_jobs: "queue.Queue[str]" = queue.Queue()
_worker: threading.Thread | None = None
_active = "official"


def official_db() -> Path:
    return Path(os.environ.get("ABHEDYA_DB", config.DB_PATH))


def _removed() -> Path:
    """Marker: the official case was removed from Saved cases (its CSV stays on disk)."""
    return DIR / "official.removed"


def removed_official_sha() -> str | None:
    """SHA-256 of the official file if its case was removed (so `serve --data` does not rebuild it)."""
    try:
        return json.loads(_removed().read_text(encoding="utf-8")).get("sha256") if _removed().exists() else None
    except (OSError, ValueError):
        return None


def _meta_path(ds_id: str) -> Path:
    return DIR / ds_id / "meta.json"


def _read_meta(ds_id: str) -> dict | None:
    p = _meta_path(ds_id)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _write_meta(ds_id: str, meta: dict) -> None:
    _meta_path(ds_id).write_text(json.dumps(meta, indent=1), encoding="utf-8")


def db_path(ds_id: str) -> Path:
    return official_db() if ds_id == "official" else DIR / ds_id / "case.duckdb"


def _official_sha() -> str | None:
    if _removed().exists():
        return None
    try:
        import duckdb
        with duckdb.connect(str(official_db()), read_only=True) as con:
            return dict(con.execute("SELECT key, value FROM meta").fetchall()).get("input_sha256")
    except Exception:  # noqa: BLE001  (busy or missing: treat as unknown)
        e = engine_mod._engine
        return e.data_sha256 if e is not None and _active == "official" else None


def check_header(first_line: bytes) -> list[str]:
    """Required columns missing from a CSV header line (case-insensitive, BOM tolerated)."""
    text = first_line.decode("utf-8-sig", errors="replace").strip()
    cols = {c.strip().strip('"').lower() for c in text.split(",")}
    return [c for c in REQUIRED_COLUMNS if c.lower() not in cols]


def list_datasets() -> list[DatasetInfo]:
    out: list[DatasetInfo] = []
    try:
        if _removed().exists():
            raise LookupError("official case removed")
        e = engine_mod._engine if _active == "official" and engine_mod._engine else None
        meta = (e.meta if e else None)
        if meta is None and official_db().exists():
            import duckdb
            with duckdb.connect(str(official_db()), read_only=True) as con:
                meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
        if meta:
            out.append(DatasetInfo(id="official", name=meta.get("input_file", "official"), rows=int(meta["rows"]),
                                   accounts=int(meta["accounts"]), sha256=meta["input_sha256"], created_at="",
                                   status="done", active=_active == "official"))
    except Exception:  # noqa: BLE001  (the official database may be busy or missing; uploads still list)
        pass
    if DIR.exists():
        for d in sorted(DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            m = _read_meta(d.name)
            if m:
                st = _progress.get(d.name)
                out.append(DatasetInfo(id=d.name, name=m["name"], rows=m.get("rows", 0), accounts=m.get("accounts", 0),
                                       sha256=m["sha256"], created_at=m["created_at"],
                                       status=st.status if st else m.get("status", "done"), active=_active == d.name))
    return out


def progress(ds_id: str) -> DatasetProgress | None:
    if ds_id in _progress:
        return _progress[ds_id]
    if ds_id == "official" and not _removed().exists():
        d = next((x for x in list_datasets() if x.id == "official"), None)
        return DatasetProgress(id="official", status="done", stage=None, stages_done={}, rows=d.rows if d else 0,
                               accounts=d.accounts if d else 0, flagged=0, error=None) if d else None
    m = _read_meta(ds_id)
    if m:
        return DatasetProgress(id=ds_id, status=m.get("status", "done"), stage=None, stages_done=m.get("timings_s", {}),
                               rows=m.get("rows", 0), accounts=m.get("accounts", 0), flagged=m.get("flagged", 0),
                               error=m.get("error"))
    return None


class UploadWriter:
    """Writes an upload to disk chunk by chunk while hashing it; finish() validates and files it by its hash."""

    def __init__(self, name: str):
        DIR.mkdir(parents=True, exist_ok=True)
        self.name = Path(name).name or "upload.csv"
        self.tmp = DIR / f".upload-{os.getpid()}-{threading.get_ident()}-{time.time_ns()}.csv"
        self.f = open(self.tmp, "wb")
        self.h, self.size, self.first = hashlib.sha256(), 0, b""

    def write(self, chunk: bytes) -> None:
        if not chunk:
            return
        self.size += len(chunk)
        if self.size > MAX_BYTES:
            raise ValueError("The file is larger than 1 GB.")
        if len(self.first) < 4096:
            self.first += chunk[: 4096 - len(self.first)]
        self.h.update(chunk)
        self.f.write(chunk)

    def abort(self) -> None:
        if not self.f.closed:
            self.f.close()
        if self.tmp.exists():
            self.tmp.unlink()

    def finish(self) -> tuple[str, bool]:
        """Returns (dataset id, already existed)."""
        self.f.close()
        try:
            if self.size == 0:
                raise ValueError("The file is empty.")
            missing = check_header(self.first.split(b"\n", 1)[0])
            if missing:
                raise ValueError(f"This does not look like a bank transaction export: missing column(s) {', '.join(missing)}. "
                                 f"Required: {', '.join(REQUIRED_COLUMNS)}.")
            sha = self.h.hexdigest()
            if sha == _official_sha():                 # the official file itself: open it, never keep a second copy
                return "official", True
            ds_id = sha[:12]
            dest = DIR / ds_id
            if (dest / "source.csv").exists():
                return ds_id, True
            dest.mkdir(exist_ok=True)
            self.tmp.replace(dest / "source.csv")
            _write_meta(ds_id, {"name": self.name, "sha256": sha, "bytes": self.size, "status": "queued",
                                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            return ds_id, False
        finally:
            self.abort()


def enqueue(ds_id: str) -> None:
    global _worker
    _progress[ds_id] = DatasetProgress(id=ds_id, status="queued", stage=None, stages_done={}, rows=0, accounts=0,
                                       flagged=0, error=None)
    _jobs.put(ds_id)
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_work, name="dataset-ingest", daemon=True)
            _worker.start()


def _work() -> None:
    from abhedya.ingest.pipeline import run_ingest
    while True:
        try:
            ds_id = _jobs.get(timeout=2)
        except queue.Empty:
            return
        p = _progress[ds_id]
        meta = _read_meta(ds_id) or {}
        p.status, p.stage = "running", STAGES[0]

        def cb(stage: str, seconds: float) -> None:
            p.stages_done[stage] = seconds
            i = STAGES.index(stage) if stage in STAGES else -1
            p.stage = STAGES[i + 1] if 0 <= i < len(STAGES) - 1 else None

        try:
            info = run_ingest(DIR / ds_id / "source.csv", DIR / ds_id / "case.duckdb", run_detect=True, progress=cb)
            p.rows, p.accounts = info["rows"], info["accounts"]
            p.flagged = int((info.get("detect") or {}).get("bands", {}).get("HIGH", 0))
            p.status, p.stage = "done", None
            meta.update(status="done", rows=p.rows, accounts=p.accounts, flagged=p.flagged, timings_s=p.stages_done)
        except Exception as e:  # noqa: BLE001  (reported to the UI in plain words)
            p.status, p.error = "error", str(e) or e.__class__.__name__
            meta.update(status="error", error=p.error)
            traceback.print_exc()
        _write_meta(ds_id, meta)


def activate(ds_id: str) -> DatasetInfo:
    global _active
    path = db_path(ds_id)
    if not path.exists():
        raise FileNotFoundError(f"Dataset {ds_id} is not analysed yet.")
    st = progress(ds_id)
    if st and st.status not in ("done",):
        raise FileNotFoundError(f"Dataset {ds_id} is still {st.status}.")
    with engine_mod._lock:
        cur = engine_mod._engine
        if cur is None or Path(cur.db_path).resolve() != path.resolve():
            engine_mod._engine = engine_mod.Engine(path)
        _active = ds_id
    return next(d for d in list_datasets() if d.id == ds_id)


def _close(e) -> None:
    try:
        e.con.close()
    except Exception:  # noqa: BLE001  (already closed)
        pass


def remove(ds_id: str) -> list[DatasetInfo]:
    """Deletes a case from this workstation: its database, graph cache and, for an upload, the stored copy of the file.
    For the official case only what was built from the file is deleted; the original CSV is never touched.
    If the case is open, the most recent other case is opened first; the last remaining case cannot be removed."""
    global _active
    cases = list_datasets()
    me = next((d for d in cases if d.id == ds_id), None)
    if me is None:
        raise KeyError(ds_id)
    if me.status in ("queued", "running"):
        raise ValueError(f"{me.name} is still being analysed; remove it once it finishes.")
    others = [d for d in cases if d.id != ds_id and d.status == "done"]
    if _active == ds_id:
        if not others:
            raise ValueError("This is the only case left. Add another file on Home before removing it.")
        activate(others[0].id)
    path = db_path(ds_id)
    with engine_mod._lock:
        cur = engine_mod._engine
        if cur is not None and Path(cur.db_path).resolve() == path.resolve():
            engine_mod._engine = None
            _close(cur)
    import gc
    gc.collect()                           # engines replaced earlier release their file handles
    if ds_id == "official":
        import duckdb
        cache = None
        if path.exists():
            with duckdb.connect(str(path), read_only=True) as con:
                cache = dict(con.execute("SELECT key, value FROM meta").fetchall()).get("cache_dir")
        for f in (path, path.with_name(path.name + ".wal"), path.with_name("case_manifest.json")):
            if f.exists():
                f.unlink()
        DIR.mkdir(parents=True, exist_ok=True)
        _removed().write_text(json.dumps({"sha256": me.sha256, "name": me.name,
                                          "removed_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}), encoding="utf-8")
        if cache and Path(cache).is_dir() and config.DATA_DIR.resolve() in Path(cache).resolve().parents:
            shutil.rmtree(cache)
    else:
        shutil.rmtree(DIR / ds_id)
    _progress.pop(ds_id, None)
    return list_datasets()


def startup() -> None:
    """When the official case is removed (or was never built), open the most recent saved case instead."""
    global _active
    if official_db().exists() and not _removed().exists():
        return
    ready = [d for d in list_datasets() if d.id != "official" and d.status == "done"]
    if ready:
        with engine_mod._lock:
            engine_mod._engine = engine_mod.Engine(db_path(ready[0].id))
            _active = ready[0].id


def active_id() -> str:
    return _active
