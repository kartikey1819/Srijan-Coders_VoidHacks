import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from abhedya import engine as engine_mod
from tests.conftest import SAMPLE


@pytest.fixture(scope="module")
def client(sample_db):
    old = engine_mod._engine
    engine_mod._engine = engine_mod.Engine(sample_db)
    from abhedya.api.app import app
    yield TestClient(app)
    engine_mod._engine = old


def test_health_and_stats(client):
    assert client.get("/api/health").json()["ok"] is True
    s = client.get("/api/dq/summary").json()
    assert s["rows"] == 50_000 and "DUP_TXN_ID" in s["counts"]


def test_trace_and_404(client):
    r = client.get("/api/trace/KKBK10000000").json()
    assert r["loss_paise"] == 45554161 and len(r["nodes"]) == 12
    assert client.get("/api/trace/kkbk10000000").status_code == 200       # case-insensitive input
    assert client.get("/api/trace/ZZZZ00000000").status_code == 404


def test_account_search_txns(client):
    a = client.get("/api/account/ICIC10000335").json()
    assert a["bank_name"] == "ICICI Bank" and a["n_in"] >= 1 and a["devices"] == {"Web_Emulator": a["n_out"]}
    assert client.get("/api/search", params={"q": "ICIC1000033"}).json() == ["ICIC10000335"]
    tx = client.get("/api/account/ICIC10000335/txns", params={"limit": 5}).json()
    assert len(tx) == 5 and tx[0]["ts"] <= tx[-1]["ts"]


def test_ring_and_export_rows_are_byte_identical(client):
    ring = client.get("/api/ring/ICIC10000335").json()
    roles = [n["role"] for n in ring["nodes"]]
    assert roles.count("VICTIM") == 300 and len(ring["nodes"]) == 1373
    z = zipfile.ZipFile(io.BytesIO(client.get("/api/ring/ICIC10000335/export.zip").content))
    exported = z.read("transactions.csv").splitlines()
    original = set(SAMPLE.read_bytes().splitlines())
    assert len(exported) - 1 == ring["n_txn"] and all(line in original for line in exported)
