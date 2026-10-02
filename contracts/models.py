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

class CountRow(BaseModel):           # one bar of an aggregate chart
    key: str
    label: str
    count: int

class DayActivity(BaseModel):
    day: str                         # YYYY-MM-DD as in the data
    n_txn: int                       # usable transfers that day
    n_flagged: int                   # ... that touch a HIGH-risk account

class Overview(BaseModel):           # the case-load picture (read-only aggregates of the risk and txn tables)
    accounts: int
    score_hist: list[int]            # accounts per 5-point score bucket: [0-4], [5-9], ..., [95-100]
    bands: dict[str, int]
    flagged_by_role: list[CountRow]
    flagged_by_bank: list[CountRow]
    flagged_reasons: list[CountRow]  # reason code frequency among HIGH accounts
    activity: list[DayActivity]

class DatasetInfo(BaseModel):        # one saved case (the official file, or an upload)
    id: str
    name: str
    rows: int
    accounts: int
    sha256: str
    created_at: str
    status: str                      # queued | running | done | error
    active: bool

class DatasetProgress(BaseModel):    # live analysis of an upload
    id: str
    status: str
    stage: Optional[str] = None      # stage now running
    stages_done: dict[str, float]    # stage -> seconds
    rows: int
    accounts: int
    flagged: int
    error: Optional[str] = None

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
    io_rank: Optional[str] = None    # e.g. "Sub-Inspector" (the documents default to that when empty)
    sections: Optional[str] = None   # sections of law; the documents print a BNS / IT Act default when empty
    use_llm: bool = True
    seed_txns: list[int] = []        # txn_idx of the disputed transaction(s); empty = all victim outflows

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
    rule: str = ""                    # which trace rule linked this transfer (seed/window/amount_match/oldest)
    delay_s: Optional[int] = None

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
    warnings: list[str] = []         # trace warnings the IO must see (e.g. ambiguous attribution)
    dq_notes: list[str] = []         # data-quality flags on the trail's rows
    facts_sha256: str = ""           # fingerprint of every fact in the documents (same with LLM on or off)

class NarrParagraph(BaseModel):
    text: str                        # no digits runs >= 4, no ₹, no account/txn-like tokens
    refs: list[str]                  # evidence ids only

class NarrSection(BaseModel):
    section_id: Literal["summary", "modus_operandi", "layer_l1", "layer_l2", "layer_l3", "holding", "recommendation"]
    paragraphs: list[NarrParagraph]

class Narrative(BaseModel):
    sections: list[NarrSection]

class NoticeInfo(BaseModel):         # one bank's Section 94 & 106 BNSS notice
    bank_prefix: str                 # "ICIC"
    bank_name: str                   # "ICICI Bank"
    accounts: int                    # accounts to hold at that bank
    hold_paise: int                  # total to hold at that bank
    url: str                         # relative URL of the notice HTML, same style as CaseOutput.files values

class Verification(BaseModel):       # what the output firewall checked across every rendered document of the case
    ok: bool
    accounts: int                    # distinct account numbers checked against the evidence
    ifscs: int                       # distinct IFSCs checked
    txn_ids: int                     # distinct transaction IDs checked
    amounts: int                     # distinct rupee figures checked
    total: int                       # accounts + ifscs + txn_ids + amounts
    unverified: int                  # tokens not found in the evidence (0 whenever documents are written)
    fingerprint: str                 # the facts_sha256 the documents were checked against

class CaseOutput(BaseModel):
    case_id: str
    files: dict[str, str]            # logical name -> relative URL, e.g. {"diary": "...", "notice_ICIC": "..."}
    used_llm: bool
    llm_fallback_reason: Optional[str] = None
    manifest_sha256: str
    facts_sha256: str = ""
    diary_url: str                   # relative URL of the case diary HTML (same as files["diary"])
    notices: list[NoticeInfo] = []   # one per bank, sorted by bank prefix
    verification: Verification
    narrative_source: str            # the sentence printed under the diary's narrative (AI-drafted or fixed templates)

class LlmStatus(BaseModel):          # GET /api/docs/llm
    available: bool                  # the local model answered within about a second and is installed
    model: str

class FlowLayer(BaseModel):          # one station of "where the victims' money went" (victim money only)
    role: str                        # VICTIM, L1, L2 or L3
    accounts: int                    # accounts in this layer (each counted once, in the first layer it was reached)
    received_paise: int              # victim money that arrived (0 for victims)
    passed_on_paise: int             # victim money sent on (victims: the loss; cash-out: 0)
    held_paise: int                  # can still be frozen (holdings of at least FREEZE_MIN_PAISE)
    fast_share: Optional[float]      # collectors: share passed on within 15 min; distributors: within 1 hour
    per_account: Optional[float]     # collectors: victims each; distributors: cash-out accounts each
    wallet_share: Optional[float]    # cash-out: share that arrived through wallet / crypto channels

class FlowSummary(BaseModel):        # GET /api/flow: every identified victim traced once, summed per layer
    victims: int
    loss_paise: int
    avg_loss_paise: int
    max_loss_paise: int
    layers: list[FlowLayer]          # VICTIM, L1, L2, L3
    to_l2_s: Optional[int]           # median seconds from the victim's payment to the first distributor
    to_l3_s: Optional[int]           # ... to the first cash-out account
    freezable_paise: int
    traced_ms: int                   # time to trace every victim
    suspects: int                    # flagged accounts
    linked_largest: int              # flagged accounts in the largest group joined by money between them
    linked_groups: int
    sent_back: int                   # transfers that sent victim money back to an earlier layer or the victim
