"""Test oracle: the injected chains of the official dataset, rebuilt with generator knowledge.

Test-only code (never imported by abhedya/). B's eval/ground_truth.py is the official version;
this one lets A's trace tests run without it.
"""
import duckdb

TASK, SETTLE, CRYPTO = "task_refund", "settlement", "crypto"


def chains(con: duckdb.DuckDBPyConnection) -> dict[str, dict]:
    rows = con.execute(
        """SELECT sender, receiver, ts_epoch, amount_paise, narr_category, txn_idx FROM txn
           WHERE narr_category IN ('task_refund', 'settlement', 'crypto')"""
    ).fetchall()
    victim_pay = [(s, r, t, a, i) for s, r, t, a, c, i in rows if c == TASK]
    settles = [(s, r, t, a, i) for s, r, t, a, c, i in rows if c == SETTLE]
    cryptos = [(s, r, t, a, i) for s, r, t, a, c, i in rows if c == CRYPTO]
    out: dict[str, dict] = {}
    for v, l1, t0, a0, i0 in victim_pay:
        st = [x for x in settles if x[0] == l1 and 180 <= x[2] - t0 <= 900]
        l2 = {x[1] for x in st}
        cr = [c for c in cryptos for s in st
              if c[0] == s[1] and c[2] >= s[2] and abs(round(s[3] * 0.96) - c[3]) <= 1]
        out[v] = {
            "loss_paise": a0,
            "L1": {l1},
            "L2": l2,
            "L3": {c[1] for c in cr},
            "txn_idxs": {i0} | {x[4] for x in st} | {c[4] for c in cr},
        }
    return out
