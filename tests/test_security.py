"""Security checks on the local API: path traversal, injection-shaped input, resource limits, HTML escaping.

Expected everywhere: a clean 4xx (or an empty result), never a 500, never a file outside the app, and the
database unchanged afterwards.
"""
import pytest
from fastapi.testclient import TestClient

from abhedya import config
from abhedya import engine as engine_mod

HOSTILE_IDS = ["' OR 1=1 --", "x'); DROP TABLE txn;--", "KKBK10000000' --", "%00", "..", "<script>alert(1)</script>",
               "KKBK1000000%00", "A" * 5000]


@pytest.fixture(scope="module")
def client(sample_db, tmp_path_factory):
    old, old_cases = engine_mod._engine, config.CASES_DIR
    engine_mod._engine = engine_mod.Engine(sample_db)
    config.CASES_DIR = tmp_path_factory.mktemp("cases")
    from abhedya.api.app import app
    yield TestClient(app)
    engine_mod._engine, config.CASES_DIR = old, old_cases


def _rows(client) -> int:
    return client.get("/api/dq/summary").json()["rows"]


@pytest.mark.parametrize("path", [
    "/api/docs/..%2F..%2F/pyproject.toml",
    "/api/docs/ABCD-20260101000000/..%2F..%2Fpyproject.toml",
    "/api/docs/ABCD-20260101000000/%2e%2e%2f%2e%2e%2fpyproject.toml",
    "/api/docs/..%5C..%5C/pyproject.toml",
    "/assets/..%2F..%2F..%2Fpyproject.toml",
    "/api/../pyproject.toml",
])
def test_path_traversal_never_serves_files(client, path):
    r = client.get(path)
    assert r.status_code in (404, 200) and "[build-system]" not in r.text
    if r.status_code == 200:      # the UI page itself, never the requested file
        assert "<!doctype html>" in r.text.lower()


@pytest.mark.parametrize("bad", HOSTILE_IDS)
def test_injection_shaped_ids_are_rejected_cleanly(client, bad):
    before = _rows(client)
    for url in ("/api/trace/{}", "/api/account/{}", "/api/account/{}/txns", "/api/ring/{}", "/api/risk/{}"):
        r = client.get(url.format(bad.replace("/", "%2F")))
        assert r.status_code in (404, 422), (url, bad, r.status_code)
    s = client.get("/api/search", params={"q": bad})
    assert s.status_code == 200 and s.json() == []
    assert _rows(client) == before


@pytest.mark.parametrize("url", [
    "/api/trace/KKBK10000000?max_hops=9",
    "/api/trace/KKBK10000000?max_hops=0",
    "/api/trace/KKBK10000000?seed_txn=abc",
    "/api/risk/top?limit=1000000",
    "/api/risk/top?band=HIGH'--",
    "/api/account/KKBK10000000/txns?limit=100000",
    "/api/account/KKBK10000000/txns?offset=-1",
    "/api/search?limit=100000",
])
def test_resource_limits(client, url):
    assert client.get(url).status_code == 422


def test_seed_txn_that_is_not_the_victims_is_ignored(client):
    r = client.get("/api/trace/KKBK10000000", params={"seed_txn": [0]})
    assert r.status_code in (200, 404, 422) and r.status_code != 500


def test_case_fields_are_escaped_in_documents(client):
    hostile = "<script>alert(1)</script>"
    r = client.post("/api/docs/KKBK10000000", json={"use_llm": False, "fir_no": hostile, "io_name": hostile,
                                                    "police_station": '"><img src=x onerror=alert(1)>'})
    if r.status_code == 422:      # refused at the door is also safe
        return
    assert r.status_code == 200
    for url in r.json()["files"].values():
        if not url.endswith(".html"):   # JSON is data, never rendered as a page
            continue
        html = client.get(url).text
        assert "<script>alert" not in html and "<img src=x" not in html
