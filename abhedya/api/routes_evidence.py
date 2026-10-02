"""Evidence routes: the loaded file's chain of custody. Owner: A. Additive only.

Re-verify the file against the fingerprint taken at loading, list the rows each data-quality check flagged, show how
those rows touch flagged accounts, read this file's custody log, and download a plain-text integrity statement.
Nothing here edits the file or the database; verification and downloads are written to the audit log.
"""
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import orjson
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from abhedya import config, datasets
from abhedya.audit import log as audit
from abhedya.engine import _TXN_COLS, _TXN_FIELDS, get_engine
from abhedya.ingest.validate import DQ_RULES, RULE_TEXT
from contracts.models import CustodyEvent, EvidenceCheck, EvidenceRecord, TxnRow, VerifyResult

router = APIRouter(prefix="/api/evidence")

_ACTIONS = {"ingest": "Loaded and fingerprinted", "verify": "Re-verified", "certificate": "Integrity statement downloaded"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _file(eng) -> tuple[str, Path]:
    """Display name and on-disk path of the loaded file (uploads are stored as source.csv under their case)."""
    path = Path(eng.meta.get("input_path", ""))
    name = eng.meta.get("input_file", path.name)
    active = next((d for d in datasets.list_datasets() if d.active), None)
    if active is not None and active.id != "official":
        name = active.name
    return name, path


def _custody(sha: str) -> list[CustodyEvent]:
    out: list[CustodyEvent] = []
    if not config.AUDIT_LOG.exists():
        return out
    for line in config.AUDIT_LOG.read_bytes().splitlines():
        try:
            e = orjson.loads(line)
        except orjson.JSONDecodeError:
            continue
        p = e.get("params") or {}
        if e.get("result_sha256") != sha and p.get("data_sha256") != sha:
            continue
        a = e.get("action", "")
        if a == "ingest":
            detail = f"{int(p.get('rows', 0)):,} rows read, SHA-256 recorded"
        elif a == "verify":
            detail = {"match": "file unchanged", "mismatch": "FILE CHANGED since loading",
                      "missing": "original file not found"}.get(p.get("status"), p.get("status", ""))
        elif a == "certificate":
            detail = "plain-text statement for the case file"
        else:
            detail = ", ".join(f"{k} {v}" for k, v in p.items() if k != "data_sha256")
        out.append(CustodyEvent(ts=e.get("ts", ""), action=_ACTIONS.get(a, a.replace("_", " ").capitalize()), detail=detail))
    return out[::-1]


def _checks(eng) -> list[EvidenceCheck]:
    if getattr(eng, "_evidence_checks", None) is None:
        cur = eng.cursor()
        has_risk = cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'risk'").fetchone()[0]
        hi = "SELECT account FROM risk WHERE band = 'HIGH'" if has_risk else "SELECT NULL::VARCHAR AS account WHERE false"
        rows = cur.execute(f"""
            WITH f AS (SELECT unnest(dq_flags) AS flag, usable, sender, receiver FROM txn WHERE len(dq_flags) > 0),
                 hi AS ({hi})
            SELECT flag, count(*), count(*) FILTER (WHERE NOT coalesce(usable, false)),
                   count(*) FILTER (WHERE sender IN (SELECT account FROM hi) OR receiver IN (SELECT account FROM hi))
            FROM f GROUP BY flag""").fetchall()
        found = {r[0]: r[1:] for r in rows}
        eng._evidence_checks = sorted(
            (EvidenceCheck(flag=k, rule=RULE_TEXT.get(k, k), rows=int(found.get(k, (0, 0, 0))[0]),
                           outside_graph=int(found.get(k, (0, 0, 0))[1]), touching_flagged=int(found.get(k, (0, 0, 0))[2]))
             for k in DQ_RULES), key=lambda c: (-c.rows, c.flag))
    return eng._evidence_checks


@router.get("", response_model=EvidenceRecord)
def evidence():
    eng = get_engine()
    name, path = _file(eng)
    if getattr(eng, "_evidence_span", None) is None:
        eng._evidence_span = eng.cursor().execute(
            "SELECT strftime(min(ts), '%Y-%m-%d %H:%M:%S'), strftime(max(ts), '%Y-%m-%d %H:%M:%S'), "
            "count(*) FILTER (WHERE usable) FROM txn").fetchone()
    first, last, in_graph = eng._evidence_span
    timings = orjson.loads(eng.meta.get("timings_s", "{}"))
    custody = _custody(eng.data_sha256)
    loaded = next((e.ts for e in reversed(custody) if e.action == _ACTIONS["ingest"]), None)
    return EvidenceRecord(file_name=name, file_path=str(path), file_present=path.is_file(),
                    size_bytes=path.stat().st_size if path.is_file() else None, sha256=eng.data_sha256,
                    rows=int(eng.meta["rows"]), rows_in_graph=int(in_graph), accounts=int(eng.meta["accounts"]),
                    first_ts=first, last_ts=last, loaded_at=loaded,
                    load_seconds=round(sum(v for k, v in timings.items() if k != "detect"), 3),
                    detect_seconds=timings.get("detect"), checks=_checks(eng), custody=custody)


@router.post("/verify", response_model=VerifyResult)
def verify():
    """Hashes the file on disk again and compares it with the fingerprint recorded when it was loaded."""
    eng = get_engine()
    _, path = _file(eng)
    t0 = time.perf_counter()
    now = audit.sha256_file(path) if path.is_file() else None
    status = "missing" if now is None else "match" if now == eng.data_sha256 else "mismatch"
    audit.log("verify", {"data_sha256": eng.data_sha256, "status": status, "sha256_now": now})
    return VerifyResult(status=status, sha256_now=now, expected=eng.data_sha256,
                        seconds=round(time.perf_counter() - t0, 3), checked_at=_now())


@router.get("/rows", response_model=list[TxnRow])
def flagged_rows(flag: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """Rows carrying one data-quality flag, in file order."""
    if flag not in DQ_RULES:
        raise HTTPException(status_code=404, detail="Unknown check")
    rows = get_engine().cursor().execute(
        f"SELECT {_TXN_COLS} FROM txn WHERE list_contains(dq_flags, ?) ORDER BY txn_idx LIMIT ? OFFSET ?",
        [flag, limit, offset]).fetchall()
    return [TxnRow(**dict(zip(_TXN_FIELDS, r))) for r in rows]


@router.get("/statement.txt")
def statement():
    """Plain-text integrity statement for the case file. A draft: the officer checks, completes and signs it."""
    ev = evidence()
    last = next((e for e in ev.custody if e.action == _ACTIONS["verify"]), None)
    hit = [c for c in ev.checks if c.rows]
    clean = [c for c in ev.checks if not c.rows]
    w = max([len(c.flag) for c in ev.checks] + [4])
    lines = [
        "EVIDENCE INTEGRITY STATEMENT (DRAFT)",
        "Supporting details for the certificate on an electronic record under Section 63 of the",
        "Bharatiya Sakshya Adhiniyam, 2023. Prepared by Abhedya-Chakra on an offline workstation;",
        "to be checked, completed and signed by the responsible officer.",
        "",
        "1. The electronic record",
        f"   File name        : {ev.file_name}",
        f"   Size             : {ev.size_bytes:,} bytes" if ev.size_bytes is not None else "   Size             : (file not on this workstation)",
        f"   SHA-256          : {ev.sha256}",
        f"   Transactions     : {ev.rows:,} rows",
        f"   Accounts         : {ev.accounts:,}",
        f"   Period covered   : {ev.first_ts} to {ev.last_ts}" if ev.first_ts else "   Period covered   : -",
        f"   Loaded on (UTC)  : {ev.loaded_at or '-'}",
        f"   Last re-verified : {last.ts} UTC, {last.detail}" if last else "   Last re-verified : not re-verified since loading",
        "",
        "2. How the record was handled",
        "   - The file was read as received and fingerprinted (SHA-256) before analysis.",
        "   - No value was edited: the raw text is kept next to every cleaned value.",
        f"   - No row was dropped: {ev.rows:,} rows received, {ev.rows:,} rows kept;"
        f" {ev.rows - ev.rows_in_graph:,} unreadable row(s) are kept but left out of the money graph.",
        "   - Row order was verified against the file after loading.",
        "   - Data-quality flags are reported only; they never change a risk score.",
        "",
        f"3. Data-quality checks ({len(ev.checks)} run; every flagged row is kept)",
        *[f"   {c.flag:<{w}}  {c.rows:>10,} rows  {c.rule}" for c in hit],
        *([f"   {c.flag:<{w}}  {0:>10,} rows  {c.rule}" for c in clean]),
        "",
        "4. Custody log for this file (newest first, UTC)",
        *[f"   {e.ts}  {e.action}: {e.detail}" for e in ev.custody[:25]],
        "",
        f"Generated {_now()} by Abhedya-Chakra.",
        "",
        "Officer name: ______________________   Designation: ______________________",
        "Police station: ____________________   Date: ______________   Signature: ______________",
        "",
    ]
    audit.log("certificate", {"data_sha256": ev.sha256})
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(ev.file_name).stem)[:40] or "evidence"
    return Response("\n".join(lines).encode("utf-8"), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="integrity_{stem}_{ev.sha256[:8]}.txt"'})
