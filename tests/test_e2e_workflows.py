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
    page.get_by_role("button", name="Police reports & freeze notices").click()
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
    page.get_by_role("tab", name="Freeze notices").click()
    page.get_by_role("button", name="Notice: ICICI Bank").click()
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
    page.get_by_role("button", name="Switch to night theme").click()
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
    page.locator(".bars .b-bar").first.wait_for()
    assert page.locator(".bars .b-bar").count() >= 3
    assert page.get_by_text("accounts are flagged").count() == 0          # the score distribution chart was removed
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
    page.wait_for_function("""(() => { const t = [...document.querySelectorAll('.cf-st .cf-big')].map(e => e.innerText);
        return t.length === 4 && t[0].startsWith('300') && t[1].startsWith('129') && t[2].startsWith('559') && t[3].startsWith('385') })()""")   # figures count up
    chain = page.locator(".cf-chain").inner_text()
    for text in ("Victims", "300", "₹8.48 Cr", "Collectors", "129", "98% out in 15 min", "2.3 victims each",
                 "Distributors", "559", "96% out in 1 hour", "Cash-out", "385", "100% crypto / wallet", "+5 min", "+18 min"):
        assert text in chain, text
    assert "₹8,47,66,804.55" in page.locator(".cf-freeze").inner_text()
    assert "All 1,073 suspect accounts are connected" in page.locator(".cf-notes").inner_text()
    box = flow.bounding_box()
    assert box["y"] + box["height"] <= 900            # the whole panel is in the first view
    acts = page.locator(".cf-acts li")
    assert acts.count() == 3, acts.all_inner_texts()
    assert "Freeze" in acts.nth(0).inner_text() and "notices" in acts.nth(1).inner_text() and "Club" in acts.nth(2).inner_text()
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


def test_ring_isolates_one_trail_with_victim_switch_and_globe(page, base):
    """Expected: the network opens on the money flow around the chosen account, fitted to its panel; Trail shows one
    victim's trail through it, laid out like the trace (victim, collector, distributors, cash-out), not the whole network; the account is marked; every victim whose money reached
    it can be chosen; pointing at an account shows what it received and still holds; Go here moves the journey; the
    Globe is a toggle away and back."""
    page.goto(f"{base}/#ring={L1}")
    page.get_by_text("1,373 accounts").wait_for(timeout=20_000)
    page.locator(f".netflow .tbox.center[data-acct={L1}]").wait_for(timeout=20_000)        # Money flow is the default
    assert page.locator("[data-testid=ring-globe]").count() == 0 and page.get_by_role("button", name="Columns").count() == 0
    fit = page.evaluate("(() => { const e = document.querySelector('.netflow'); return e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1 })()")
    assert fit, "the money flow must fit its panel without scrolling"
    page.locator(".netflow .tbox[data-role=L2]").first.hover()
    assert "Received in this network" in page.locator(".netflow .ttip").inner_text()
    page.get_by_role("button", name="Trail").click()
    page.locator(f".ring-trail .tbox.center[data-acct={L1}]").wait_for(timeout=20_000)
    pick = page.get_by_label("Victim whose trail is shown")
    assert pick.locator("option").count() == 4
    pick.select_option(VICTIM)
    page.locator(f".ring-trail .tbox[data-role=VICTIM][data-acct={VICTIM}]").wait_for(timeout=20_000)
    heads = page.locator(".ring-trail svg.tree").text_content()
    assert all(h in heads for h in ("Victim", "Collector", "Distributors", "Cash-out")), heads
    page.locator(".ring-trail .tbox[data-role=L2]").first.hover()
    tip = page.locator(".ring-trail .ttip")
    tip.wait_for()
    assert "Received from this victim" in tip.inner_text() and "Still holds" in tip.inner_text()
    page.get_by_role("heading", name="Money came from (4)").wait_for()
    page.get_by_role("button", name=f"Go to {VICTIM}").click()
    page.locator(".crumbs").get_by_text(VICTIM).wait_for()
    page.locator(f".ring-trail .tbox.center[data-acct={VICTIM}]").wait_for()
    page.get_by_role("button", name="Globe").click()
    page.locator("[data-testid=ring-globe] canvas").wait_for(timeout=20_000)
    page.get_by_role("button", name="Trail").click()
    page.locator(".ring-trail .tbox").first.wait_for()


def test_collector_panel_has_a_payment_by_payment_view(page, base):
    """Expected: the collector panel switches from the chart to a waterfall of each payment out, ending with what is
    still in the account."""
    open_trace(page, base)
    rows = page.locator(".wf li")
    rows.first.wait_for()
    assert rows.count() >= 3
    assert "from the victim" in rows.first.inner_text() and "still in the account" in rows.last.inner_text()
    assert page.get_by_role("button", name="Over time").count() == 0 and page.locator(".pw svg.win").count() == 0


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


def _ring_victims(base, n=3):
    import json
    import urllib.request
    ring = json.load(urllib.request.urlopen(f"{base}/api/ring/{L1}"))
    victims = {x["account"] for x in ring["nodes"] if x["role"] == "VICTIM"}
    return sorted({e["src"] for e in ring["edges"] if e["dst"] == L1 and e["src"] in victims})[:n]   # they all paid L1


def test_several_victims_traced_together_with_shared_accounts(page, base):
    """Expected: pasting several complainants traces them all at once; their trails sit side by side by layer; the
    collector they share is named and the complaints are offered for clubbing; one combined CSV holds every trail;
    each victim's documents open from its column."""
    vs = _ring_victims(base)
    page.goto(f"{base}/#traceall")
    page.get_by_label("Victim account numbers").fill(", ".join(vs) + "  junk 123")
    page.get_by_text("3 account numbers found").wait_for()
    page.get_by_role("button", name="Trace all").click()
    page.locator(".vcol").nth(2).wait_for(timeout=30_000)
    assert page.locator(".vcol").count() == 3
    assert all(v in page.url for v in vs)
    page.get_by_role("heading", name="These complaints may be clubbed").wait_for()
    assert L1 in page.locator(".gpanel", has_text="These complaints may be clubbed").inner_text()
    for i in range(3):
        assert page.locator(".vcol").nth(i).locator("li.shared", has_text=L1).count() == 1
    with page.expect_download() as dl:
        page.get_by_role("button", name="Combined trails (CSV)").click()
    rows = open(dl.value.path(), encoding="utf-8").read().splitlines()
    assert rows[0].startswith("victim,time,transaction_id") and {r.split(",")[0] for r in rows[1:]} == set(vs)
    page.locator(".vcol").first.get_by_role("button", name="Reports & notices").click()
    page.get_by_role("dialog", name="Case documents").wait_for()


def test_paste_five_random_victims_for_a_demo(page, base):
    """Expected: one click puts five different identified victims in the box (as if pasted), without tracing; a second
    click gives another five; Trace all then traces the five side by side."""
    page.goto(f"{base}/#traceall")
    box = page.get_by_label("Victim account numbers")
    page.get_by_role("button", name="Paste 5 random victims").click()
    page.get_by_text("5 account numbers found").wait_for()
    first = box.input_value().split()
    assert len(set(first)) == 5 and page.locator(".vcol").count() == 0          # pasted, not traced yet
    import json
    import urllib.request
    known = {v["account"] for v in json.load(urllib.request.urlopen(f"{base}/api/victims?limit=1000"))}
    assert set(first) <= known
    for _ in range(5):                                                          # a different five (300 to pick from)
        page.get_by_role("button", name="Paste 5 random victims").click()
        page.wait_for_function("document.querySelector('textarea').value.trim().split(/\\s+/).length === 5")
        if set(box.input_value().split()) != set(first):
            break
    assert set(box.input_value().split()) != set(first)
    page.get_by_role("button", name="Trace all").click()
    page.locator(".vcol").nth(4).wait_for(timeout=30_000)
    assert page.locator(".vcol").count() == 5


def test_fir_draft_and_complete_case_file(page, base):
    """Expected: the documents dialog adds an FIR draft (Section 173 BNSS) tab and a complete case file download."""
    _generate(page, base, use_llm=False)
    page.get_by_role("tab", name="FIR draft").click()
    page.wait_for_function("(document.querySelector('.paper iframe') || {}).src && document.querySelector('.paper iframe').src.includes('fir.html')")
    href = page.get_by_role("link", name="Complete case file (ZIP)").get_attribute("href")
    assert href.endswith("/case_file.zip")


def test_account_panel_explains_the_score(page, base):
    """Expected: an account's panel shows how its score was reached, check by check, with points."""
    page.goto(f"{base}/#ring={L1}")
    why = page.locator(".score-why")
    why.wait_for(timeout=20_000)
    text = why.inner_text()
    assert "How the score of" in text and "Passes money on fast" in text and "/ 60" in text


def test_dashboard_action_traces_the_largest_group_together(page, base):
    """Expected: the Dashboard's third action traces the victims who share a collector, together."""
    page.goto(f"{base}/#overview")
    page.locator(".cf-acts a", has_text="Trace these").click()
    page.locator(".vcol").nth(1).wait_for(timeout=30_000)
    assert "#traceall=" in page.url and page.locator(".vcol").count() >= 2


def test_freeze_notices_are_assigned_to_banks_and_export_in_a_batch(page, base):
    """Expected: the freeze notices tab lists every bank that holds the victim's money (assigned automatically), each
    downloadable on its own, and all of them as one ZIP."""
    _generate(page, base, use_llm=False)
    page.get_by_role("tab", name="Freeze notices").click()
    picks = page.locator(".fz-banks li")
    picks.first.wait_for()
    assert picks.count() >= 2                                       # "All notices" + one per bank
    assert page.get_by_role("link", name="Download the notice to ICICI Bank").get_attribute("download").startswith("freeze_notice_ICIC_")
    with page.expect_download() as dl:
        page.get_by_role("link", name="Download all notices (ZIP)").click()
    import zipfile
    names = zipfile.ZipFile(dl.value.path()).namelist()
    assert "README.txt" in names and any(n.startswith("freeze_notice_ICIC_") for n in names)
    assert len([n for n in names if n.startswith("freeze_notice_")]) == picks.count() - 1


def test_laptop_at_100_percent_first_views_fit(page, base):
    """Expected, at a 1920x1080 laptop with 125% Windows scaling (1536 x 685 CSS px of page): the app renders at its 90%
    default density; the Dashboard's money chain, freeze figures and recommended actions fit the first view; the
    network's money flow fits its panel; no page scrolls sideways."""
    page.set_viewport_size({"width": 1536, "height": 685})
    page.goto(f"{base}/#overview")
    acts = page.locator(".cf-acts")
    acts.wait_for(timeout=30_000)
    assert page.evaluate("getComputedStyle(document.documentElement).zoom") == "0.9"
    box = acts.bounding_box()
    assert box["y"] + box["height"] <= 685
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    page.goto(f"{base}/#ring={L1}")
    page.locator(".netflow .tbox.center").wait_for(timeout=30_000)
    assert page.evaluate("(() => { const e = document.querySelector('.netflow'); return e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1 })()")
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
