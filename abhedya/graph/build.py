"""Graph arrays: dense int32 CSR adjacency (out and in), one entry per transaction. Owner: A.

Edges are never merged: notices need exact transactions. Out-edges of an account are
sorted by (ts, txn_idx), so a slice is that account's outgoing timeline.
"""
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import numpy as np

from abhedya import config

EDGE_FIELDS = ("peer", "ts", "amt", "txn", "cat")


def _cat_code_sql() -> str:
    whens = " ".join(f"WHEN '{c}' THEN {i}" for i, c in enumerate(config.NARR_CATEGORIES))
    return f"(CASE narr_category {whens} END)::UTINYINT"


def build_arrays(con: duckdb.DuckDBPyConnection, out_dir: Path) -> dict:
    d = con.execute(
        f"""SELECT src_id, dst_id, ts_epoch, amount_paise, txn_idx, {_cat_code_sql()} AS cat
            FROM txn WHERE usable   -- only rows that can move money (see derive.py)"""
    ).fetchnumpy()
    src = np.asarray(d["src_id"], dtype=np.int32)
    dst = np.asarray(d["dst_id"], dtype=np.int32)
    ts = np.asarray(d["ts_epoch"], dtype=np.int64)
    amt = np.asarray(d["amount_paise"], dtype=np.int64)
    txn = np.asarray(d["txn_idx"], dtype=np.int32)
    cat = np.asarray(d["cat"], dtype=np.uint8)
    acc = con.execute("SELECT account, ifsc FROM account ORDER BY acct_id").fetchnumpy()
    accounts = np.asarray(acc["account"], dtype="U12")
    ifsc = np.asarray(acc["ifsc"], dtype="U11")
    V = len(accounts)

    out_dir.mkdir(parents=True, exist_ok=True)
    for prefix, key, peer in (("out", src, dst), ("in", dst, src)):
        order = np.lexsort((txn, ts, key))
        ptr = np.searchsorted(key[order], np.arange(V + 1, dtype=np.int64)).astype(np.int64)
        np.save(out_dir / f"{prefix}_ptr.npy", ptr)
        for name, arr in zip(EDGE_FIELDS, (peer, ts, amt, txn, cat), strict=True):
            np.save(out_dir / f"{prefix}_{name}.npy", arr[order])
    np.save(out_dir / "accounts.npy", accounts)
    np.save(out_dir / "ifsc.npy", ifsc)
    return {"V": V, "E": int(len(src))}


@dataclass
class Graph:
    V: int
    accounts: np.ndarray
    ifsc: np.ndarray
    out: dict[str, np.ndarray]          # keys: ptr, peer, ts, amt, txn, cat
    inn: dict[str, np.ndarray]
    index: dict[str, int] = field(repr=False)
    terminal_codes: frozenset[int] = field(repr=False)

    @classmethod
    def load(cls, cache_dir: Path) -> "Graph":
        def side(prefix: str) -> dict[str, np.ndarray]:
            s = {"ptr": np.load(cache_dir / f"{prefix}_ptr.npy")}
            for name in EDGE_FIELDS:
                s[name] = np.load(cache_dir / f"{prefix}_{name}.npy")
            return s

        accounts = np.load(cache_dir / "accounts.npy")
        return cls(
            V=len(accounts),
            accounts=accounts,
            ifsc=np.load(cache_dir / "ifsc.npy"),
            out=side("out"),
            inn=side("in"),
            index={a: i for i, a in enumerate(accounts.tolist())},
            terminal_codes=frozenset(config.NARR_CATEGORIES.index(c) for c in config.TERMINAL_CATEGORIES),
        )

    def acct_id(self, account: str) -> int | None:
        return self.index.get(account)

    def search(self, prefix: str, limit: int = 20) -> list[str]:
        prefix = prefix.strip().upper()
        if not prefix:
            return []
        lo = int(np.searchsorted(self.accounts, prefix, side="left"))
        out = []
        for i in range(lo, min(lo + limit, self.V)):
            a = str(self.accounts[i])
            if not a.startswith(prefix):
                break
            out.append(a)
        return out
