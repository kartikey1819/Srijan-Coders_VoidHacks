"""Evidence package: every fact a document may state, with stable evidence IDs. Owner: C.

Documents and the LLM refer to accounts and transfers only through these IDs; the renderer is
the only place that turns an ID back into an account number, IFSC, transaction ID or amount.
"""
from datetime import datetime, timezone

import orjson

from abhedya.audit.log import sha256_bytes
from contracts.models import CaseInfo, Evidence, EvidenceAccount, EvidenceTxn, TraceResult, TxnRow


def _sha(obj) -> str:
    return sha256_bytes(orjson.dumps(obj, option=orjson.OPT_SORT_KEYS))


def build_evidence(trace: TraceResult, txns: list[TxnRow], case: CaseInfo, now: datetime | None = None) -> Evidence:
    now = now or datetime.now(timezone.utc)
    victim = next(n for n in trace.nodes if n.role == "VICTIM")
    others = sorted((n for n in trace.nodes if n.role != "VICTIM"),
                    key=lambda n: (n.hop, n.first_in_ts or "", n.account))
    eid: dict[str, str] = {}
    accounts = []
    for i, n in enumerate([victim] + others, start=1):
        eid[n.account] = f"E-ACC-{i:03d}"
        accounts.append(EvidenceAccount(eid=eid[n.account], account=n.account, ifsc=n.ifsc, bank_prefix=n.bank_prefix,
                                        bank_name=n.bank_name, role=n.role, hop=n.hop,
                                        received_paise=n.received_paise, held_paise=n.held_paise))
    ev_txns = [
        EvidenceTxn(eid=f"E-TXN-{i:04d}", txn_idx=e.txn_idx, transaction_id=e.transaction_id, src_eid=eid[e.src],
                    dst_eid=eid[e.dst], ts=e.ts, amount_paise=e.amount_paise, attributed_paise=e.attributed_paise,
                    mode=e.mode, hop=e.hop, rule=e.rule, delay_s=e.delay_s)
        for i, e in enumerate(sorted(trace.edges, key=lambda e: (e.ts, e.txn_idx)), start=1)
    ]
    trace_core = trace.model_dump(exclude={"elapsed_ms"})          # timing varies run to run; content does not
    dq: dict[str, int] = {}
    trail = {e.txn_idx for e in trace.edges}
    for t in txns:
        if t.txn_idx in trail:
            for f in t.dq_flags:
                dq[f] = dq.get(f, 0) + 1
    dq_notes = [f"{flag}: {n} transfer(s) on this trail" for flag, n in sorted(dq.items())]
    ev = Evidence(
        case_id=f"{victim.account}-{now.strftime('%Y%m%d%H%M%S')}",
        victim_eid=eid[victim.account],
        loss_paise=trace.loss_paise,
        accounts=accounts,
        txns=ev_txns,
        freeze_eids=[eid[a] for a in trace.freeze_candidates],
        generated_at=now.isoformat(timespec="seconds"),
        data_sha256=trace.data_sha256,
        trace_sha256=_sha(trace_core),
        case=case,
        warnings=list(trace.warnings),
        dq_notes=dq_notes,
    )
    facts = ev.model_dump(include={"victim_eid", "loss_paise", "accounts", "txns", "freeze_eids", "data_sha256",
                                   "trace_sha256", "warnings", "dq_notes"})
    ev.facts_sha256 = _sha(facts)
    return ev


def verify_evidence(ev: Evidence) -> list[str]:
    """Internal consistency of an Evidence package. Documents are refused if any check fails."""
    errs: list[str] = []
    acc = {a.eid: a for a in ev.accounts}
    if len(acc) != len(ev.accounts) or len({t.eid for t in ev.txns}) != len(ev.txns):
        errs.append("duplicate evidence IDs")
    if ev.victim_eid not in acc:
        errs.append("the victim is not among the accounts")
    for t in ev.txns:
        if t.src_eid not in acc or t.dst_eid not in acc:
            errs.append(f"{t.eid} refers to an unknown account")
        if not 0 < t.attributed_paise <= t.amount_paise:
            errs.append(f"{t.eid}: victim money {t.attributed_paise} is not within the transfer amount {t.amount_paise}")
    for a in ev.accounts:
        if a.eid != ev.victim_eid and not 0 <= a.held_paise <= a.received_paise:
            errs.append(f"{a.eid} holds {a.held_paise} but received {a.received_paise}")
    for e in ev.freeze_eids:
        if e not in acc or acc[e].held_paise <= 0:
            errs.append(f"freeze list entry {e} holds no victim money")
    if sum(t.attributed_paise for t in ev.txns if t.rule == "seed") != ev.loss_paise:
        errs.append("the disputed transfers do not add up to the loss")
    held = sum(a.held_paise for a in ev.accounts if a.eid != ev.victim_eid)
    returned = acc[ev.victim_eid].received_paise if ev.victim_eid in acc else 0
    if held + returned != ev.loss_paise:
        errs.append(f"money does not balance: held {held} + returned {returned} != loss {ev.loss_paise}")
    return errs
