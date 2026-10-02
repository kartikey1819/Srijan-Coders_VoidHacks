"""Browser workflows 1-10: the real UI (web/dist) on the real API, driven in headless Microsoft Edge.

Each test states the expected result. Skipped when Playwright / Edge or the built UI are not available.
"""
import socket
import threading
import time

import pytest

from abhedya import config
from tests.conftest import SAMPLE as SAMPLE_PATH
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

    from abhedya import datasets
    from abhedya.api.app import app
    old_engine, old_cases = engine_mod._engine, config.CASES_DIR
    old_ds = (datasets.DIR, datasets.official_db, datasets._active)
    engine_mod._engine = engine_mod.Engine(sample_db)
    config.CASES_DIR = tmp_path_factory.mktemp("cases")
    datasets.DIR, datasets.official_db, datasets._active = tmp_path_factory.mktemp("datasets"), (lambda: sample_db), "official"
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
    datasets.DIR, datasets.official_db, datasets._active = old_ds


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
    for role in ("L1", "L2", "L3"):
        block = page.locator(f"section.reg-group[data-role={role}]")
        shown = set(block.locator("tbody td.acct").all_inner_texts())
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


def test_link_pasted_into_an_open_tab_navigates(page, base):
    """Expected: changing only the #link in an already-open tab switches the screen (was ignored)."""
    page.goto(f"{base}/#flagged")
    page.get_by_text("Flagged mule accounts:").wait_for()
    page.goto(f"{base}/#trace={VICTIM}")
    page.get_by_text("Accounts on the money trail").wait_for(timeout=10_000)
    page.go_back()
    page.get_by_text("Flagged mule accounts:").wait_for(timeout=10_000)


def test_data_quality_screen(page, base):
    """Expected: the data-quality screen shows the row count and the flag table."""
    page.goto(f"{base}/#data")
    page.get_by_text("Data quality").first.wait_for()
    assert "50,000 rows" in page.content() and "DUP_TXN_ID" in page.content()


def test_look_toggle_switches_and_persists(page, base):
    """Expected: Briefing restyles the same screen; the choice survives a reload; ?look= overrides it."""
    open_trace(page, base)
    assert page.evaluate("document.documentElement.dataset.look") == "official"
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    font = page.evaluate("getComputedStyle(document.body).fontFamily")
    page.get_by_role("button", name="Gen-Z").click()
    assert page.evaluate("document.documentElement.dataset.look") == "genz"
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") != bg
    assert page.evaluate("getComputedStyle(document.body).fontFamily") != font
    page.reload()
    page.get_by_text("Accounts on the money trail").wait_for()
    assert page.evaluate("document.documentElement.dataset.look") == "genz"
    page.goto(f"{base}/?look=official#trace={VICTIM}")
    page.get_by_text("Accounts on the money trail").wait_for()
    assert page.evaluate("document.documentElement.dataset.look") == "official"


def test_one_click_ring_isolation_from_the_register(page, base):
    """Expected: the Ring button on the L1 row isolates that account's whole syndicate."""
    open_trace(page, base)
    page.get_by_role("button", name=f"Isolate ring around {L1}").click()
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    assert page.url.endswith(f"#ring={L1}")
    page.go_back()
    page.get_by_text("Accounts on the money trail").wait_for()


def test_overview_charts_render_in_both_looks(page, base):
    """Expected: the Overview's charts draw with data in both looks, and a bar opens the filtered list."""
    for look in ("official", "briefing"):
        page.goto(f"{base}/?look={look}#overview")
        page.get_by_text("accounts are flagged").first.wait_for()
        assert page.locator(".chart svg").count() >= 2 and page.locator(".bars .b-bar").count() >= 3
    page.locator(".donut-legend").get_by_role("button", name="L1 collector").click()
    page.get_by_text("Flagged mule accounts:").wait_for()
    assert "role=L1" in page.url


def test_mistyped_id_gets_a_format_hint(page, base):
    """Expected: an ID of the wrong length is explained under the box instead of failing silently."""
    page.goto(base + "/")
    page.get_by_label("Victim account ID").fill("KKBK1000")
    page.get_by_role("button", name="Trace money trail").click()
    page.get_by_text("Account IDs are 12 characters").wait_for()


def test_home_explains_the_flow_and_analyses_an_upload(page, base):
    """Expected: Home shows the six steps with live figures; a dropped CSV is analysed stage by stage, can be opened,
    and the header switcher brings the official data back."""
    page.goto(base + "/")
    page.get_by_text("Load and check every row").wait_for()
    assert page.locator(".flow .step").count() == 6
    page.get_by_text("50,000").first.wait_for()                       # live figure from the loaded file
    small = b"".join(SAMPLE_PATH.read_bytes().splitlines(keepends=True)[:2001])
    page.locator("input[type=file]").set_input_files({"name": "small_case.csv", "mimeType": "text/csv", "buffer": small})
    page.get_by_text("Analysis complete").wait_for(timeout=60_000)
    assert page.locator(".stages li.done").count() == 9
    page.get_by_role("button", name="Open this case").click()
    page.get_by_text("2,000 transactions").first.wait_for(timeout=20_000)
    page.get_by_label("Active dataset").select_option("official")
    page.get_by_text("50,000 transactions").first.wait_for(timeout=20_000)


def test_home_rejects_a_file_without_the_columns(page, base):
    page.goto(base + "/")
    page.locator("input[type=file]").set_input_files({"name": "wrong.csv", "mimeType": "text/csv", "buffer": b"a,b\n1,2\n"})
    page.get_by_text("missing column(s)").wait_for()


def test_ring_globe_journey_and_columns(page, base):
    """Expected: the ring opens as a globe; the journey panel lists where money came from; Go here moves along it;
    the Columns view is one click away."""
    page.goto(f"{base}/#ring={L1}")
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    page.locator("[data-testid=ring-globe] canvas").wait_for(timeout=20_000)
    page.get_by_role("heading", name="Money came from (4)").wait_for()
    page.get_by_role("button", name=f"Go to {VICTIM}").click()
    page.locator(".crumbs").get_by_text(VICTIM).wait_for()
    page.get_by_role("button", name="Columns").click()
    page.wait_for_function("document.querySelectorAll('.graph canvas').length > 0")


def test_panel_size_persists_across_reload(page, base):
    """Expected: dragging the register / graph divider changes the layout and the new size survives a reload."""
    open_trace(page, base)
    sep = page.locator("[data-separator]").first
    box = sep.bounding_box()
    before = page.locator("#register").bounding_box()["width"]
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] - 150, box["y"] + box["height"] / 2, steps=8)
    page.mouse.up()
    after = page.locator("#register").bounding_box()["width"]
    assert after < before - 80
    page.reload()
    page.get_by_text("Accounts on the money trail").wait_for()
    assert abs(page.locator("#register").bounding_box()["width"] - after) < 30


def test_ring_transfer_flow_panel(page, base):
    """Expected: from the journey, Flow opens everything behind one link: both ends, totals, the transaction rows,
    and the money before and after; Back returns to the journey."""
    page.goto(f"{base}/#ring={L1}")
    page.get_by_role("heading", name="Money came from (4)").wait_for(timeout=20_000)
    page.get_by_role("button", name=f"Transfer flow with {VICTIM}").click()
    page.get_by_role("heading", name="Transfer flow").first.wait_for()
    page.locator(".edge-flow .ef-svg").wait_for()
    assert page.locator(".edge-flow .ef-node").count() >= 2
    page.locator(".edge-flow table.tbl tbody tr").first.wait_for()
    assert page.locator(".edge-flow table.tbl tbody tr").count() >= 1
    page.get_by_role("button", name="Back to the journey").click()
    page.get_by_role("heading", name="Money came from (4)").wait_for()
