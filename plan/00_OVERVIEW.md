# 00 — Overview and Shared Contracts (everyone reads this)

Three people work at the same time from hour 0. Nobody waits for anybody, because everything that crosses a person boundary is fixed in this file: table schemas, function signatures, data models, API routes and a real sample trace.

| File | For |
|---|---|
| `plan/00_OVERVIEW.md` | Everyone. This is the source of truth for interfaces |
| `plan/A_ENGINE.md` | A (main PC): ingest, graph, trace, API wiring, integration |
| `plan/B_DETECTION.md` | B: detection, risk score, evaluation, test-data generator |
| `plan/C_UI_DOCS.md` | C: React/Cytoscape UI, case diary, bank notices, LLM narrator |
| `DATA_HANDLING.md` | Everyone. The data rules |

**Changing anything in §3–§6 needs A's approval**, because A owns `contracts/` and merges every PR.

---

## 1. Repository structure (owner in brackets)

```
abhedya-chakra/
├─ CLAUDE.md                     [A] shared context for every Claude Code session
├─ DATA_HANDLING.md              [A]
├─ plan/                         [A] these files
├─ pyproject.toml                [A] Python deps; others request additions
├─ .gitignore                    [A]
├─ contracts/                    [A]
│  ├─ models.py                  shared Pydantic models (§4)
│  └─ fixtures/
│     └─ trace_KKBK10000000.json real sample trace (§6)
├─ data/                         gitignored except sample.csv
│  ├─ VoidHacks8_…csv            official file, copied manually, NEVER edited
│  ├─ sample.csv                 [A] 50k-row extract for tests (committed)
│  ├─ case.duckdb                built by ingest
│  └─ cache/<sha256>/*.npy       graph arrays built by ingest
├─ abhedya/
│  ├─ __main__.py, cli.py        [A] `python -m abhedya ingest|serve`
│  ├─ config.py                  [A] engine constants
│  ├─ engine.py                  [A] Engine facade used by B and C (§3)
│  ├─ ingest/  load.py derive.py validate.py           [A]
│  ├─ graph/   build.py trace.py ring.py lookup.py     [A]
│  ├─ audit/   log.py manifest.py                      [A]
│  ├─ detect/  __init__.py features.py risk.py params.py reasons.py export.py victims.py  [B]
│  ├─ evidence/ build.py                               [C]
│  ├─ ai/      narrator.py validator.py prompts.py     [C]
│  ├─ docs/    render.py banks.py templates/*.html.j2  [C]
│  └─ api/
│     ├─ app.py                  [A] mounts the 3 routers + static web/dist
│     ├─ routes_trace.py         [A]
│     ├─ routes_risk.py          [B]
│     └─ routes_docs.py          [C]
├─ web/                          [C] Vite + React + TypeScript + Cytoscape
├─ eval/                         [B] ground truth + evaluation (NEVER imported by abhedya/)
├─ tools/   make_sample.py [A]  gen_testdata.py [B]
├─ bench/   run.py               [A]
├─ tests/   test_ingest.py test_trace.py [A] · test_detect.py [B] · test_docs.py test_validator.py [C]
└─ cases/  testdata/             gitignored outputs
```

**Hard rules:**
- `abhedya/` must never import from `eval/`. `eval/` is allowed to use knowledge of how this dataset was generated; the engine is not.
- No literal generator strings (`TASK_EARNING`, `INTERNAL_SETTLEMENT`, `P2P_CRYPTO`) and no 0.96/0.98 ratios anywhere in `abhedya/`. The engine works from categories (§5).

---

## 2. Execution order (what runs, in what order)

### 2.1 `python -m abhedya ingest --data data/VoidHacks8_MuleAccount_2M_Transactions.csv`
| Step | Module (owner) | Output | Timed? |
|---|---|---|---|
| 1 | Compute SHA-256 of the input (`ingest/load.py`, A) | `meta.input_sha256` | yes |
| 2 | Typed CSV load into DuckDB (A) | table `txn_raw` | yes |
| 3 | Derive columns: paise, epoch, categories, IP/device classes (`derive.py`, A) | table `txn` | yes |
| 4 | Data-quality flags (`validate.py`, A) | `txn.dq_flags`, table `dq_summary` | yes |
| 5 | Account table + dense IDs (`load.py`, A) | table `account`, `txn.src_id/dst_id` | yes |
| 6 | Build graph arrays (`graph/build.py`, A) | `data/cache/<sha>/*.npy` | yes |
| — | **End of the "ingest + index ≤ 60 s" budget.** Print the stage timings | | |
| 7 | Detection: `detect.run(con)` (B) | tables `features`, `risk` | timed separately |
| 8 | Exports (B) | `data/exports/flagged.csv`, `ranked.csv` | |
| 9 | Manifest + audit entry (A) | `data/manifest.json`, `data/audit.jsonl` | |

### 2.2 `python -m abhedya serve`
1. Open `data/case.duckdb` and load the `.npy` arrays into an `Engine` singleton.
2. Start FastAPI on `127.0.0.1:8000` with **1 worker**. It serves `/api/*` plus the static `web/dist`.
3. During development, C runs the Vite dev server on `:5173`, which proxies `/api` to `:8000`.

### 2.3 What the investigator does, step by step
1. Search a victim (`/api/search`, then `/api/trace/{victim}`) and see the layered graph Victim → L1 → L2 → L3.
2. Click a node to open its account panel (`/api/account/{id}` + `/api/risk/{id}`).
3. Drag or play the minute slider.
4. Isolate the ring (`/api/ring/{id}`) and export it (`/api/ring/{id}/export.zip`).
5. Generate documents (`POST /api/docs/{victim}`), then open the diary and the per-bank notices and print them to PDF.
6. Optionally browse the flagged list (`/api/risk/top`) and the data-quality screen (`/api/dq/summary`).

---

## 3. Python interfaces between people

```python
# abhedya/engine.py  [A]  — the only way B and C touch the graph
class Engine:
    data_sha256: str
    def cursor(self) -> "duckdb.DuckDBPyConnection": ...        # one per request/thread
    def search(self, prefix: str, limit: int = 20) -> list[str]: ...
    def trace(self, victim: str, max_hops: int = 4) -> TraceResult: ...
    def account(self, account: str) -> AccountSummary: ...
    def account_txns(self, account: str, limit: int = 200, offset: int = 0) -> list[TxnRow]: ...
    def txns(self, txn_idxs: list[int]) -> list[TxnRow]: ...
    def ring(self, seed: str, t_from: str | None = None, t_to: str | None = None) -> RingResult: ...
def get_engine() -> Engine: ...                                    # singleton

# abhedya/detect/__init__.py  [B]
def run(con, params: "DetectParams | None" = None) -> dict: ...   # writes tables features, risk; returns timings/counts
def get_risk_many(con, accounts: list[str]) -> dict[str, RiskRow]: ...
def top(con, limit: int = 100, band: str | None = None) -> list[RiskRow]: ...
def flagged_accounts(con) -> set[str]: ...                         # band == "HIGH"; used by Engine.ring
def candidate_victims(con, limit: int = 50) -> list[VictimCandidate]: ...
REASON_LABELS: dict[str, str]                                      # in detect/reasons.py, code -> human label

# abhedya/evidence/build.py, ai/, docs/  [C]
def build_evidence(trace: TraceResult, txns: list[TxnRow], case: CaseInfo) -> Evidence: ...
def narrate(evidence: Evidence) -> Narrative | None: ...            # None if Ollama is unavailable
def validate_narrative(n: Narrative, evidence: Evidence) -> list[str]: ...   # [] = valid
def render_case(evidence: Evidence, narrative: Narrative | None, out_dir: Path) -> CaseOutput: ...

# abhedya/audit/log.py  [A]
def log(action: str, params: dict, result_sha256: str | None = None) -> None: ...   # appends to data/audit.jsonl
def sha256_file(path: Path) -> str: ...
```

**Until a real function exists, its owner pushes a stub** that returns fixture data. That way everyone else can always import it.
- A's `Engine.trace` stub returns the §6 fixture.
- B's `get_risk_many` stub returns `{}`.
- C's `narrate` stub returns `None`.

---

## 4. Shared data models: `contracts/models.py` (A creates it verbatim in hour 0)

```python
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

Role = Literal["VICTIM", "L1", "L2", "L3"]
Band = Literal["HIGH", "MEDIUM", "LOW"]
Rule = Literal["seed", "amount_match", "window", "oldest"]

class TxnRow(BaseModel):
    txn_idx: int                 # 0-based row number in the official CSV; the real primary key
    transaction_id: str          # NOT unique (4,502 rows share an ID)
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
```

C mirrors these by hand in `web/src/types.ts`. Any change here must be announced in the team chat.

---

## 5. Shared vocabularies and tables

### 5.1 Canonical ingest SQL
A owns this SQL. B may use the same SQL in a scratch database before A's code lands.
```sql
CREATE TABLE txn_raw AS SELECT * FROM read_csv('<path>', header=true, store_rejects=true, columns={
 'Transaction_ID':'VARCHAR','Sender_Account':'VARCHAR','Receiver_Account':'VARCHAR',
 'Sender_IFSC':'VARCHAR','Receiver_IFSC':'VARCHAR','Amount':'DECIMAL(18,2)',
 'Timestamp':'TIMESTAMP','Payment_Mode':'VARCHAR','Narration':'VARCHAR',
 'IP_Address':'VARCHAR','Device_Type':'VARCHAR'});
-- txn_idx = rowid of txn_raw (insertion order preserved). Check: txn_idx 0 = TXN401119292, 10 = TXN583175063
```

### 5.2 Tables in `case.duckdb`
| Table | Owner | Columns |
|---|---|---|
| `txn` | A | `txn_idx INT PK, transaction_id, sender, receiver, sender_ifsc, receiver_ifsc, amount_paise BIGINT, ts TIMESTAMP, ts_epoch BIGINT, mode, narration, narr_base, narr_category, narr_instruction_like BOOL, ip, ip_octet1 SMALLINT, ip_class, device, device_class, dq_flags VARCHAR[], src_id INT, dst_id INT` |
| `account` | A | `acct_id INT PK, account VARCHAR UNIQUE, ifsc, bank_prefix, bank_name, n_in, n_out, sum_in_paise, sum_out_paise, first_ts, last_ts` |
| `dq_summary` | A | `flag VARCHAR, rows BIGINT` |
| `meta` | A | `key VARCHAR, value VARCHAR` (input_sha256, rows, ingest timings JSON, created_at) |
| `features` | B | `acct_id` + one column per feature (B_DETECTION §2) |
| `risk` | B | `acct_id, account, score INT, band, role_hint, reasons VARCHAR[], params_hash` |

### 5.3 Category vocabularies (computed in `derive.py`, A)
- **`narr_base`**: the narration with any trailing `#digits`, `_digits` or digits removed.
- **`narr_category`**: the first match, checked on upper-case text in this order:

  | Keywords | Category |
  |---|---|
  | `CRYPTO` | `crypto` |
  | `WALLET` | `wallet` |
  | `TASK`, `REFUND` | `task_refund` |
  | `SETTLEMENT` | `settlement` |
  | `SALARY` | `salary` |
  | `RENT` | `rent` |
  | `BILL`, `ELECTRICITY`, `RECHARGE` | `bill` |
  | `FAMILY`, `FRIEND`, `SPLIT` | `p2p_personal` |
  | `AMAZON`, `FLIPKART`, `SWIGGY`, `ZOMATO`, `GROCERY`, `PHARMACY`, `PETROL`, `MERCHANT`, `QR`, `SHOP` | `merchant` |
  | anything else | `other` |

  A prints the distinct `narr_base` values on day 1 and extends this table if needed.
- **Terminal categories** (cash-out): `crypto`, `wallet`.
- **`narr_instruction_like`**: true if the text matches `IGNORE|INSTRUCTION|DECLARE|SAFE|FREEZE|SYSTEM|PROMPT`. It is display-only and the injection demo uses it.
- **`ip_class`**: `foreign_proxy` if the first octet is 185 or 194; `domestic` otherwise; `invalid` if the IP doesn't parse.
- **`device_class`**: `script` for `Web_Emulator` or `Linux_Script`; `human` otherwise.
- **IP and device describe the sender of a transaction**, never the receiver.
- **Data-quality flags**: see `DATA_HANDLING.md` §2. They are never used in risk.
- **Bank map** (`docs/banks.py`, used by A for `bank_name`):

  | Prefix | Bank |
  |---|---|
  | `IPOS` | India Post Payments Bank |
  | `AXIS` | Axis Bank |
  | `KKBK` | Kotak Mahindra Bank |
  | `SBIN` | State Bank of India |
  | `PUNB` | Punjab National Bank |
  | `HDFC` | HDFC Bank |
  | `ICIC` | ICICI Bank |
  | `PYTM` | Paytm Payments Bank |
  | `BARB` | Bank of Baroda |
  | `AIRP` | Airtel Payments Bank |
  | anything else | `Unknown bank (<prefix>)` |

### 5.4 REST API
| Method + path | Owner | Returns |
|---|---|---|
| `GET /api/health` | A | `{"ok": true, "data_sha256": ...}` |
| `GET /api/stats` | A | `DQSummary` |
| `GET /api/search?q=&limit=` | A | `list[str]` |
| `GET /api/trace/{victim}?max_hops=4` | A | `TraceResult` (nodes carry `risk` if B's table exists) |
| `GET /api/account/{acct}` | A | `AccountSummary` |
| `GET /api/account/{acct}/txns?limit=&offset=` | A | `list[TxnRow]` |
| `GET /api/ring/{acct}?t_from=&t_to=` | A | `RingResult` |
| `GET /api/ring/{acct}/export.zip` | A | ZIP: `transactions.csv` (original rows), `members.csv`, `manifest.json` |
| `GET /api/dq/summary` | A | `DQSummary` |
| `GET /api/risk/top?limit=&band=` | B | `list[RiskRow]` |
| `GET /api/risk/{acct}` | B | `RiskRow` |
| `GET /api/risk/reasons` | B | `dict[str, str]` (`REASON_LABELS`) |
| `GET /api/victims?limit=` | B | `list[VictimCandidate]` |
| `GET /api/export/flagged.csv` · `/ranked.csv` | B | CSV |
| `POST /api/docs/{victim}` (body `CaseInfo`) | C | `CaseOutput` |
| `GET /api/docs/{case_id}/{file}` | C | HTML / JSON |

Errors: return 404 with `{"detail": "..."}` for an unknown account. Money is **always integer paise** in JSON; the UI formats it as ₹ en-IN.

---

## 6. Real sample trace: `contracts/fixtures/trace_KKBK10000000.json`
Victim `KKBK10000000` lost ₹4,55,541.61 and its L1 is shared with 3 other victims. **The file in `contracts/fixtures/` is now real engine output** (identical to the JSON below except `data_sha256`).

```json
{"victim":"KKBK10000000","loss_paise":45554161,"elapsed_ms":0,"data_sha256":"FIXTURE","warnings":[],
 "freeze_candidates":["KKBK10001330","BARB10001377","ICIC10001309","AIRP10001422","AIRP10001372","ICIC10000335","PYTM10000639","HDFC10000815","ICIC10001095","AXIS10000585","PYTM10000679"],
 "nodes":[
  {"account":"KKBK10000000","role":"VICTIM","hop":0,"bank_prefix":"KKBK","bank_name":"Kotak Mahindra Bank","ifsc":"KKBK0001000","received_paise":0,"sent_paise":45554161,"held_paise":0,"first_in_ts":null,"risk":null},
  {"account":"ICIC10000335","role":"L1","hop":1,"bank_prefix":"ICIC","bank_name":"ICICI Bank","ifsc":"ICIC0001335","received_paise":45554161,"sent_paise":44643078,"held_paise":911083,"first_in_ts":"2026-09-22 01:13:51","risk":null},
  {"account":"ICIC10001095","role":"L2","hop":2,"bank_prefix":"ICIC","bank_name":"ICICI Bank","ifsc":"ICIC0002095","received_paise":8148025,"sent_paise":7822104,"held_paise":325921,"first_in_ts":"2026-09-22 01:17:24","risk":null},
  {"account":"PYTM10000639","role":"L2","hop":2,"bank_prefix":"PYTM","bank_name":"Paytm Payments Bank","ifsc":"PYTM0001639","received_paise":18520536,"sent_paise":17779714,"held_paise":740822,"first_in_ts":"2026-09-22 01:20:43","risk":null},
  {"account":"HDFC10000815","role":"L2","hop":2,"bank_prefix":"HDFC","bank_name":"HDFC Bank","ifsc":"HDFC0001815","received_paise":8873726,"sent_paise":8518777,"held_paise":354949,"first_in_ts":"2026-09-22 01:21:08","risk":null},
  {"account":"PYTM10000679","role":"L2","hop":2,"bank_prefix":"PYTM","bank_name":"Paytm Payments Bank","ifsc":"PYTM0001679","received_paise":2191087,"sent_paise":2103444,"held_paise":87643,"first_in_ts":"2026-09-22 01:23:51","risk":null},
  {"account":"AXIS10000585","role":"L2","hop":2,"bank_prefix":"AXIS","bank_name":"Axis Bank","ifsc":"AXIS0001585","received_paise":6909704,"sent_paise":6633316,"held_paise":276388,"first_in_ts":"2026-09-22 01:24:15","risk":null},
  {"account":"AIRP10001372","role":"L3","hop":3,"bank_prefix":"AIRP","bank_name":"Airtel Payments Bank","ifsc":"AIRP0002372","received_paise":2103444,"sent_paise":0,"held_paise":2103444,"first_in_ts":"2026-09-22 01:29:41","risk":null},
  {"account":"ICIC10001309","role":"L3","hop":3,"bank_prefix":"ICIC","bank_name":"ICICI Bank","ifsc":"ICIC0002309","received_paise":7822104,"sent_paise":0,"held_paise":7822104,"first_in_ts":"2026-09-22 01:30:05","risk":null},
  {"account":"BARB10001377","role":"L3","hop":3,"bank_prefix":"BARB","bank_name":"Bank of Baroda","ifsc":"BARB0002377","received_paise":8518777,"sent_paise":0,"held_paise":8518777,"first_in_ts":"2026-09-22 01:40:24","risk":null},
  {"account":"KKBK10001330","role":"L3","hop":3,"bank_prefix":"KKBK","bank_name":"Kotak Mahindra Bank","ifsc":"KKBK0002330","received_paise":17779714,"sent_paise":0,"held_paise":17779714,"first_in_ts":"2026-09-22 01:45:16","risk":null},
  {"account":"AIRP10001422","role":"L3","hop":3,"bank_prefix":"AIRP","bank_name":"Airtel Payments Bank","ifsc":"AIRP0002422","received_paise":6633316,"sent_paise":0,"held_paise":6633316,"first_in_ts":"2026-09-22 01:49:21","risk":null}],
 "edges":[
  {"txn_idx":0,"transaction_id":"TXN401119292","src":"KKBK10000000","dst":"ICIC10000335","ts":"2026-09-22 01:13:51","amount_paise":45554161,"attributed_paise":45554161,"hop":1,"delay_s":null,"rule":"seed","mode":"IMPS","narr_category":"task_refund","terminal":false},
  {"txn_idx":7,"transaction_id":"TXN214780864","src":"ICIC10000335","dst":"ICIC10001095","ts":"2026-09-22 01:17:24","amount_paise":8148025,"attributed_paise":8148025,"hop":2,"delay_s":213,"rule":"window","mode":"IMPS","narr_category":"settlement","terminal":false},
  {"txn_idx":9,"transaction_id":"TXN195086983","src":"ICIC10000335","dst":"PYTM10000639","ts":"2026-09-22 01:20:43","amount_paise":18520536,"attributed_paise":18520536,"hop":2,"delay_s":412,"rule":"window","mode":"IMPS","narr_category":"settlement","terminal":false},
  {"txn_idx":3,"transaction_id":"TXN892472963","src":"ICIC10000335","dst":"HDFC10000815","ts":"2026-09-22 01:21:08","amount_paise":8873726,"attributed_paise":8873726,"hop":2,"delay_s":437,"rule":"window","mode":"IMPS","narr_category":"settlement","terminal":false},
  {"txn_idx":1,"transaction_id":"TXN953843067","src":"ICIC10000335","dst":"PYTM10000679","ts":"2026-09-22 01:23:51","amount_paise":2191087,"attributed_paise":2191087,"hop":2,"delay_s":600,"rule":"window","mode":"IMPS","narr_category":"settlement","terminal":false},
  {"txn_idx":5,"transaction_id":"TXN806422153","src":"ICIC10000335","dst":"AXIS10000585","ts":"2026-09-22 01:24:15","amount_paise":6909704,"attributed_paise":6909704,"hop":2,"delay_s":624,"rule":"window","mode":"IMPS","narr_category":"settlement","terminal":false},
  {"txn_idx":2,"transaction_id":"TXN515751130","src":"PYTM10000679","dst":"AIRP10001372","ts":"2026-09-22 01:29:41","amount_paise":2103444,"attributed_paise":2103444,"hop":3,"delay_s":350,"rule":"window","mode":"UPI","narr_category":"crypto","terminal":true},
  {"txn_idx":8,"transaction_id":"TXN588978512","src":"ICIC10001095","dst":"ICIC10001309","ts":"2026-09-22 01:30:05","amount_paise":7822104,"attributed_paise":7822104,"hop":3,"delay_s":761,"rule":"window","mode":"UPI","narr_category":"crypto","terminal":true},
  {"txn_idx":4,"transaction_id":"TXN195243830","src":"HDFC10000815","dst":"BARB10001377","ts":"2026-09-22 01:40:24","amount_paise":8518777,"attributed_paise":8518777,"hop":3,"delay_s":1156,"rule":"amount_match","mode":"UPI","narr_category":"crypto","terminal":true},
  {"txn_idx":10,"transaction_id":"TXN583175063","src":"PYTM10000639","dst":"KKBK10001330","ts":"2026-09-22 01:45:16","amount_paise":17779714,"attributed_paise":17779714,"hop":3,"delay_s":1473,"rule":"amount_match","mode":"UPI","narr_category":"crypto","terminal":true},
  {"txn_idx":6,"transaction_id":"TXN968195900","src":"AXIS10000585","dst":"AIRP10001422","ts":"2026-09-22 01:49:21","amount_paise":6633316,"attributed_paise":6633316,"hop":3,"delay_s":1506,"rule":"amount_match","mode":"UPI","narr_category":"crypto","terminal":true}]}
```
Invariant you can test against: **Σ held_paise over the non-victim nodes = loss_paise** (45,554,161).

---

## 7. Timeline and milestones (hours from start; all three work in parallel)

| Window | A (main PC) | B | C |
|---|---|---|---|
| **0–1** | M0: repo, skeleton + stubs, `contracts/`, fixture, `sample.csv`, `CLAUDE.md`, push | Environment setup; scratch DuckDB with §5.1 SQL; start `eval/ground_truth.py` | Environment setup; start the Ollama model download; scaffold `web/`; save fixture locally |
| 1–6 | Ingest → derive → validate → account → graph arrays | `ground_truth.json` (**needed by A at ~h3**); features v1 | Trace graph view on the fixture; Evidence builder; diary + notice templates on the fixture |
| **M1 ≈ h6** | `/api/trace` live on the full file; fixture regenerated from real output | `detect.run` v1 on `sample.csv`; `get_risk_many` real | Graph renders the fixture; documents render the fixture |
| 6–14 | Trace accuracy ≥ 299/300; account/txns/search/dq routes | Risk v1 on the full file; exports; `/api/risk/*`; candidate victims | Switch to the live API: search → trace → account panel; slider |
| **M2 ≈ h14** | Ring + export; static serving; manifest/audit | Evaluation report v1 (precision/recall, per-role recall) | `routes_docs` end to end without the LLM; flagged list view |
| 14–22 | Benchmarks; performance; bug fixes | Weight tuning on half; test-data generator; run engine on synthetic data | Ring view (≈1,400 nodes); LLM narrator + validator; data-quality screen |
| **M3 ≈ h22** | Full end-to-end run on the main PC: ingest → trace → graph → documents → flagged CSV. Everyone fixes their part | | |
| 22–28 | Polish, hardening | Final threshold; final evaluation report | Polish UI and print layout; injection demo |
| **28 FREEZE** | Bug fixes only. Rehearse 5 random victims on the main PC, record timings, write the demo script | | |

**Status message at every milestone** (team chat): what's merged, what's stubbed, what's blocked.

---

## 8. Git and setup
- **Setup:**
  - Python 3.12: `pip install -e .[dev]` (duckdb, numpy, fastapi, uvicorn[standard], pydantic≥2, orjson, jinja2, httpx, psutil, pytest).
  - Node 20 LTS for `web/`.
  - Ollama for C and the main PC.
- **Data:** copy the official ZIP from the team drive into `data/`, unzip it, and check its SHA-256 against the value A posts.
- **Branches:** `a/…`, `b/…`, `c/…`. Keep PRs small, run `git pull --rebase origin main` first, and `pytest` must pass on `data/sample.csv`. A merges and runs on the full file after each batch of merges.
- **`main` is protected:** PRs only, no force-push.
- **Each Claude Code session starts with:** *"I am <A|B|C>. Read CLAUDE.md, plan/00_OVERVIEW.md, plan/<my file>.md and DATA_HANDLING.md. Only edit files I own."*
