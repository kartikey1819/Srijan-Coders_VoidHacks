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


def test_trace_from_disputed_transaction(client):
    full = client.get("/api/trace/KKBK10000000").json()
    seeded = client.get("/api/trace/KKBK10000000", params={"seed_txn": 0}).json()
    assert seeded["loss_paise"] == full["loss_paise"] and len(seeded["edges"]) == len(full["edges"])
    assert client.get("/api/trace/KKBK10000000", params={"seed_txn": 999999}).json()["loss_paise"] == 0


def test_risk_routes(client):
    r = client.get("/api/risk/ICIC10000335").json()
    assert r["band"] == "HIGH" and r["role_hint"] == "L1"
    assert len(client.get("/api/risk/top", params={"limit": 5, "band": "HIGH"}).json()) == 5
    assert "PT_STRICT" in client.get("/api/risk/reasons").json()
    assert len(client.get("/api/victims", params={"limit": 1000}).json()) == 300
    flagged = client.get("/api/export/flagged.csv").text.splitlines()
    assert flagged[0].startswith("account,ifsc") and len(flagged) - 1 == 1073
    assert client.get("/api/risk/ZZZZ00000000").status_code == 404


def test_overview_aggregates_agree_with_the_risk_table(client):
    o = client.get("/api/overview").json()
    assert sum(o["score_hist"]) == o["accounts"] == sum(o["bands"].values())
    flagged = o["bands"].get("HIGH", 0)
    assert sum(r["count"] for r in o["flagged_by_role"]) == flagged == sum(r["count"] for r in o["flagged_by_bank"])
    assert sum(o["score_hist"][14:]) == flagged          # buckets 70-100 are exactly the HIGH band
    assert all(d["n_flagged"] <= d["n_txn"] for d in o["activity"])
    assert client.get("/api/overview").json() == o        # cached, unchanged


# ---- saved datasets: upload, live analysis, switch ----
def _wait_done(client, ds_id, timeout=120):
    import time
    t0 = time.time()
    while time.time() - t0 < timeout:
        p = client.get(f"/api/datasets/{ds_id}/progress").json()
        if p["status"] in ("done", "error"):
            return p
        time.sleep(0.3)
    raise AssertionError("analysis did not finish")


def test_upload_analyse_switch_and_back(client, tmp_path, monkeypatch):
    from abhedya import datasets
    from abhedya.audit.log import sha256_file
    monkeypatch.setattr(datasets, "DIR", tmp_path / "datasets")
    monkeypatch.setattr(datasets, "_active", "official")
    official_path = engine_mod._engine.db_path
    monkeypatch.setattr(datasets, "official_db", lambda: official_path)
    lines = SAMPLE.read_bytes().splitlines(keepends=True)
    body = b"".join(lines[:3001])                         # header + 3,000 official rows
    before = sha256_file(SAMPLE)
    r = client.post("/api/datasets?name=small.csv", content=body, headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 202, r.text
    ds_id = r.json()["id"]
    p = _wait_done(client, ds_id)
    assert p["status"] == "done" and p["rows"] == 3000 and "graph_arrays" in p["stages_done"] and "detect" in p["stages_done"]
    assert (tmp_path / "datasets" / ds_id / "source.csv").read_bytes() == body      # stored byte for byte
    official = engine_mod._engine
    try:
        info = client.post(f"/api/datasets/{ds_id}/activate").json()
        assert info["active"] and info["rows"] == 3000
        assert client.get("/api/stats").json()["rows"] == 3000
        assert {d["id"] for d in client.get("/api/datasets").json()} >= {ds_id, "official"}
        again = client.post("/api/datasets?name=again.csv", content=body).json()
        assert again["id"] == ds_id                                           # same file, same case
        dup = client.post("/api/datasets?name=copy.csv", content=SAMPLE.read_bytes()).json()
        assert dup["id"] == "official"                                       # the loaded file itself is never copied
        assert client.post("/api/datasets/official/activate").json()["active"]
        assert client.get("/api/stats").json()["rows"] == 50_000
    finally:
        engine_mod._engine = official
    assert sha256_file(SAMPLE) == before


def test_remove_cases_keeps_the_original_file(client, tmp_path, monkeypatch):
    from abhedya import datasets
    from abhedya.audit.log import sha256_file
    from abhedya.ingest.pipeline import run_ingest
    lines = SAMPLE.read_bytes().splitlines(keepends=True)
    own = tmp_path / "official.csv"                       # a stand-in "official" case, so the shared one is untouched
    own.write_bytes(b"".join(lines[:2001]))
    run_ingest(own, tmp_path / "case.duckdb", run_detect=True)
    monkeypatch.setattr(datasets, "DIR", tmp_path / "datasets")
    monkeypatch.setattr(datasets, "_active", "official")
    monkeypatch.setattr(datasets, "official_db", lambda: tmp_path / "case.duckdb")
    before, shared = sha256_file(own), engine_mod._engine
    try:
        engine_mod._engine = engine_mod.Engine(tmp_path / "case.duckdb")
        body = b"".join(lines[:1501])
        ds_id = client.post("/api/datasets?name=small.csv", content=body).json()["id"]
        assert _wait_done(client, ds_id)["status"] == "done"
        assert client.post(f"/api/datasets/{ds_id}/activate").json()["active"]
        left = client.delete("/api/datasets/official").json()             # removing a case that is not open
        assert [d["id"] for d in left] == [ds_id] and left[0]["active"]
        assert not (tmp_path / "case.duckdb").exists() and sha256_file(own) == before     # the CSV itself stays
        assert datasets.removed_official_sha() == before
        assert client.get("/api/datasets/official/progress").status_code == 404
        r = client.delete(f"/api/datasets/{ds_id}")
        assert r.status_code == 409 and "only case left" in r.json()["detail"]
        again = client.post("/api/datasets?name=x.csv", content=own.read_bytes()).json()["id"]   # re-adding works
        assert again != "official" and _wait_done(client, again)["status"] == "done"
        left = client.delete(f"/api/datasets/{ds_id}").json()               # removing the open case opens another
        assert [d["id"] for d in left] == [again] and left[0]["active"]
        assert not (tmp_path / "datasets" / ds_id).exists()
        assert client.get("/api/stats").json()["rows"] == 2000
        assert client.delete("/api/datasets/zzz").status_code == 404
    finally:
        engine_mod._engine = shared


def test_upload_rejects_a_file_without_the_columns(client, tmp_path, monkeypatch):
    from abhedya import datasets
    monkeypatch.setattr(datasets, "DIR", tmp_path / "datasets")
    r = client.post("/api/datasets?name=x.csv", content=b"a,b,c\n1,2,3\n")
    assert r.status_code == 422 and "Sender_Account" in r.json()["detail"]
    assert client.post("/api/datasets?name=e.csv", content=b"").status_code == 422
    assert client.get("/api/datasets/zzz/progress").status_code == 404


def test_transactions_by_row_number(client):
    rows = client.get("/api/txns", params={"idx": [0, 1, 2]}).json()
    assert [r["txn_idx"] for r in sorted(rows, key=lambda r: r["txn_idx"])] == [0, 1, 2]
    assert client.get("/api/txns", params={"idx": ["x"]}).status_code == 422
    assert client.get("/api/txns", params={"idx": list(range(501))}).status_code == 422
    assert client.get("/api/txns", params={"idx": [10 ** 9]}).json() == []
