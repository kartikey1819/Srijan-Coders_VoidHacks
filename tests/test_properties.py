"""Property-based tests: rules that must hold for ANY transaction data, checked on random datasets."""
import random
import tempfile
from pathlib import Path

import duckdb
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from abhedya.engine import Engine
from abhedya.ingest.pipeline import run_ingest
from tests.conftest import HEADER

PREFIX = ("SBIN", "HDFC", "ICIC", "KKBK", "PYTM")
NARR = ("UPI/Grocery/1", "IMPS/Friend/2", "UPI/WALLET LOAD/3", "IMPS/CRYPTO/4", "NEFT/SALARY/5", "UPI/x/6")
DEVICES = ("Android", "iOS", "Windows_Browser", "Web_Emulator", "Linux_Script")
IPS = ("103.1.2.3", "185.4.5.6", "194.7.8.9", "49.1.1.1")

txn = st.tuples(st.integers(0, 11), st.integers(0, 11), st.integers(1, 5_000_000), st.integers(0, 20_000),
                st.sampled_from(NARR), st.sampled_from(DEVICES), st.sampled_from(IPS))
datasets = st.lists(txn, min_size=1, max_size=60)
SETTINGS = settings(max_examples=20, deadline=None, suppress_health_check=[HealthCheck.too_slow])


def acct(i: int, tag: str = "1") -> str:
    return f"{PREFIX[i % len(PREFIX)]}{tag}{i:07d}"


def to_csv(rows, tag="1", unique_seconds=False, tamper=False) -> str:
    out = [HEADER]
    for k, (s, d, paise, sec, narr, dev, ip) in enumerate(rows):
        if unique_seconds:
            sec = sec * 100 + k
        a, b = acct(s, tag), acct(d, tag)
        h, m = divmod(sec, 3600)
        ts = f"2026-09-{16 + h // 24:02d} {h % 24:02d}:{m // 60:02d}:{m % 60:02d}"
        tid = "DUPLICATE" if tamper else f"T{tag}{k:06d}"
        ifsc_a, ifsc_b = ("BAD", "IFSC") if tamper else (a[:4] + "0000001", b[:4] + "0000002")
        mode = "CARRIER-PIGEON" if tamper else "UPI"
        out.append(f"{tid},{a},{b},{ifsc_a},{ifsc_b},{paise / 100:.2f},{ts},{mode},{narr},{ip},{dev}")
    return "\n".join(out) + "\n"


def ingest(text: str) -> Path:
    d = Path(tempfile.mkdtemp(prefix="prop_"))
    p = d / "x.csv"
    p.write_text(text, encoding="utf-8")
    run_ingest(p, d / "x.duckdb", run_detect=True)
    return d / "x.duckdb"


def risk(db: Path) -> dict:
    con = duckdb.connect(str(db), read_only=True)
    try:
        return {a: (s, b, r, tuple(x)) for a, s, b, r, x in
                con.execute("SELECT account, score, band, role_hint, reasons FROM risk").fetchall()}
    finally:
        con.close()


@SETTINGS
@given(datasets)
def test_scores_bounded_and_banded(rows):
    r = risk(ingest(to_csv(rows)))
    for score, band, _, _ in r.values():
        assert 0 <= score <= 100
        assert band == ("HIGH" if score >= 70 else "MEDIUM" if score >= 40 else "LOW")


@SETTINGS
@given(datasets)
def test_every_trace_is_conserved_time_consistent_and_real(rows):
    db = ingest(to_csv(rows))
    e = Engine(db)
    real = {x.txn_idx: x for a in e.g.index for x in e.account_txns(a, 5000)}
    for a in list(e.g.index):
        tr = e.trace(a)
        assert sum(n.held_paise for n in tr.nodes if n.role != "VICTIM") + \
            next(n.received_paise for n in tr.nodes if n.role == "VICTIM") == tr.loss_paise
        arrived = {tr.victim: ""}
        for x in tr.edges:
            assert x.src in arrived and arrived[x.src] <= x.ts          # money leaves only after it arrived
            arrived.setdefault(x.dst, x.ts)
            assert 1 <= x.hop <= 4 and 0 < x.attributed_paise <= x.amount_paise
            t = real[x.txn_idx]                                          # every edge is a real transaction
            assert (t.sender, t.receiver, t.amount_paise) == (x.src, x.dst, x.amount_paise)
    e.con.close()


@SETTINGS
@given(datasets)
def test_same_input_same_output(rows):
    text = to_csv(rows)
    a, b = ingest(text), ingest(text)
    assert risk(a) == risk(b)
    ea, eb = Engine(a), Engine(b)
    for acc in list(ea.g.index)[:5]:
        x, y = ea.trace(acc).model_dump(), eb.trace(acc).model_dump()
        x.pop("elapsed_ms"), y.pop("elapsed_ms")
        assert x == y


@SETTINGS
@given(datasets, datasets)
def test_unrelated_component_changes_nothing(rows, other):
    base = risk(ingest(to_csv(rows, "1")))
    both = risk(ingest(to_csv(rows, "1") + to_csv(other, "2").split("\n", 1)[1]))
    for a, v in base.items():
        assert both[a] == v


@SETTINGS
@given(datasets)
def test_data_quality_problems_never_change_risk(rows):
    clean, dirty = risk(ingest(to_csv(rows))), risk(ingest(to_csv(rows, tamper=True)))
    assert clean == dirty


@SETTINGS
@given(datasets, st.randoms(use_true_random=False))
def test_file_order_does_not_matter(rows, rnd: random.Random):
    text = to_csv(rows, unique_seconds=True)
    head, *body = text.strip().split("\n")
    rnd.shuffle(body)
    assert risk(ingest(text)) == risk(ingest("\n".join([head, *body]) + "\n"))
