"""Build data/sample.csv: a small, committed extract of the official CSV for fast tests.

Rows are copied byte-for-byte (never edited) and keep their original order:
every row of the injected fraud chains + a seeded random sample of the other rows.
This is a test tool, so it may use the generator's narration strings (the engine may not).

Usage: python tools/make_sample.py [--src data/VoidHacks8_MuleAccount_2M_Transactions.csv] [--n 50000]
"""
import argparse
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAIN_MARKERS = ("TASK_EARNING", "SETTLEMENT", "CRYPTO")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "data" / "VoidHacks8_MuleAccount_2M_Transactions.csv"))
    ap.add_argument("--out", default=str(ROOT / "data" / "sample.csv"))
    ap.add_argument("--n", type=int, default=50_000)
    ap.add_argument("--seed", type=int, default=8)
    a = ap.parse_args()

    with open(a.src, "rb") as f:
        header = f.readline()
        lines = f.readlines()
    chain = [i for i, ln in enumerate(lines) if any(m.encode() in ln for m in CHAIN_MARKERS)]
    chain_set = set(chain)
    others = [i for i in range(len(lines)) if i not in chain_set]
    rng = random.Random(a.seed)
    keep = chain_set | set(rng.sample(others, max(0, a.n - len(chain))))
    with open(a.out, "wb") as f:
        f.write(header)
        for i in sorted(keep):
            f.write(lines[i])
    print(f"wrote {a.out}: {len(keep)} rows ({len(chain)} chain rows)")


if __name__ == "__main__":
    main()
