# A: Task List and Progress (main PC)

Status: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ blocked/issue
Updated as work proceeds. Brief: `plan/A_ENGINE.md`. B and C work in their own repos; we merge their work at the end (A11).

## M0: Bootstrap ✅
- ✅ A0.1 Repo layout, `.gitignore`, `.gitattributes` (CSV kept byte-exact), `pyproject.toml`, venv + deps
- ✅ A0.2 `contracts/models.py` + fixture (now **real engine output** for KKBK10000000)
- ✅ A0.3 Stubs for B (`detect/`, `routes_risk.py`) and C (`routes_docs.py`, `ai/narrator.py`)
- ✅ A0.4 `data/sample.csv`: 50,000 rows incl. all 2,954 chain rows
- ✅ A0.5 `CLAUDE.md`, plan files, `DATA_HANDLING.md` (dup-ID count corrected)
- ✅ A0.6 Pushed to `kizz-code/Srijan-coders` (`main`)

## M1: Engine core ✅
- ✅ A1 Ingest: SHA-256 + typed DuckDB load + row-order check against the file
- ✅ A2 Derived columns: narration category, IP/device class (raw values kept alongside)
- ✅ A3 Data-quality flags: RTGS_BELOW_MIN 59,747 · DUP_TXN_ID 4,502 rows · UPI_ABOVE_P2P_LIMIT 355 · others 0
- ✅ A4 Account table + dense IDs (24,873 accounts)
- ✅ A5 Graph arrays (out/in CSR)
- ✅ A6 Victim trace: **300/300 victims exact** (L1/L2/L3 sets + every transaction), money conserved in all
- ✅ A7 Engine facade + API: `/api/health`, `stats`, `dq/summary`, `search`, `trace`, `account`, `account/{id}/txns`, `ring`, `ring/{id}/export.zip`; `python -m abhedya serve`

## M2–M3: Ring, audit, benchmarks
- ✅ A8 Ring isolation: 1,373 nodes = 300 victims + 129 L1 + 559 L2 + 385 L3 (works without B's risk). Export ZIP rows are byte-identical to the CSV, with a hashed manifest
- ✅ A9 Audit log (JSONL), run manifest, static `web/dist` serving (activates once C's build exists)
- ✅ A10 Benchmarks → `bench/results.md` (see below)
- ⬜ A11 Integration: pull in B's and C's work, full-file run, `DEMO.md`, rehearse 5 random victims

## Measured (bench/results.md, this laptop: 4 cores / 16 GB)
| What | Result | Requirement |
|---|---|---|
| Ingest + index 2M rows | **9.4 s** (peak RAM 1.2 GB) | ≤ 60 s |
| Trace, 300 real victims | p99 **2.2 ms** (HTTP p99 4.0 ms) | ≤ 2 s |
| Trace, any account as "victim" (worst of 50 busiest) | max **0.44 s** | ≤ 2 s |
| Account summary | p99 47 ms | sub-second |
| Ring isolation | ~54 ms | — |

Tests: **38 passing** (`pytest`, runs on the committed sample). Latest full benchmark: `bench/results.md` (ingest 10.9 s, detection 27.4 s, victim trace p99 5 ms, worst "any account" trace ~1.1 s).

## Log
- **Docs fix:** 2,252 = repeated Transaction_ID occurrences; 4,502 = all rows involved. Flag counts the 4,502.
- **Trace design: three findings, all fixed** (real flaws, not tuning):
  1. A trace that only knew its own victim's money drained leftover commission into *other* victims' later transfers (32/300). Fix: trail accounts also hold their clean inflows as lots.
  2. Those clean inflows were counted even after being forwarded ("phantom money"). Fix: replay each trail account's own ledger in time order → 300/300.
  3. `amount_match` = one outflow carries ≥ 90% of an inflow's *original* amount (the statement's pass-through), not of a residue.
- **Performance:** busiest-account trace went 1.99 s → 0.44 s.
  - The lot-priority logic is now lazy.
  - DuckDB list-parameter binding (1.1 s for 1,174 IDs) was replaced with inline integer lists (10 ms). Noted in `CLAUDE.md` so B and C avoid the same trap.
- Attribution order: window-first and amount-first both give 300/300; window-first kept (the statement's 3–15 min rule).

## B: Detection, risk, evaluation (taken over here; brief: `plan/B_DETECTION.md`)
- ✅ B1 `eval/ground_truth.py` → `eval/ground_truth.json`: 300 victims, 129/559/385 = 1,073 mules, all 2,954 injected edges explained
- ✅ B2 `detect/features.py`: pass-through (strict/lenient), fan-out episodes, fan-in burst, terminal in/out, script/foreign out, sink ratio, cycles, network position
- ✅ B3 `detect/risk.py` + `params.py` + `reasons.py`: grouped noisy-OR, floors, bands, reason codes, role hints
- ✅ B4 `detect/__init__.py` API, exports (flagged/ranked CSV), candidate victims, `routes_risk.py`
- ✅ B5 `eval/evaluate.py` → `eval/report.md`: **precision 1.0000, recall 1.0000** (0 FP, 0 FN), every layer 100%, role hints 100%, score gap 27 pts (lowest mule 73, highest other 46), victims all MEDIUM, 300/300 traces exact. Detection takes 24.9 s
- ✅ B6 `tools/gen_testdata.py`: rule-following synthetic data (RBI/NPCI limits) with hard cases. Results on two unseen seeds: **precision 1.0000 / recall 0.945** (seed 7, `eval/report_synthetic.md`) and **1.0000 / 0.925** (seed 23, `eval/report_synthetic_23.md`); smurf rings 100%
- ✅ B7 `tests/test_detect.py` (boundaries 0/179/180/900/901 s, episodes k=2/3/7/8, direction rule, guard test). **31 tests pass**
- ✅ B7 extended: legal-presumption fallback, pro-rata pass-through, ring repetition vs one-off loops, cash-out-from-script floor, ambiguity warning, `seed_txn` API, risk routes

### What the synthetic data taught us (fixed, principled, official result unchanged)
- Detection recall 0.68 → 0.945:
  - A cash-out sent from a script device or foreign proxy is now evidence on its own (floor 70), mirroring the receiving side.
  - A cash-out channel plus at least half of the money linked to suspects is also a floor.
  - The cycle search now covers all accounts (5.8 s). It counts repeats of the *same* ring: busy merchants close one-off loops by chance (2 false positives, now 0); smurfing repeats a ring.
- Trace noise (median 20 → 2 extra accounts per victim): after direct evidence (the 3–15 min window, ≥ 90% pass-through), the trace now presumes the holder spends their own money first. This is the established *lowest intermediate balance* tracing rule, so leftover commission no longer leaks into grocery payments.
- Pass-through is judged per inflow transaction, with partly tainted inflows forwarded pro rata.
- New trace warning when money from several sources arrives at one account in the same 15-minute window (attribution is genuinely ambiguous there; the IO should review).
- **Known limits (by design, reported in the synthetic reports):** splits slower than 15 min, mule transfers from ordinary devices with weak links to other suspects, and cash-out narrations without wallet/crypto words are partly missed. The trace reproduces exact layers only for 6–9 of 80–120 synthetic victims (L1 always right, L2/L3 overlap ~0.55–0.60); on the official data it is 300/300.
- `trace` API now accepts `seed_txn` (trace from the disputed transaction when the victim also has normal spending). C's UI should offer this.

## C: Investigator UI, case documents, LLM narrator (brief: `plan/C_UI_DOCS.md`)
- ✅ C2 `evidence/build.py`: Evidence with stable IDs (E-ACC-001, E-TXN-0001), trace hash, trace warnings
- ✅ C3 `docs/`: case diary + one Section 94 BNSS (91 CrPC) notice per bank, A4 print layout, DRAFT watermark, **output firewall** (no account / IFSC / transaction ID / ₹ amount that isn't in the evidence)
- ✅ C4 `ai/`: facts-only prompt, Ollama narrator (JSON schema, temperature 0), validator, deterministic fallback
- ✅ C5 `routes_docs.py` (generate + serve case files, manifest, audit) + tests (docs, validator / injection suite, LLM on/off identical facts)
- ✅ C1 `web/`: React + Cytoscape. Investigate tab:
  - search with suggested victims;
  - layered Victim → L1 → L2 → L3 graph (ordered to avoid crossing lines; red = cash-out, dashed = slower than 15 min);
  - exact layer tables, account panel with risk reasons, minute-by-minute playback.
  Other tabs: Syndicate ring (all 1,373 accounts, export ZIP), Flagged accounts (reason chips, CSV), Data quality.
  Documents dialog. Shareable links `#trace=ACCOUNT`, `#ring=ACCOUNT`. Checked with headless Edge screenshots at desktop and narrow widths
- ✅ Tests: **57 passing** (documents, firewall, LLM on/off identical facts, validator + injection suite, simulated model, document API; an unknown `/api/...` path now returns 404 instead of the UI page)
- ⚠️ Ollama is not installed on this PC. The narrator is tested with a simulated model plus the fallback; installing Ollama and a model needs your OK

## Waiting on teammates (for A11)
- C: `web/`, `abhedya/{evidence,ai,docs}/`, `routes_docs.py`. Contract: `contracts/models.py`; sample: `contracts/fixtures/trace_KKBK10000000.json`.
