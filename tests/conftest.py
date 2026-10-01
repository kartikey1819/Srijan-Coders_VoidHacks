"""Shared test fixtures: the committed sample (50k rows, all fraud chains) ingested into a temp folder."""
from pathlib import Path

import duckdb
import pytest

from abhedya import config
from abhedya.engine import Engine
from abhedya.ingest.pipeline import run_ingest

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "data" / "sample.csv"
FULL_DB = ROOT / "data" / "case.duckdb"
HEADER = ("Transaction_ID,Sender_Account,Receiver_Account,Sender_IFSC,Receiver_IFSC,Amount,Timestamp,"
          "Payment_Mode,Narration,IP_Address,Device_Type")


@pytest.fixture(scope="session", autouse=True)
def _isolated_audit_log(tmp_path_factory):
    old = config.AUDIT_LOG
    config.AUDIT_LOG = tmp_path_factory.mktemp("audit") / "audit.jsonl"
    yield
    config.AUDIT_LOG = old


@pytest.fixture(scope="session")
def sample_db(tmp_path_factory) -> Path:
    db = tmp_path_factory.mktemp("sample") / "case.duckdb"
    run_ingest(SAMPLE, db, run_detect=False)
    return db


@pytest.fixture(scope="session")
def engine(sample_db) -> Engine:
    return Engine(sample_db)


@pytest.fixture(scope="session")
def sample_con(sample_db):
    con = duckdb.connect(str(sample_db), read_only=True)
    yield con
    con.close()


def make_engine(tmp_path: Path, rows: list[str]) -> Engine:
    """Ingest a tiny hand-written CSV (11 columns per row) and return an Engine on it."""
    csv = tmp_path / "mini.csv"
    csv.write_text(HEADER + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    db = tmp_path / "mini.duckdb"
    run_ingest(csv, db, run_detect=False)
    return Engine(db)


def row(i: int, src: str, dst: str, amount: str, ts: str, narration: str = "IMPS/FriendSplit#1",
        mode: str = "IMPS", ip: str = "103.1.2.3", device: str = "Android") -> str:
    return (f"TXN{i:09d},{src},{dst},{src[:4]}0{src[-6:]},{dst[:4]}0{dst[-6:]},{amount},{ts},"
            f"{mode},{narration},{ip},{device}")
