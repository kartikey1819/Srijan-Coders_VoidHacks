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
    page.get_by_role("heading", name="How the money moved").wait_for(timeout=15_000)
    page.locator(".tbox").first.wait_for(timeout=15_000)          # the tree draws once its panel width is known


def test_w1_flagged_account_shows_risk_and_reasons(page, base):
    """Expected: the suspect list loads; opening an account shows its risk band and reasons."""
    page.goto(f"{base}/#flagged")
    page.get_by_role("heading", name="1,073 suspect accounts").wait_for()
    page.locator("table.tbl a").first.click()
    badge = page.locator(".badge", has_text="Risk").first
    badge.wait_for()
    assert "HIGH" in badge.inner_text()
    assert page.locator("ul.reasons li").count() >= 1


def test_w2_victim_trace_shows_exact_layers(page, base):
    """Expected: the money-trail tree shows exactly the API trace's L1 / L2 / L3 accounts; the journey strip counts them."""
    open_trace(page, base)
    api = engine_mod._engine.trace(VICTIM)
    for role in ("L1", "L2", "L3"):
        boxes = page.locator(f".tbox[data-role={role}]")
        shown = {boxes.nth(i).get_attribute("data-acct") for i in range(boxes.count())}
        assert shown == {n.account for n in api.nodes if n.role == role}, role
    page.wait_for_function("document.querySelector('.jstrip').innerText.includes('5\\ndistributors')")   # figures count up once
    strip = page.locator(".jstrip").inner_text()
    assert "1\ncollector" in strip and "5\ndistributors" in strip and "5\ncash-out accounts" in strip
    assert "₹4,55,541.61" in page.locator(".headline").inner_text()


def test_w3_ring_shows_whole_syndicate_and_transactions(page, base):
    """Expected: the network of the shared L1 holds all 1,373 accounts; its transactions are listed."""
    page.goto(f"{base}/#ring={L1}")
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    page.get_by_text("Transactions (").first.wait_for()
    assert page.locator("details[open] table.tbl.small tbody tr").count() >= 1
    assert page.get_by_role("link", name="Export network data (ZIP)").get_attribute("href").endswith("export.zip")


def test_w4_time_slider_reveals_money_step_by_step(page, base):
    """Expected: at the first minute only the victim's transfer is drawn; at the end all 11 are."""
    open_trace(page, base)
    slider = page.locator(".trail-time input[type=range]")
    slider.focus()
    slider.press("Home")
    page.wait_for_function("document.querySelector('svg.tree').dataset.visibleEdges === '1'")
    slider.press("End")
    page.wait_for_function("document.querySelector('svg.tree').dataset.visibleEdges === '11'")


def _generate(page, base, use_llm: bool) -> str:
    open_trace(page, base)
    page.get_by_role("button", name="Prepare case diary and freeze notices").click()
    page.locator(".verify").wait_for(timeout=60_000)              # the first draft is prepared on opening
    page.get_by_label("FIR / Case No.").fill("0123/2026")
    box = page.get_by_role("checkbox", name="Draft the narrative with the local language model", exact=False)
    if box.is_checked() != use_llm:
        box.click()
    page.get_by_role("button", name="Prepare again").click()
    page.wait_for_timeout(300)
    page.wait_for_function("!document.querySelector('.docs-side .btn.cta').disabled", timeout=60_000)
    return page.locator(".docs-side p", has_text="Narrative:").inner_text()


def test_w5_w6_case_diary_and_bank_notice(page, base):
    """Expected: the diary is a Section 192 BNSS case diary naming the victim and the loss; each bank gets a Section 94 &
    106 BNSS notice; the verification box reports the checked figures."""
    _generate(page, base, use_llm=False)
    assert "Verification passed" in page.locator(".verify").inner_text()
    diary_url = page.locator(".paper iframe").get_attribute("src")
    page.get_by_role("tab", name="Notice: ICICI Bank").click()
    page.wait_for_function("(document.querySelector('.paper iframe') || {}).src && document.querySelector('.paper iframe').src.includes('notice_ICIC')")
    notice_url = page.locator(".paper iframe").get_attribute("src")
    page.goto(base + diary_url)
    body = page.content()
    assert "Section 192 BNSS" in body and VICTIM in body and "₹4,55,541.61" in body
    page.goto(base + notice_url)
    assert "106" in page.content() and L1 in page.content()


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
    page.get_by_label("Search account number").fill("ZZZZ00000000")
    page.get_by_label("Search account number").press("Enter")
    page.get_by_text("Unknown account: ZZZZ00000000").wait_for()


def test_link_pasted_into_an_open_tab_navigates(page, base):
    """Expected: changing only the #link in an already-open tab switches the screen."""
    page.goto(f"{base}/#flagged")
    page.get_by_role("heading", name="1,073 suspect accounts").wait_for()
    page.goto(f"{base}/#trace={VICTIM}")
    page.get_by_role("heading", name="How the money moved").wait_for(timeout=10_000)
    page.go_back()
    page.get_by_role("heading", name="1,073 suspect accounts").wait_for(timeout=10_000)


def test_sidebar_has_the_four_screens_and_no_separate_data_page(page, base):
    """Expected: the left menu lists the four screens in English and Hindi; old #home / #data links open the
    Dashboard, which names the dataset in use; there is no Evidence or Data Management screen."""
    page.goto(base + "/")
    items = page.locator("nav.side a.side-btn")
    items.first.wait_for()
    assert items.count() == 4
    text = " ".join(items.all_inner_texts())
    for label in ("Dashboard", "Trace Victim Funds", "Suspect Accounts", "Fraud Networks", "डैशबोर्ड"):
        assert label in text
    assert "Data Management" not in text and "Evidence" not in text
    for old in ("#home", "#data"):
        page.goto(f"{base}/{old}")
        page.get_by_role("heading", name="Dashboard").wait_for()
        page.locator(".diu").get_by_text("Data in use for every report").wait_for()


def test_day_night_switch_and_persistence(page, base):
    """Expected: Night restyles the same screen; the choice survives a reload; ?theme= overrides it."""
    open_trace(page, base)
    assert page.evaluate("document.documentElement.dataset.theme") == "light"
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    page.get_by_role("button", name="Night").click()
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") != bg
    page.reload()
    page.get_by_role("heading", name="How the money moved").wait_for()
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    page.goto(f"{base}/?theme=light#trace={VICTIM}")
    page.get_by_role("heading", name="How the money moved").wait_for()
    assert page.evaluate("document.documentElement.dataset.theme") == "light"


def test_one_click_network_from_the_trace(page, base):
    """Expected: View fraud network on the trace isolates the collector's whole syndicate."""
    open_trace(page, base)
    page.get_by_role("button", name="View fraud network").click()
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    assert page.url.endswith(f"#ring={L1}")
    page.go_back()
    page.get_by_role("heading", name="How the money moved").wait_for()


def test_overview_charts_render(page, base):
    """Expected: the Dashboard's charts draw with data, and a layer in the accounts donut opens the filtered list."""
    page.goto(f"{base}/#overview")
    page.get_by_text("accounts are flagged").first.wait_for()
    assert page.locator(".chart svg").count() >= 1 and page.locator(".bars .b-bar").count() >= 3
    page.locator(".cf-legend").get_by_role("button", name="Collectors").click()
    page.get_by_role("heading", name="Suspect Accounts").wait_for()
    assert "role=L1" in page.url


def test_dashboard_first_view_shows_where_the_money_went(page, base):
    """Expected: the Dashboard opens on the victims' money through the layers (counts, amounts, timings), what can
    still be frozen, and the accounts behind it, all without scrolling at 1600 x 900; a station opens its accounts."""
    page.set_viewport_size({"width": 1600, "height": 900})
    page.goto(f"{base}/#overview")
    flow = page.locator(".cflow")
    flow.wait_for(timeout=30_000)
    page.wait_for_function("document.querySelector('.cf-st.l3 .cf-big').innerText.startsWith('385')")
    chain = page.locator(".cf-chain").inner_text()
    for text in ("Victims", "300", "₹8.48 Cr", "Collectors", "129", "98% out in 15 min", "2.3 victims each",
                 "Distributors", "559", "96% out in 1 hour", "Cash-out", "385", "100% crypto / wallet", "+5 min", "+18 min"):
        assert text in chain, text
    assert "₹8,47,66,804.55" in page.locator(".cf-freeze").inner_text()
    assert "All 1,073 suspect accounts are connected" in page.locator(".cf-notes").inner_text()
    box = flow.bounding_box()
    assert box["y"] + box["height"] <= 900            # the whole panel is in the first view
    page.locator(".cf-st.l2").click()
    page.get_by_role("heading", name="Suspect Accounts").wait_for()
    assert "role=L2" in page.url


def test_mistyped_id_gets_a_format_hint(page, base):
    """Expected: an ID of the wrong length is explained instead of failing silently."""
    page.goto(base + "/")
    page.get_by_label("Search account number").fill("KKBK1000")
    page.get_by_label("Search account number").press("Enter")
    page.get_by_text("Account IDs are 12 characters").wait_for()


def _open_upload(page, base):
    page.goto(f"{base}/#overview")
    page.locator(".diu").get_by_text("50,000 transactions").wait_for()   # the dataset in use, named on the Dashboard
    page.get_by_role("button", name="Upload new file").click()
    page.get_by_role("dialog", name="Upload a transaction file").wait_for()


def test_dashboard_upload_analyses_a_file_and_switches_the_dataset(page, base):
    """Expected: Upload new file on the Dashboard analyses a dropped CSV stage by stage; it can be opened, and the
    Dashboard's dataset switcher brings the official data back."""
    _open_upload(page, base)
    small = b"".join(SAMPLE_PATH.read_bytes().splitlines(keepends=True)[:2001])
    page.locator("input[type=file]").set_input_files({"name": "small_case.csv", "mimeType": "text/csv", "buffer": small})
    page.get_by_text("Analysis complete").wait_for(timeout=60_000)
    assert page.locator(".stages li.done").count() == 9
    page.get_by_role("button", name="Open this case").click()
    page.locator(".diu").get_by_text("2,000 transactions").wait_for(timeout=20_000)
    page.get_by_label("Dataset for every report").select_option("official")
    page.locator(".diu").get_by_text("50,000 transactions").wait_for(timeout=20_000)


def test_dashboard_upload_rejects_a_file_without_the_columns(page, base):
    _open_upload(page, base)
    page.locator("input[type=file]").set_input_files({"name": "wrong.csv", "mimeType": "text/csv", "buffer": b"a,b\n1,2\n"})
    page.get_by_text("missing column(s)").wait_for()


def test_ring_money_flow_journey_and_globe(page, base):
    """Expected: the network opens as the money flow around the chosen account (no Columns view); pointing at an
    account shows what it received and kept; the journey panel lists where money came from; Go here moves along it;
    the Globe is one click away."""
    page.goto(f"{base}/#ring={L1}")
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    page.locator(f".netflow .tbox.center[data-acct={L1}]").wait_for(timeout=20_000)
    assert page.get_by_role("button", name="Columns").count() == 0
    page.locator(".netflow .tbox[data-role=VICTIM]").first.wait_for()
    page.locator(".netflow .tbox[data-role=L2]").first.hover()
    tip = page.locator(".netflow .ttip")
    tip.wait_for()
    assert "Received in this network" in tip.inner_text() and "Kept" in tip.inner_text()
    page.get_by_role("heading", name="Money came from (4)").wait_for()
    page.get_by_role("button", name=f"Go to {VICTIM}").click()
    page.locator(".crumbs").get_by_text(VICTIM).wait_for()
    page.locator(f".netflow .tbox.center[data-acct={VICTIM}]").wait_for()
    page.get_by_role("button", name="Globe").click()
    page.locator("[data-testid=ring-globe] canvas").wait_for(timeout=20_000)


def test_panel_size_persists_across_reload(page, base):
    """Expected: dragging the suspect list / account divider changes the layout and the new size survives a reload."""
    page.goto(f"{base}/#flagged")
    page.get_by_role("heading", name="1,073 suspect accounts").wait_for()
    sep = page.locator("[data-separator]").first
    box = sep.bounding_box()
    before = page.locator("#flagged-list").bounding_box()["width"]
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] - 150, box["y"] + box["height"] / 2, steps=8)
    page.mouse.up()
    after = page.locator("#flagged-list").bounding_box()["width"]
    assert after < before - 80
    page.reload()
    page.get_by_role("heading", name="1,073 suspect accounts").wait_for()
    assert abs(page.locator("#flagged-list").bounding_box()["width"] - after) < 30


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
