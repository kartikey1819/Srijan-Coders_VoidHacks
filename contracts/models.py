"""Shared data models. Source of truth: plan/00_OVERVIEW.md section 4. Owner: A."""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

Role = Literal["VICTIM", "L1", "L2", "L3"]
Band = Literal["HIGH", "MEDIUM", "LOW"]
Rule = Literal["seed", "amount_match", "window", "oldest"]

class TxnRow(BaseModel):
    txn_idx: int                 # 0-based row number in the official CSV; the real primary key
    transaction_id: str          # NOT unique (2,252 collisions)
    sender: str
    receiver: str
    sender_ifsc: str
    receiver_ifsc: str
    amount_paise: int
    ts: str                      # "YYYY-MM-DD HH:MM:SS", exactly as in the source
    mode: str                    # UPI | IMPS | NEFT | RTGS
    narration: str               # raw text; UI must render it escaped; never sent to the LLM
    narr_category: str           # §5
    ip: str
    ip_class: str                # §5
    device: str
    device_class: str            # §5
    dq_flags: list[str] = []

class RiskRow(BaseModel):
    account: str
    score: int = Field(ge=0, le=100)
    band: Band
    role_hint: Optional[Literal["L1", "L2", "L3"]] = None
    reasons: list[str] = []      # "CODE" or "CODE:value", e.g. "PT_STRICT:0.98"

class TraceNode(BaseModel):
    account: str
    role: Role
    hop: int                     # 0 for the victim
    bank_prefix: str
    bank_name: str
    ifsc: str
    received_paise: int          # victim money attributed into this account
    sent_paise: int              # victim money attributed out of it
    held_paise: int              # received - sent = amount to freeze
    first_in_ts: Optional[str] = None
    risk: Optional[RiskRow] = None

class TraceEdge(BaseModel):
    txn_idx: int
    transaction_id: str
    src: str
    dst: str
    ts: str
    amount_paise: int            # full transaction amount
    attributed_paise: int        # part of it that is the victim's money
    hop: int                     # 1 = victim -> L1
    delay_s: Optional[int] = None  # seconds since the consumed lot arrived (None for seed)
    rule: Rule
    mode: str
    narr_category: str
    terminal: bool               # receiver is a cash-out (L3)

class TraceResult(BaseModel):
    victim: str
    loss_paise: int
    nodes: list[TraceNode]
    edges: list[TraceEdge]
    freeze_candidates: list[str]  # accounts with held_paise >= 100, sorted by held desc
    warnings: list[str] = []
    elapsed_ms: int
    data_sha256: str

class Counterparty(BaseModel):
    account: str
    direction: Literal["in", "out"]
    n_txn: int
    total_paise: int

class AccountSummary(BaseModel):
    account: str
    ifsc: str
    bank_prefix: str
    bank_name: str
    n_in: int
    n_out: int
    sum_in_paise: int
    sum_out_paise: int
    first_ts: Optional[str]
    last_ts: Optional[str]
    top_counterparties: list[Counterparty]
    modes: dict[str, int]
    devices: dict[str, int]
    ip_classes: dict[str, int]
    dq_flags: dict[str, int]
    risk: Optional[RiskRow] = None

class GraphNode(BaseModel):
    account: str
    role: Literal["VICTIM", "L1", "L2", "L3", "UNKNOWN"]
    bank_prefix: str
    risk_score: Optional[int] = None
    risk_band: Optional[Band] = None

class GraphEdge(BaseModel):          # parallel transactions aggregated for display
    src: str
    dst: str
    n_txn: int
    total_paise: int
    first_ts: str
    last_ts: str
    txn_idxs: list[int]

class RingResult(BaseModel):
    seed: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    n_txn: int
    total_paise: int
    t_from: Optional[str] = None
    t_to: Optional[str] = None

class VictimCandidate(BaseModel):
    account: str
    out_paise_to_flagged: int
    first_ts: str

class DQSummary(BaseModel):
    rows: int
    accounts: int
    counts: dict[str, int]           # flag -> rows
    input_sha256: str
    ingest_seconds: dict[str, float] # stage -> seconds

# ---- documents ----
class CaseInfo(BaseModel):
    fir_no: Optional[str] = None
    ncrp_ack: Optional[str] = None
    police_station: Optional[str] = None
    io_name: Optional[str] = None
    use_llm: bool = True

class EvidenceAccount(BaseModel):
    eid: str                         # "E-ACC-001"
    account: str
    ifsc: str
    bank_prefix: str
    bank_name: str
    role: Role
    hop: int
    received_paise: int
    held_paise: int

class EvidenceTxn(BaseModel):
    eid: str                         # "E-TXN-0001", ordered by (ts, txn_idx)
    txn_idx: int
    transaction_id: str
    src_eid: str
    dst_eid: str
    ts: str
    amount_paise: int
    attributed_paise: int
    mode: str
    hop: int

class Evidence(BaseModel):
    case_id: str
    victim_eid: str
    loss_paise: int
    accounts: list[EvidenceAccount]
    txns: list[EvidenceTxn]
    freeze_eids: list[str]
    generated_at: str
    data_sha256: str
    trace_sha256: str
    case: CaseInfo

class NarrParagraph(BaseModel):
    text: str                        # no digits runs >= 4, no ₹, no account/txn-like tokens
    refs: list[str]                  # evidence ids only

class NarrSection(BaseModel):
    section_id: Literal["summary", "modus_operandi", "layer_l1", "layer_l2", "layer_l3", "holding", "recommendation"]
    paragraphs: list[NarrParagraph]

class Narrative(BaseModel):
    sections: list[NarrSection]

class CaseOutput(BaseModel):
    case_id: str
    files: dict[str, str]            # logical name -> relative URL, e.g. {"diary": "...", "notice_ICIC": "..."}
    used_llm: bool
    llm_fallback_reason: Optional[str] = None
    manifest_sha256: str
