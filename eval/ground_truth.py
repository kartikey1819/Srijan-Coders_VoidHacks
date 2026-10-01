"""Ground truth for the official dataset: the injected fraud chains. Owner: B.

This is the ONLY code allowed to use knowledge of how the dataset was generated (narration
strings, exact commission ratios). It reads the raw CSV directly, independent of abhedya's
ingest, so it can check the engine rather than echo it. Never imported by abhedya/.

Usage: python -m eval.ground_truth [--csv data/VoidHacks8_MuleAccount_2M_Transactions.csv]
Writes eval/ground_truth.json.
"""
import argparse
import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "eval" / "ground_truth.json"
VICTIM_PAY, SETTLE, CASHOUT = "TASK_EARNING_REFUND", "INTERNAL_SETTLEMENT", "P2P_CRYPTO"
L2_COMMISSION = 0.96  # generator: an L2 forwards 96% of each settlement it receives


def build(csv: Path) -> dict:
    con = duckdb.connect()
    con.execute(f"""CREATE TABLE raw AS SELECT * FROM read_csv('{csv.as_posix()}', header = true, all_varchar = true)""")
    rows = con.execute(f"""
        SELECT rowid AS txn_idx, Sender_Account, Receiver_Account,
               CAST(round(CAST(Amount AS DECIMAL(18,2)) * 100) AS BIGINT) AS paise,
               epoch(CAST(Timestamp AS TIMESTAMP))::BIGINT AS t,
               CASE WHEN Narration LIKE '%{VICTIM_PAY}%' THEN 'V'
                    WHEN Narration LIKE '%{SETTLE}%' THEN 'S'
                    WHEN Narration LIKE '%{CASHOUT}%' THEN 'C' END AS kind
        FROM raw WHERE Narration LIKE '%{VICTIM_PAY}%' OR Narration LIKE '%{SETTLE}%' OR Narration LIKE '%{CASHOUT}%'
    """).fetchall()
    pays = [r for r in rows if r[5] == "V"]
    settles = [r for r in rows if r[5] == "S"]
    cashouts = [r for r in rows if r[5] == "C"]
    settles_from: dict[str, list] = {}
    for r in settles:
        settles_from.setdefault(r[1], []).append(r)
    cash_from: dict[str, list] = {}
    for r in cashouts:
        cash_from.setdefault(r[1], []).append(r)

    victims: dict[str, dict] = {}
    for idx, v, l1, paise, t0, _ in pays:
        st = [r for r in settles_from.get(l1, []) if 180 <= r[4] - t0 <= 900]
        cr = [c for s in st for c in cash_from.get(s[2], [])
              if c[4] >= s[4] and abs(round(s[3] * L2_COMMISSION) - c[3]) <= 1]
        if v in victims:
            raise ValueError(f"victim {v} pays more than once; extend the oracle")
        victims[v] = {
            "loss_paise": paise,
            "L1": [l1],
            "L2": sorted({s[2] for s in st}),
            "L3": sorted({c[2] for c in cr}),
            "txn_idxs": sorted({idx} | {s[0] for s in st} | {c[0] for c in cr}),
        }
    by_role = {r: sorted({a for x in victims.values() for a in x[r]}) for r in ("L1", "L2", "L3")}
    mules = sorted(set(by_role["L1"]) | set(by_role["L2"]) | set(by_role["L3"]))
    # every injected edge must be explained by exactly one victim chain
    explained = {i for x in victims.values() for i in x["txn_idxs"]}
    unexplained = len(rows) - len(explained)
    return {
        "source": csv.name,
        "victims": victims,
        "mules": mules,
        "mules_by_role": by_role,
        "counts": {"victims": len(victims), **{r: len(by_role[r]) for r in by_role}, "mules": len(mules),
                   "injected_edges": len(rows), "unexplained_edges": unexplained},
    }


def load() -> dict:
    return json.loads(OUT.read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, default=ROOT / "data" / "VoidHacks8_MuleAccount_2M_Transactions.csv")
    a = ap.parse_args()
    gt = build(a.csv)
    c = gt["counts"]
    overlap = (set(gt["mules_by_role"]["L1"]) & set(gt["mules_by_role"]["L2"])) | \
              (set(gt["mules_by_role"]["L2"]) & set(gt["mules_by_role"]["L3"])) | \
              (set(gt["mules_by_role"]["L1"]) & set(gt["mules_by_role"]["L3"]))
    assert not overlap, f"accounts in more than one layer: {sorted(overlap)[:5]}"
    assert c["unexplained_edges"] == 0, f"{c['unexplained_edges']} injected edges not explained by any chain"
    OUT.write_text(json.dumps(gt, indent=1), encoding="utf-8")
    print(f"wrote {OUT}: {c}")


if __name__ == "__main__":
    main()
