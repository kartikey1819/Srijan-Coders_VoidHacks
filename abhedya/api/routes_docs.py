"""Document routes (plan/00_OVERVIEW.md section 5.4). Owner: C."""
import re

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from abhedya import config
from abhedya.ai import narrator
from abhedya.ai.fallback import fallback_narrative, with_template_sections
from abhedya.docs.render import FirewallError, case_file_zip, render_case
from abhedya.engine import get_engine
from abhedya.evidence.build import build_evidence
from contracts.models import CaseInfo, CaseOutput, LlmStatus

router = APIRouter(prefix="/api")
CASE_ID = re.compile(r"^[A-Z0-9]{4,20}-\d{14}$")
FILE = re.compile(r"^[a-z_A-Z0-9]+\.(html|json)$")
LLM_CHECK_TIMEOUT_S = 1.0


@router.get("/docs/llm", response_model=LlmStatus)
def llm_status() -> LlmStatus:
    """Is the local model installed and answering? About a second at most; never raises."""
    model = narrator.MODEL
    try:
        r = httpx.get(f"{narrator.OLLAMA_URL}/api/tags", timeout=LLM_CHECK_TIMEOUT_S)
        r.raise_for_status()
        names = {m.get("name") for m in r.json().get("models", []) if isinstance(m, dict)}
        available = model in names or f"{model}:latest" in names
    except Exception:  # noqa: BLE001  (model down, slow, or answering nonsense: all mean "not available")
        available = False
    return LlmStatus(available=available, model=model)


@router.post("/docs/{victim}", response_model=CaseOutput)
def make_documents(victim: str, case: CaseInfo):
    eng = get_engine()
    trace = eng.trace(victim, seed_txns=set(case.seed_txns) or None)
    if not trace.edges:
        raise HTTPException(status_code=422, detail="No money trail found for this account; nothing to document.")
    ev = build_evidence(trace, eng.txns([e.txn_idx for e in trace.edges]), case)
    narrative, reason = (narrator.narrate_with_status(ev) if case.use_llm else (None, "AI narrative switched off"))
    used_llm = narrative is not None
    if used_llm:
        narrative = with_template_sections(narrative, ev)
        source = (f"AI-DRAFTED, VERIFY BEFORE SIGNING. Summary, modus operandi and recommendation drafted by the "
                  f"local AI model ({narrator.MODEL}) from "
                  "evidence IDs only and checked by the validator; layer and holding paragraphs from fixed templates. "
                  "Every account, amount and transaction ID in this diary is inserted from the evidence.")
    else:
        narrative = fallback_narrative(ev)
        source = f"Narrative generated from fixed templates ({reason})."
    try:
        return render_case(ev, narrative, config.CASES_DIR / ev.case_id, source, used_llm,
                           None if used_llm else reason, url_prefix=f"/api/docs/{ev.case_id}/")
    except FirewallError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/docs/{case_id}/case_file.zip")
def get_case_file(case_id: str):
    """The complete case file: every document, the evidence, the manifest and the money trail as CSV."""
    case_dir = (config.CASES_DIR / case_id).resolve() if CASE_ID.match(case_id) else None
    if case_dir is None or config.CASES_DIR.resolve() not in case_dir.parents or not (case_dir / "evidence.json").is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return Response(case_file_zip(case_dir), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="case_file_{case_id}.zip"'})


@router.get("/docs/{case_id}/{fname}")
def get_document(case_id: str, fname: str):
    if not CASE_ID.match(case_id) or not FILE.match(fname):
        raise HTTPException(status_code=404, detail="Not found")
    path = (config.CASES_DIR / case_id / fname).resolve()
    if config.CASES_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="text/html; charset=utf-8" if fname.endswith(".html") else "application/json")
