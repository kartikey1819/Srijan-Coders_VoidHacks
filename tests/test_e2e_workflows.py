"""Browser workflows 1-10: the real UI (web/dist) on the real API, driven in headless Microsoft Edge.

Each test states the expected result. Skipped when Playwright / Edge or the built UI are not available.
"""
import socket
import threading
import time

import pytest

from abhedya import config
from abhedya import engine as engine_mod
from abhedya.ai import narrator
from contracts.models import NarrParagraph, NarrSection, Narrative

pw = pytest.importorskip("playwright.sync_api")
if not (config.WEB_DIST / "index.html").exists():
    pytest.skip("web UI not built (cd web && npm run build)", allow_module_level=True)

VICTIM, L1 = "KKBK10000000", "ICIC10000335"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base(sample_db, tmp_path_factory):
    import uvicorn

    from abhedya.api.app import app
    old_engine, old_cases = engine_mod._engine, config.CASES_DIR
    engine_mod._engine = engine_mod.Engine(sample_db)
    config.CASES_DIR = tmp_path_factory.mktemp("cases")
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    th.join(10)
    engine_mod._engine, config.CASES_DIR = old_engine, old_cases


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch(channel="msedge", headless=True)
        except Exception as e:  # Edge missing on this machine
            pytest.skip(f"Microsoft Edge not available: {e}")
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1500, "height": 950})
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    yield pg
    ctx.close()
    assert not errors, f"browser errors: {errors}"


def open_trace(page, base):
    page.goto(f"{base}/#trace={VICTIM}")
    page.get_by_text("Accounts on the money trail").wait_for()


def test_w1_flagged_account_shows_risk_and_reasons(page, base):
    """Expected: the flagged list loads; opening an account shows its risk band and reasons."""
    page.goto(f"{base}/#flagged")
    page.get_by_text("Flagged mule accounts:").wait_for()
    page.locator("table.tbl a").first.click()
    badge = page.locator(".badge", has_text="Risk").first
    badge.wait_for()
    assert "HIGH" in badge.inner_text()
    assert page.locator("ul.reasons li").count() >= 1


def test_w2_victim_trace_shows_exact_layers(page, base):
    """Expected: the layer table lists the same L1 / L2 / L3 accounts as the API trace."""
    open_trace(page, base)
    api = engine_mod._engine.trace(VICTIM)
    for role, title in (("L1", "L1 collector"), ("L2", "L2 distributor"), ("L3", "L3 cash-out")):
        block = page.locator("details", has=page.get_by_text(title))
        shown = set(block.locator("tbody td.mono").all_inner_texts())
        assert shown == {n.account for n in api.nodes if n.role == role}, role


def test_w3_ring_shows_whole_syndicate_and_transactions(page, base):
    """Expected: the ring of the shared L1 holds all 1,373 accounts; its transactions are listed."""
    page.goto(f"{base}/#ring={L1}")
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    page.get_by_text("Transactions (").first.wait_for()
    assert page.locator("details[open] table.tbl.small tbody tr").count() >= 1
    assert page.get_by_role("link", name="Export ring (ZIP)").get_attribute("href").endswith("export.zip")


def test_w4_time_slider_reveals_money_step_by_step(page, base):
    """Expected: at the first minute only the victim's transfer is visible; at the end all 11 are."""
    open_trace(page, base)
    graph = page.locator(".investigate .graph").first
    slider = page.locator("input[type=range]").first
    slider.focus()
    slider.press("Home")
    page.wait_for_function("document.querySelector('.investigate .graph').dataset.visibleEdges === '1'")
    slider.press("End")
    page.wait_for_function("document.querySelector('.investigate .graph').dataset.visibleEdges === '11'")
    assert graph.get_attribute("data-visible-edges") == "11"


def _generate(page, base, use_llm: bool) -> str:
    open_trace(page, base)
    page.get_by_role("button", name="Case diary & notices").click()
    page.get_by_label("FIR No.").fill("0123/2026")
    box = page.get_by_role("checkbox", name="Draft the narrative with the local AI model", exact=False)
    if box.is_checked() != use_llm:
        box.click()
    page.get_by_role("button", name="Generate documents").click()
    page.get_by_role("link", name="Police case diary").wait_for(timeout=60_000)
    return page.locator(".docs p.small").first.inner_text()


def test_w5_w6_case_diary_and_bank_notice(page, base):
    """Expected: the diary names the victim and the loss; each bank notice is a s.94 BNSS notice."""
    _generate(page, base, use_llm=False)
    diary_url = page.get_by_role("link", name="Police case diary").get_attribute("href")
    notice_url = page.get_by_role("link", name="Freeze notice: ICIC").get_attribute("href")
    page.goto(base + diary_url)
    body = page.content()
    assert "POLICE CASE DIARY" in body and VICTIM in body and "₹4,55,541.61" in body
    page.goto(base + notice_url)
    assert "Section 94" in page.content() and L1 in page.content()


def test_w7_llm_on(page, base, monkeypatch):
    """Expected: with the model answering, the dialog says the narrative was AI-drafted and checked."""
    good = Narrative(sections=[NarrSection(section_id="summary", paragraphs=[
        NarrParagraph(text="The complainant's money moved through the collector mule E-ACC-002 within minutes.",
                      refs=["E-ACC-002"])])])
    monkeypatch.setattr(narrator, "narrate_with_status", lambda ev, client=None: (good, None))
    assert "drafted by the local AI model" in _generate(page, base, use_llm=True)


def test_w8_llm_off(page, base):
    """Expected: with the AI switched off, the template narrative is used and said so."""
    assert "AI narrative switched off" in _generate(page, base, use_llm=False)


def test_w9_ollama_unavailable(page, base, monkeypatch):
    """Expected: with nothing listening for the model, documents are still produced with the template."""
    monkeypatch.setattr(narrator, "OLLAMA_URL", "http://127.0.0.1:9")
    assert "unavailable" in _generate(page, base, use_llm=True)


def test_w10_invalid_account(page, base):
    """Expected: an unknown account gives a clear message, not a blank or broken page."""
    page.goto(base + "/")
    page.get_by_label("Victim account ID").fill("ZZZZ00000000")
    page.get_by_role("button", name="Trace money trail").click()
    page.get_by_text("Unknown account: ZZZZ00000000").wait_for()


def test_data_quality_screen(page, base):
    """Expected: the data-quality screen shows the row count and the flag table."""
    page.goto(f"{base}/#data")
    page.get_by_text("Data quality").first.wait_for()
    assert "50,000 rows" in page.content() and "DUP_TXN_ID" in page.content()
