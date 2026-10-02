import html
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
DIARY_SECTIONS = ["1. Complainant (Victim) Account & Loss", "2. Investigation Narrative", "3. Chronological Money Trail",
                  "4. Layer-wise Accounts Identified", "5. Accounts Recommended for Immediate Debit Freeze",
                  "6. Further Action Proposed"]


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
    out = render_case(evidence, fallback_narrative(evidence), tmp_path, url_prefix="/x/")
    diary = html.unescape((tmp_path / "diary.html").read_text(encoding="utf-8"))
    assert "₹4,55,541.61" in diary and "Section 192 BNSS" in diary
    positions = [diary.find("<h2>" + h + "</h2>") for h in DIARY_SECTIONS]
    assert all(i > 0 for i in positions) and positions == sorted(positions)     # all six, in order
    assert "MADHYA PRADESH POLICE · INDORE (M.P.)" in diary.upper() and "Cyber Cell" in diary   # letterhead, case PS
    assert "Sub-Inspector" in diary and "318(4)" in diary                       # default rank and sections of law
    for e in evidence.freeze_eids:
        assert next(a.account for a in evidence.accounts if a.eid == e) in diary
    banks = sorted(k for k in out.files if k.startswith("notice_"))
    assert banks == ["notice_" + b for b in ("AIRP", "AXIS", "BARB", "HDFC", "ICIC", "KKBK", "PYTM")]
    for b in banks:
        notice = html.unescape((tmp_path / f"{b}.html").read_text(encoding="utf-8"))
        assert "SECTIONS 94 & 106" in notice.upper() and "DEBIT HOLD" in notice and "DRAFT" in notice
    icic = html.unescape((tmp_path / "notice_ICIC.html").read_text(encoding="utf-8"))
    assert "Sections 91 & 102" in icic and "₹90,591.08" in icic                 # ICICI total hold
    assert "The Nodal Officer, ICICI Bank, Cyber Fraud / Grievance Cell" in icic
    assert (tmp_path / "manifest.json").exists()

    # the response describes the same documents
    acc = {a.eid: a for a in evidence.accounts}
    held: dict[str, int] = {}
    for e in evidence.freeze_eids:
        held[acc[e].bank_prefix] = held.get(acc[e].bank_prefix, 0) + acc[e].held_paise
    assert out.diary_url == out.files["diary"] == "/x/diary.html"
    assert [n.bank_prefix for n in out.notices] == sorted(held)
    for n in out.notices:
        assert n.hold_paise == held[n.bank_prefix] and n.url == out.files[f"notice_{n.bank_prefix}"]
        assert n.accounts == sum(1 for e in evidence.freeze_eids if acc[e].bank_prefix == n.bank_prefix)
    icic_n = next(n for n in out.notices if n.bank_prefix == "ICIC")
    assert icic_n.bank_name == "ICICI Bank" and icic_n.hold_paise == 9059108
    v = out.verification
    assert v.ok and v.unverified == 0 and v.fingerprint == out.facts_sha256 == evidence.facts_sha256
    assert v.accounts > 0 and v.ifscs > 0 and v.txn_ids > 0 and v.amounts > 0
    assert v.total == v.accounts + v.ifscs + v.txn_ids + v.amounts
    assert v.accounts == len({a.account for a in evidence.accounts})              # every trail account is printed
    assert v.txn_ids == len({t.transaction_id for t in evidence.txns})
    assert out.narrative_source


def test_firewall_blocks_unknown_account(evidence, tmp_path):
    bad = evidence.model_copy(update={"case": CaseInfo(io_name="KKBK19999999")})
    with pytest.raises(FirewallError):
        render_case(bad, None, tmp_path)
    assert not (tmp_path / "diary.html").exists()
    for field in ("sections", "io_rank", "police_station"):        # the new free-text fields are checked too
        bad = evidence.model_copy(update={"case": CaseInfo(**{field: "see TXN999999999 for ₹1.00"})})
        with pytest.raises(FirewallError):
            render_case(bad, None, tmp_path / field)
        assert not (tmp_path / field).exists()


def test_firewall_reports_what_it_checked(evidence):
    from abhedya.docs.render import firewall
    acct = evidence.accounts[1]
    found = firewall(f"<p>{acct.account} {acct.ifsc} ₹1.00</p>", evidence, {"₹1.00"}, "t")
    assert found["accounts"] == {acct.account} and found["ifscs"] == {acct.ifsc} and found["amounts"] == {"₹1.00"}
    with pytest.raises(FirewallError, match="amount"):
        firewall("<p>₹2.00</p>", evidence, {"₹1.00"}, "t")


def test_llm_on_off_same_facts(evidence, tmp_path):
    llm = Narrative(sections=[NarrSection(section_id="summary", paragraphs=[
        NarrParagraph(text="The complainant's money moved through E-ACC-002 within minutes.", refs=["E-ACC-002"])])])
    a = render_case(evidence, None, tmp_path / "off")
    b = render_case(evidence, llm, tmp_path / "on", used_llm=True)
    assert a.facts_sha256 == b.facts_sha256 == a.verification.fingerprint == b.verification.fingerprint
    assert a.notices == b.notices
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
        assert "switched off" in out["narrative_source"] and out["verification"]["ok"] is True
        assert out["verification"]["fingerprint"] == out["facts_sha256"]
        page = c.get(out["diary_url"])
        assert page.status_code == 200 and "ICIC10000335" in page.text
        for n in out["notices"]:
            assert set(n) == {"bank_prefix", "bank_name", "accounts", "hold_paise", "url"}
            assert c.get(n["url"]).status_code == 200
        assert c.get(f"/api/docs/{out['case_id']}/..%2F..%2Fpyproject.toml").status_code == 404
        assert c.get("/api/docs/not-a-case/diary.html").status_code == 404
        # FIR draft (Section 173 BNSS): checked by the same firewall, names the victim, the loss and the accused accounts
        fir = c.get(out["files"]["fir"])
        assert fir.status_code == 200 and "Section 173 BNSS" in fir.text and "Draft format for the officer" in fir.text
        assert "KKBK10000000" in fir.text and "ICIC10000335" in fir.text and "₹4,55,541.61" in fir.text
        # complete case file: every document, the evidence, the manifest and the trail as CSV
        import io
        import zipfile
        z = c.get(f"/api/docs/{out['case_id']}/case_file.zip")
        assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(z.content))
        names = set(zf.namelist())
        assert {"fir.html", "diary.html", "evidence.json", "manifest.json", "money_trail.csv", "README.txt"} <= names
        assert any(n.startswith("notice_") for n in names)
        trail = zf.read("money_trail.csv").decode("utf-8-sig").splitlines()
        assert trail[0].startswith("ref,date_time,transaction_id") and len(trail) == 1 + 11
        assert c.get("/api/docs/not-a-case/case_file.zip").status_code == 404
    finally:
        engine_mod._engine = old


def test_llm_status_never_raises(monkeypatch):
    from abhedya.ai import narrator
    from abhedya.api.app import app
    monkeypatch.setattr(narrator, "OLLAMA_URL", "http://127.0.0.1:9")     # nothing listens on port 9
    r = TestClient(app).get("/api/docs/llm")
    assert r.status_code == 200 and r.json() == {"available": False, "model": narrator.MODEL}
