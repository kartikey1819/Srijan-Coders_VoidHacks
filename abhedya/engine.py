"""Engine facade: the only way B's and C's code touches the graph (plan/00_OVERVIEW.md section 3). Owner: A."""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import duckdb

from abhedya import config
from abhedya.docs.banks import bank_name
from abhedya.graph.build import Graph
from abhedya.graph.trace import fmt_ts, trace_core
from contracts.models import (AccountSummary, Counterparty, DQSummary, FlowSummary, RingResult, RiskRow,
                              TraceEdge, TraceNode, TraceResult, TxnRow)

# flagged rows may lack values; the API shows them as empty / 0 together with their data-quality flags
_TXN_COLS = """txn_idx, coalesce(transaction_id, ''), coalesce(sender, ''), coalesce(receiver, ''),
               coalesce(sender_ifsc, ''), coalesce(receiver_ifsc, ''), coalesce(amount_paise, 0),
               coalesce(strftime(ts, '%Y-%m-%d %H:%M:%S'), ts_raw, '') AS ts, coalesce(mode, ''),
               coalesce(narration, ''), narr_category, coalesce(ip, ''), ip_class, coalesce(device, ''),
               device_class, dq_flags"""
_TXN_FIELDS = ("txn_idx", "transaction_id", "sender", "receiver", "sender_ifsc", "receiver_ifsc", "amount_paise",
               "ts", "mode", "narration", "narr_category", "ip", "ip_class", "device", "device_class", "dq_flags")


def _ints_sql(values) -> str:
    """Inline integer list for SQL `IN (...)`. DuckDB binds a Python list parameter at ~1 ms per element
    (1.1 s for 1,174 ids); inlined integers take ~10 ms. int() makes this injection-safe."""
    return ",".join(str(int(x)) for x in values)


class UnknownAccount(KeyError):
    """Account id not present in the ingested data (the API maps this to HTTP 404)."""


class Engine:
    def __init__(self, db_path: Path = config.DB_PATH):
        if not Path(db_path).exists():
            raise FileNotFoundError(f"{db_path} not found: run `python -m abhedya ingest --data <csv>` first")
        self.db_path = Path(db_path)
        self.con = duckdb.connect(str(db_path), read_only=True)
        self.meta = dict(self.con.execute("SELECT key, value FROM meta").fetchall())
        self.data_sha256: str = self.meta["input_sha256"]
        self.g = Graph.load(Path(self.meta["cache_dir"]))
        self._fallback_suspects: set[int] | None = None

    # ---- basics ----
    def cursor(self) -> duckdb.DuckDBPyConnection:
        return self.con.cursor()

    def search(self, prefix: str, limit: int = 20) -> list[str]:
        return self.g.search(prefix, limit)

    def _require(self, account: str) -> int:
        u = self.g.acct_id(account.strip().upper())
        if u is None:
            raise UnknownAccount(f"Unknown account: {account}")
        return u

    def risk_many(self, cur, accounts: list[str]) -> dict[str, RiskRow]:
        try:
            from abhedya import detect
            return detect.get_risk_many(cur, accounts)
        except Exception:  # risk table not built yet (detection skipped or B's code not merged)
            return {}

    # ---- trace ----
    def _scores(self):
        """Risk score per account id (0 where unscored), loaded once."""
        if getattr(self, "_score_arr", None) is None:
            import numpy as np
            arr = np.zeros(len(self.g.accounts), dtype=np.int16)
            try:
                rows = self.cursor().execute("SELECT acct_id, score FROM risk").fetchnumpy()
                arr[rows["acct_id"].astype(np.int64)] = rows["score"]
            except duckdb.Error:          # no detection run: every transfer stays a candidate
                pass
            self._score_arr = arr
        return self._score_arr

    def default_seeds(self, v: int) -> tuple[set[int] | None, str | None]:
        """The reported loss when no disputed transfer is chosen: the victim's transfers to accounts scored
        SEED_MIN_SCORE or more. If none (or all) qualify: every outgoing transfer, as before."""
        o, sc = self.g.out, self._scores()
        ks = range(int(o["ptr"][v]), int(o["ptr"][v + 1]))
        allx = [int(o["txn"][k]) for k in ks]
        pick = {int(o["txn"][k]) for k in ks if sc[int(o["peer"][k])] >= config.SEED_MIN_SCORE}
        if not pick or len(pick) == len(set(allx)):
            return None, None
        return pick, (f"Traced the {len(pick)} of {len(allx)} outgoing transfers that went to accounts scored "
                      f"{config.SEED_MIN_SCORE} or more (possible or likely mules). Choose the disputed transfers "
                      "to trace others.")

    def trace(self, victim: str, max_hops: int = config.MAX_HOPS, seed_txns: set[int] | None = None) -> TraceResult:
        t0 = time.perf_counter()
        v = self._require(victim)
        note = None
        if seed_txns is None:
            seed_txns, note = self.default_seeds(v)
        core = trace_core(self.g, v, max_hops=max_hops, seed_txns=seed_txns)
        if note:
            core.warnings.insert(0, note)
        cur = self.cursor()
        idxs = [e.txn_idx for e in core.edges]
        info = {}
        if idxs:
            info = {r[0]: r[1:] for r in cur.execute(
                f"""SELECT txn_idx, transaction_id, strftime(ts, '%Y-%m-%d %H:%M:%S'), mode, narr_category
                    FROM txn WHERE txn_idx IN ({_ints_sql(idxs)})""").fetchall()}
        A = lambda i: str(self.g.accounts[i])  # noqa: E731
        edges = [
            TraceEdge(txn_idx=e.txn_idx, transaction_id=info[e.txn_idx][0], src=A(e.src), dst=A(e.dst),
                      ts=info[e.txn_idx][1], amount_paise=e.amount, attributed_paise=e.attributed, hop=e.hop,
                      delay_s=e.delay, rule=e.rule, mode=info[e.txn_idx][2], narr_category=info[e.txn_idx][3],
                      terminal=e.terminal)
            for e in sorted(core.edges, key=lambda e: (e.ts, e.txn_idx))
        ]
        ids = [v] + sorted(core.received, key=lambda u: (core.min_hop[u], core.first_in[u], A(u)))
        risk = self.risk_many(cur, [A(u) for u in ids])
        nodes = []
        for u in ids:
            a = A(u)
            is_v = u == v
            nodes.append(TraceNode(
                account=a, role=core.role(u), hop=0 if is_v else core.min_hop[u], bank_prefix=a[:4],
                bank_name=bank_name(a[:4]), ifsc=str(self.g.ifsc[u]),
                received_paise=core.returned if is_v else core.received[u],
                sent_paise=core.sent.get(u, 0), held_paise=0 if is_v else core.held(u),
                first_in_ts=None if is_v else fmt_ts(core.first_in[u]), risk=risk.get(a)))
        freeze = sorted((n for n in nodes if n.role != "VICTIM" and n.held_paise >= config.FREEZE_MIN_PAISE),
                        key=lambda n: (-n.held_paise, n.account))
        return TraceResult(victim=A(v), loss_paise=core.loss, nodes=nodes, edges=edges,
                           freeze_candidates=[n.account for n in freeze], warnings=core.warnings,
                           elapsed_ms=round((time.perf_counter() - t0) * 1000), data_sha256=self.data_sha256)

    # ---- account lookup ----
    def account(self, account: str) -> AccountSummary:
        u = self._require(account)
        cur = self.cursor()
        r = cur.execute("""SELECT account, ifsc, bank_prefix, bank_name, n_in, n_out, sum_in_paise, sum_out_paise,
                                  strftime(first_ts, '%Y-%m-%d %H:%M:%S'), strftime(last_ts, '%Y-%m-%d %H:%M:%S')
                           FROM account WHERE acct_id = ?""", [u]).fetchone()
        cps = []
        for direction, me, other in (("out", "src_id", "receiver"), ("in", "dst_id", "sender")):
            for acct, n, total in cur.execute(
                    f"""SELECT {other}, count(*), sum(amount_paise) FROM txn WHERE {me} = ?
                        GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 10""", [u]).fetchall():
                cps.append(Counterparty(account=acct, direction=direction, n_txn=n, total_paise=int(total)))

        def hist(col: str, outgoing_only: bool = False) -> dict[str, int]:
            where, params = ("src_id = ?", [u]) if outgoing_only else ("src_id = ? OR dst_id = ?", [u, u])
            return dict(cur.execute(f"SELECT {col}, count(*) FROM txn WHERE {where} GROUP BY 1 ORDER BY 2 DESC",
                                    params).fetchall())

        dq = dict(cur.execute("""SELECT f, count(*) FROM (SELECT unnest(dq_flags) AS f FROM txn
                                 WHERE src_id = ? OR dst_id = ?) GROUP BY 1""", [u, u]).fetchall())
        return AccountSummary(
            account=r[0], ifsc=r[1], bank_prefix=r[2], bank_name=r[3], n_in=r[4], n_out=r[5],
            sum_in_paise=r[6], sum_out_paise=r[7], first_ts=r[8], last_ts=r[9], top_counterparties=cps,
            modes=hist("mode"),
            # device and IP describe the sender, so only this account's outgoing transactions count
            devices=hist("device", outgoing_only=True),
            ip_classes=hist("ip_class", outgoing_only=True),
            dq_flags=dq, risk=self.risk_many(cur, [r[0]]).get(r[0]))

    def account_txns(self, account: str, limit: int = 200, offset: int = 0) -> list[TxnRow]:
        u = self._require(account)
        rows = self.cursor().execute(
            f"SELECT {_TXN_COLS} FROM txn WHERE src_id = ? OR dst_id = ? ORDER BY ts, txn_idx LIMIT ? OFFSET ?",
            [u, u, limit, offset]).fetchall()
        return [TxnRow(**dict(zip(_TXN_FIELDS, r))) for r in rows]

    def txns(self, txn_idxs: list[int]) -> list[TxnRow]:
        if not txn_idxs:
            return []
        rows = self.cursor().execute(
            f"SELECT {_TXN_COLS} FROM txn WHERE txn_idx IN ({_ints_sql(txn_idxs)}) ORDER BY ts, txn_idx").fetchall()
        return [TxnRow(**dict(zip(_TXN_FIELDS, r))) for r in rows]

    # ---- ring ----
    def suspects(self) -> tuple[set[int], dict[str, RiskRow]]:
        """Flagged accounts from B's detection; until that exists, the statement's terminal identifiers."""
        cur = self.cursor()
        try:
            from abhedya import detect
            flagged = detect.flagged_accounts(cur)
        except Exception:
            flagged = set()
        if flagged:
            ids = {self.g.index[a] for a in flagged if a in self.g.index}
            return ids, self.risk_many(cur, list(flagged))
        if self._fallback_suspects is None:
            cats = ", ".join(f"'{c}'" for c in config.TERMINAL_CATEGORIES)  # constants from config
            rows = cur.execute(
                f"""SELECT DISTINCT src_id FROM txn WHERE device_class = 'script' OR ip_class = 'foreign_proxy'
                    UNION SELECT DISTINCT dst_id FROM txn WHERE narr_category IN ({cats})""").fetchall()
            self._fallback_suspects = {r[0] for r in rows}
        return self._fallback_suspects, {}

    def flow(self) -> FlowSummary:
        """Where the victims' money went, case-wide (computed once per engine: the data never changes)."""
        if getattr(self, "_flow", None) is None:
            from abhedya import detect
            from abhedya.graph.flow import flow_summary
            vics = [self.g.index[c.account] for c in detect.candidate_victims(self.cursor(), 100_000)
                    if c.account in self.g.index]
            self._flow = flow_summary(self.g, vics, lambda v: self.default_seeds(v)[0], self.suspects()[0])
        return self._flow

    def ring(self, seed: str, t_from: str | None = None, t_to: str | None = None) -> RingResult:
        from abhedya.graph.ring import isolate_ring
        u = self._require(seed)
        S, risk = self.suspects()
        return isolate_ring(self.g, u, S, risk, t_from, t_to)

    def ring_export(self, seed: str, t_from: str | None = None, t_to: str | None = None) -> bytes:
        """ZIP of the ring: original CSV rows (byte-identical), members, and a hashed manifest."""
        import io
        import zipfile
        from datetime import datetime, timezone

        import orjson

        from abhedya.audit import log as audit
        from abhedya.audit.manifest import git_commit

        ring = self.ring(seed, t_from, t_to)
        want = {x for e in ring.edges for x in e.txn_idxs}
        csv_path = Path(self.meta["input_path"])
        warnings = []
        if audit.sha256_file(csv_path) != self.data_sha256:
            warnings.append("Source CSV on disk no longer matches the ingested file hash.")
        from abhedya.ingest.records import iter_records
        with open(csv_path, "rb") as f:
            header = f.readline()
        lines = [r if r.endswith(b"\n") else r + b"\n" for i, r in enumerate(iter_records(csv_path)) if i in want]
        tx_bytes = header + b"".join(lines)
        mem =["account,role,bank_prefix,bank_name,ifsc,risk_score,risk_band"]
        for nd in ring.nodes:
            u = self.g.index[nd.account]
            mem.append(f"{nd.account},{nd.role},{nd.bank_prefix},{bank_name(nd.bank_prefix)},{self.g.ifsc[u]},"
                       f"{'' if nd.risk_score is None else nd.risk_score},{nd.risk_band or ''}")
        mem_bytes = ("\n".join(mem) + "\n").encode()
        manifest = {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seed": ring.seed, "t_from": t_from, "t_to": t_to,
            "members": len(ring.nodes), "transactions": len(lines), "total_paise": ring.total_paise,
            "source_file": getattr(self, "display_name", None) or self.meta["input_file"], "source_sha256": self.data_sha256, "git_commit": git_commit(),
            "files": {"transactions.csv": audit.sha256_bytes(tx_bytes), "members.csv": audit.sha256_bytes(mem_bytes)},
            "warnings": warnings,
        }
        man_bytes = orjson.dumps(manifest, option=orjson.OPT_INDENT_2)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("transactions.csv", tx_bytes)
            z.writestr("members.csv", mem_bytes)
            z.writestr("manifest.json", man_bytes)
        data = buf.getvalue()
        audit.log("ring_export", {"seed": ring.seed, "t_from": t_from, "t_to": t_to,
                                  "members": len(ring.nodes), "transactions": len(lines)}, audit.sha256_bytes(data))
        return data

    # ---- data quality ----
    def dq_summary(self) -> DQSummary:
        import orjson
        counts = dict(self.cursor().execute("SELECT flag, rows FROM dq_summary").fetchall())
        return DQSummary(rows=int(self.meta["rows"]), accounts=int(self.meta["accounts"]), counts=counts,
                         input_sha256=self.data_sha256, ingest_seconds=orjson.loads(self.meta["timings_s"]))


_engine: Engine | None = None
_lock = threading.Lock()


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                _engine = Engine(Path(os.environ.get("ABHEDYA_DB", config.DB_PATH)))
    return _engine
