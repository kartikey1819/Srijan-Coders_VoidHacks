import re

import pytest
from fastapi.testclient import TestClient

from abhedya import config
from abhedya import engine as engine_mod
from abhedya.ai.fallback import fallback_narrative
from abhedya.docs.render import FirewallError, inr, render_case
from abhedya.evidence.build import build_evidence
from contracts.models import CaseInfo, NarrParagraph, NarrSection, Narrative

FACTS = re.compile(r"<!--FACTS-->(.*?)<!--/FACTS-->", re.S)


@pytest.fixture(scope="module")
def evidence(engine):
    tr = engine.trace("KKBK10000000")
    return build_evidence(tr, engine.txns([e.txn_idx for e in tr.edges]),
                          CaseInfo(fir_no="0123/2026", police_station="Cyber Cell", io_name="SI Test"))


def test_inr_indian_grouping():
    assert inr(45554161) == "₹4,55,541.61"
    assert inr(4555416161) == "₹4,55,54,161.61"
    assert inr(5) == "₹0.05" and inr(100000) == "₹1,000.00"


def test_evidence_ids_and_fingerprint(evidence, engine):
    assert evidence.victim_eid == "E-ACC-001" and evidence.accounts[0].account == "KKBK10000000"
    assert [t.eid for t in evidence.txns][:2] == ["E-TXN-0001", "E-TXN-0002"]
    assert len(evidence.freeze_eids) == 11
    tr2 = engine.trace("KKBK10000000")   # same facts -> same fingerprint, regardless of time or case details
    again = build_evidence(tr2, engine.txns([e.txn_idx for e in tr2.edges]), CaseInfo(fir_no="other"))
    assert again.facts_sha256 == evidence.facts_sha256 and again.trace_sha256 == evidence.trace_sha256


def test_diary_and_one_notice_per_bank(evidence, tmp_path):
    out = render_case(evidence, fallback_narrative(evidence), tmp_path)
    diary = (tmp_path / "diary.html").read_text(encoding="utf-8")
    assert "₹4,55,541.61" in diary
    for e in evidence.freeze_eids:
        assert next(a.account for a in evidence.accounts if a.eid == e) in diary
    banks = sorted(k for k in out.files if k.startswith("notice_"))
    assert banks == ["notice_" + b for b in ("AIRP", "AXIS", "BARB", "HDFC", "ICIC", "KKBK", "PYTM")]
    icic = (tmp_path / "notice_ICIC.html").read_text(encoding="utf-8")
    assert "Section 94" in icic and "Section 91" in icic and "₹90,591.08" in icic   # ICICI total hold
    assert "DRAFT" in icic and (tmp_path / "manifest.json").exists()


def test_firewall_blocks_unknown_account(evidence, tmp_path):
    bad = evidence.model_copy(update={"case": CaseInfo(io_name="KKBK19999999")})
    with pytest.raises(FirewallError):
        render_case(bad, None, tmp_path)
    assert not (tmp_path / "diary.html").exists()


def test_llm_on_off_same_facts(evidence, tmp_path):
    llm = Narrative(sections=[NarrSection(section_id="summary", paragraphs=[
        NarrParagraph(text="The complainant's money moved through E-ACC-002 within minutes.", refs=["E-ACC-002"])])])
    a = render_case(evidence, None, tmp_path / "off")
    b = render_case(evidence, llm, tmp_path / "on", used_llm=True)
    assert a.facts_sha256 == b.facts_sha256
    d_off = (tmp_path / "off" / "diary.html").read_text(encoding="utf-8")
    d_on = (tmp_path / "on" / "diary.html").read_text(encoding="utf-8")
    assert d_off != d_on and FACTS.findall(d_off) == FACTS.findall(d_on)
    for name in a.files:
        if name.startswith("notice_"):
            assert (tmp_path / "off" / a.files[name]).read_bytes() == (tmp_path / "on" / b.files[name]).read_bytes()


def test_document_api(sample_db, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CASES_DIR", tmp_path)
    old = engine_mod._engine
    engine_mod._engine = engine_mod.Engine(sample_db)
    try:
        from abhedya.api.app import app
        c = TestClient(app)
        r = c.post("/api/docs/KKBK10000000", json={"fir_no": "0123/2026", "use_llm": False})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["used_llm"] is False and "switched off" in out["llm_fallback_reason"]
        page = c.get(out["files"]["diary"])
        assert page.status_code == 200 and "ICIC10000335" in page.text
        assert c.get(f"/api/docs/{out['case_id']}/..%2F..%2Fpyproject.toml").status_code == 404
        assert c.get("/api/docs/not-a-case/diary.html").status_code == 404
    finally:
        engine_mod._engine = old
