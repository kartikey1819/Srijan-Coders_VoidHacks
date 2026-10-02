# Final integration: baseline audit

This audit was made on 2026-10-02, before any change in the final phase. Everything below was read from the code
or measured on the main PC (4 cores / 8 threads, 16 GB RAM, GTX 1650 4 GB, Windows 11, Python 3.12.10, DuckDB 1.5.6).

## 1. Architecture as implemented

```
CSV (evidence, never edited; SHA-256 recorded)
 └─ ingest/load.py      typed DuckDB read_csv → txn_raw; row order checked against the file (txn_idx = file row)
 └─ ingest/derive.py    txn: paise, epoch, narration category, IP class, device class, data-quality flags, dense ids
 └─ ingest/validate.py  dq_flags (never used by detection; guard test)
 └─ graph/build.py      out/in CSR arrays cached per input hash (.npy)
 └─ detect/             features (pass-through, fan-out, fan-in burst, terminal in/out, script/foreign out, sink,
                        repeated-ring cycles) → risk (grouped noisy-OR + floors, 2 passes, reasons, role hints)
 └─ engine.py           read-only facade: trace, account, txns, ring, search, dq
 └─ graph/trace.py      lots-based, time-respecting attribution (window → ≥90% pass-through → own-money-first), 4 hops
 └─ graph/ring.py       connected suspects + entry victims, export ZIP with byte-identical rows
 └─ api/                FastAPI: routes_trace (A), routes_risk (B), routes_docs (C), static web/dist
 └─ evidence/build.py   Evidence with E-ACC/E-TXN ids, trace hash, facts fingerprint, warnings, dq notes
 └─ ai/                 facts-only prompt → Ollama (qwen2.5:3b, bounded JSON schema) → validator → template fallback
 └─ docs/render.py      Jinja2 case diary + one s.94 BNSS / s.91 CrPC notice per bank + output firewall
 └─ web/                React + Cytoscape: Investigate, Ring, Flagged, Data quality, Documents dialog
```

## 2. Integration points (verified)
- **Routes and UI calls:** all 17 API routes are listed by OpenAPI. Every `/api/...` call in `web/src` maps to an existing route.
- **Detection → engine:** the engine reads `risk` through `detect.get_risk_many` / `flagged_accounts`. If the risk table is missing, it falls back to structural suspects for ring isolation.
- **Ingest → detection:** the pipeline runs `detect.run(con)` after indexing, then writes `flagged.csv` / `ranked.csv`.
- **Documents → AI:** `routes_docs` uses trace → txns → evidence → narrator (optional) → template merge → render → firewall → files + manifest.
- **Serving:** the server binds 127.0.0.1 with one worker. The DuckDB file is opened read-only while serving.

## 3. Test coverage at baseline
61 pytest tests:

| File | Tests | Covers |
|---|---|---|
| `test_api.py` | 6 | API |
| `test_detect.py` | 15 | detection |
| `test_docs.py` | 6 | documents |
| `test_ingest.py` | 5 | ingest |
| `test_trace.py` | 12 | trace |
| `test_validator.py` | 17 | validator |

They cover:
- trace accuracy, conservation and hop limit;
- pass-through boundaries (0/179/180/900/901 s);
- episode sizes;
- the terminal-direction rule;
- the official sample's precision and recall;
- the generator-literal guard;
- the document firewall;
- identical facts with the LLM on and off;
- the validator and injection suite;
- the simulated model;
- the document API.

There were no tests for: broken input files, empty datasets, randomized data, property-based checks, browser workflows,
live-model grounding, or AI-vs-detection isolation on stored tables.

## 4. Benchmarks at baseline (`bench/results.md`, `bench/llm_results.md`)
| Measure | Value |
|---|---|
| Ingest + index, 2M rows | best 10.86 s (runs 11.18 / 11.71 / 10.86), peak RSS 1,248 MB |
| Detection, 24,873 accounts | 27.38 s, peak RSS 1,214 MB |
| Victim trace (300) | p99 5.2 ms in process, 10.2 ms over HTTP |
| Any account as "victim" (worst) | 1,117 ms |
| Ring isolation | ~75 ms |
| LLM narrative (qwen2.5:3b on GPU) | 10/10 accepted, median 13 s |

Evaluation:
- **Official data:** precision 1.0000, recall 1.0000, 300/300 victims traced exactly.
- **Own synthetic data:** precision 1.0000, recall 0.945 and 0.925 (two seeds).

## 5. Unresolved TODOs
No TODO/FIXME/STUB markers in the code.

## 6. Assumptions discovered in the code
1. **The input must exactly match the 11-column schema.** `read_csv` is given an explicit typed column map.
2. **Timestamps are naive.** Their epoch is computed as UTC and only differences matter; display strings are the raw values.
3. **Bank names come from the 4-letter account prefix**, not from an IFSC registry.
4. **Cash-out ("terminal") is recognised only from narration keywords** (CRYPTO / WALLET). The foreign-proxy rule uses only the first IP octets 185 / 194, as in the statement.
5. **Detection weights are hand-set**; HIGH means a score ≥ 70.
6. **The trace starts from all of a victim's outflows** unless `seed_txn` is given. The UI cannot choose a disputed transfer.
7. **The raw `Payment_Mode` string travels into the LLM fact sheet** (`prompts.facts` → `t.mode`). That is untrusted text reaching the model.
8. **FastAPI's default `/docs` and `/redoc` pages load scripts from an internet CDN.** Not used by the app, but not offline-clean.
9. **Ingest replaces `case.duckdb`.** It cannot run while the server holds the file (by design: single writer).

## 7. Failures found while auditing (before any fix)
| # | Input | Observed | Expected |
|---|---|---|---|
| B1 | CSV with one row whose amount is not a number and one with an impossible date | ingest aborts: "txn_raw row order does not match the CSV" (DuckDB silently rejected the rows, so file row numbers shifted) | every row kept, bad values flagged |
| B2 | header-only CSV (no data) | `TypeError: 'NoneType' object is not subscriptable` | clean run with 0 rows |
| B3 | CSV missing the `Device_Type` column | DuckDB "Error when sniffing file" | a clear message naming the missing column |
| B4 | CSV with an extra column | same sniffing error | extra column ignored and recorded |

## 8. Known limitations carried into this phase
- **Detection on our own hard synthetic data** misses some mules: those with slower-than-15-minute splits, transfers from ordinary devices with weak links to other suspects, and cash-outs whose narration lacks wallet/crypto words.
- **Exact per-victim layers** on commingled synthetic data: only 6–9 of 80–120 victims.
- **The LLM role check** catches role words attached to IDs, but not phrasings like "including …" or "mule account (…)" with no role word.
