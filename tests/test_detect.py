import re
from pathlib import Path

import pytest

from abhedya import detect
from tests.conftest import ROOT, make_engine, row
from tests.oracle import chains

T0 = "2026-09-20 10:00:00"


def at(sec: int) -> str:
    from datetime import datetime, timedelta
    return (datetime.fromisoformat(T0) + timedelta(seconds=sec)).strftime("%Y-%m-%d %H:%M:%S")


def feats(e, account: str) -> dict:
    cur = e.cursor()
    cols = [c[0] for c in cur.execute("SELECT * FROM features LIMIT 0").description]
    r = cur.execute("SELECT f.* FROM features f JOIN account a USING (acct_id) WHERE a.account = ?",
                    [account]).fetchone()
    return dict(zip(cols, r))


def risk(e, account: str):
    return detect.get_risk_many(e.cursor(), [account])[account]


# ---- pass-through ----

@pytest.mark.parametrize("d1,d2,strict,lenient", [
    (180, 900, 1.0, 1.0),     # both boundaries are inside the 3-15 min window
    (179, 901, 0.0, 0.5),     # 179 s is lenient-only, 901 s is outside both
    (0, 600, 0.5, 1.0),       # same-second outflow: lenient only
])
def test_pass_through_boundaries(tmp_path, d1, d2, strict, lenient):
    e = make_engine(tmp_path, [
        row(1, "SBIN10000001", "HDFC10000002", "1000.00", at(0)),
        row(2, "HDFC10000002", "ICIC10000003", "500.00", at(d1)),
        row(3, "HDFC10000002", "AXIS10000004", "500.00", at(d2)),
    ], detect=True)
    f = feats(e, "HDFC10000002")
    assert f["pt_strict"] == pytest.approx(strict) and f["pt_lenient"] == pytest.approx(lenient)


def test_partial_dispersal_unfunded_and_floor(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "HDFC10000002", "PUNB10000009", "300.00", at(-3600)),   # unfunded outflow (no prior inflow)
        row(2, "SBIN10000001", "HDFC10000002", "1000.00", at(0)),
        row(3, "HDFC10000002", "ICIC10000003", "450.00", at(200)),
        row(4, "HDFC10000002", "AXIS10000004", "450.00", at(300)),
    ], detect=True)
    f = feats(e, "HDFC10000002")
    assert f["pt_strict"] == pytest.approx(0.9) and f["pt_outflows"] == 2
    r = risk(e, "HDFC10000002")
    assert r.score >= 70 and r.band == "HIGH" and r.reasons[0].startswith("PT_STRICT:0.90")


def test_window_lot_matched_before_old_money(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "KKBK10000005", "HDFC10000002", "1000.00", "2026-09-16 10:00:00"),   # old money, never spent
        row(2, "SBIN10000001", "HDFC10000002", "1000.00", at(0)),
        row(3, "HDFC10000002", "ICIC10000003", "980.00", at(300)),
    ], detect=True)
    assert feats(e, "HDFC10000002")["pt_strict"] == pytest.approx(0.49)


# ---- fan-out episodes ----

@pytest.mark.parametrize("k,episodes", [(2, 0), (3, 1), (7, 1), (8, 0)])
def test_fanout_episode_sizes(tmp_path, k, episodes):
    rows = [row(0, "SBIN10000001", "HDFC10000002", "1000.00", at(0))]
    rows += [row(i, "HDFC10000002", f"ICIC1000{i:04d}", "100.00", at(60 * i)) for i in range(1, k + 1)]
    f = feats(make_engine(tmp_path, rows, detect=True), "HDFC10000002")
    assert f["episodes_3_7"] == episodes and f["max_episode_k"] == (k if k >= 3 else 0)


# ---- channel signals belong to the sender; cash-out receivers are L3 ----

def test_terminal_direction_and_l3(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "AXIS10000004", "AIRP10000007", "980.00", at(0), "UPI/WALLET_LOAD/P2P_CRYPTO_1", "UPI",
            "194.10.10.10", "Linux_Script"),
    ], detect=True)
    s, r = feats(e, "AXIS10000004"), feats(e, "AIRP10000007")
    assert (s["term_out_n"], s["script_out_n"], s["foreign_out_n"], s["term_in_n"]) == (1, 1, 1, 0)
    assert (r["term_in_n"], r["term_in_from_anom"], r["script_out_n"], r["foreign_out_n"]) == (1, 1, 0, 0)
    l3 = risk(e, "AIRP10000007")
    assert l3.band == "HIGH" and l3.role_hint == "L3" and l3.reasons[0].startswith("TERM_IN_FROM_SCRIPT_OR_FOREIGN")
    assert risk(e, "AXIS10000004").role_hint == "L2"


def test_ordinary_activity_is_low(tmp_path):
    rows = [row(i, "SBIN10000001", f"HDFC1000{i:04d}", "250.00", at(7200 * i), "UPI/Swiggy/Food#1", "UPI")
            for i in range(1, 6)]
    rows += [row(10 + i, f"KKBK1000{i:04d}", "SBIN10000001", "900.00", at(7200 * i + 3000), "NEFT/Salary/Sep1")
             for i in range(1, 6)]
    e = make_engine(tmp_path, rows, detect=True)
    r = risk(e, "SBIN10000001")
    assert r.band == "LOW" and r.score < 40


# ---- whole sample: every injected mule flagged, nothing else ----

def test_sample_precision_recall(sample_con):
    truth = chains(sample_con)
    mules = set().union(*(t["L1"] | t["L2"] | t["L3"] for t in truth.values()))
    flagged = detect.flagged_accounts(sample_con)
    assert flagged == mules
    rows = sample_con.execute("SELECT score, reasons FROM risk").fetchall()
    assert all(0 <= s <= 100 for s, _ in rows)
    assert all(not v for v in detect.candidate_victims(sample_con, 1000) if v.account in mules)
    assert {v.account for v in detect.candidate_victims(sample_con, 1000)} == set(truth)


# ---- guard: the engine must not encode the generator ----

def test_no_generator_knowledge_in_engine():
    forbidden = re.compile(r"TASK_EARNING|INTERNAL_SETTLEMENT|P2P_CRYPTO|0\.96|0\.98|^\s*(from|import) (eval|tests)\b",
                           re.M)
    hits = [f"{p.relative_to(ROOT)}: {m.group(0)}" for p in (ROOT / "abhedya").rglob("*.py")
            for m in [forbidden.search(p.read_text(encoding="utf-8"))] if m]
    assert not hits, hits
    detect_src = "".join(p.read_text(encoding="utf-8") for p in (ROOT / "abhedya" / "detect").rglob("*.py"))
    assert "dq_flags" not in detect_src, "data-quality flags must never feed the risk score"


# ---- statement patterns that are evidence on their own ----

def test_cashout_sent_from_script_device_is_flagged(tmp_path):
    e = make_engine(tmp_path, [
        row(1, "AXIS10000004", "PUNB10000007", "980.00", at(0), "UPI/WALLET_LOAD/X_1", "UPI", "103.1.1.1", "Linux_Script"),
        row(2, "AXIS10000004", "PUNB10000008", "120.00", at(9000), "UPI/Grocery/Store#1", "UPI"),
        row(3, "AXIS10000004", "PUNB10000009", "120.00", at(19000), "UPI/Grocery/Store#2", "UPI"),
    ], detect=True)
    assert risk(e, "AXIS10000004").band == "HIGH"


def test_repeated_ring_is_smurfing_but_one_off_loops_are_not(tmp_path):
    ring = ["SBIN10000001", "HDFC10000002", "ICIC10000003"]
    rows, i = [], 0
    for day in (16, 19):                                   # the same ring twice -> smurfing
        for h, (a, b) in enumerate(zip(ring, ring[1:] + ring[:1])):
            i += 1
            rows.append(row(i, a, b, f"{50000 - 500 * h}.00", f"2026-09-{day} {10 + 2 * h:02d}:00:00"))
    for day, other in ((17, "AXIS10000004"), (21, "PUNB10000005")):   # a busy account: two DIFFERENT loops
        i += 1
        rows.append(row(i, "KKBK10000009", other, "8000.00", f"2026-09-{day} 10:00:00"))
        i += 1
        rows.append(row(i, other, "KKBK10000009", "7800.00", f"2026-09-{day} 15:00:00"))
    e = make_engine(tmp_path, rows, detect=True)
    for a in ring:
        assert feats(e, a)["cycles_2_4"] == 2 and risk(e, a).band == "HIGH"
    assert feats(e, "KKBK10000009")["cycles_2_4"] == 1 and risk(e, "KKBK10000009").band != "HIGH"
