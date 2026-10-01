# A: Task List and Progress (main PC)

Status: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ blocked/issue
Updated by Claude as work proceeds. Brief: `plan/A_ENGINE.md`. B and C work in their own repos; we merge their work at the end (A11).

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

Tests: **18 passing** (`pytest`, runs on the committed sample).

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
- 🔄 B6 `tools/gen_testdata.py`: rule-following synthetic data with hard cases + engine run on it
- ✅ B7 `tests/test_detect.py` (boundaries 0/179/180/900/901 s, episodes k=2/3/7/8, direction rule, guard test). **31 tests pass**
- ⚠️ Note: L2/L3 score 73, close to the 70 threshold (two independent strong signals each). The B6 synthetic data will test this margin

## Waiting on teammates (for A11)
- C: `web/`, `abhedya/{evidence,ai,docs}/`, `routes_docs.py`. Contract: `contracts/models.py`; sample: `contracts/fixtures/trace_KKBK10000000.json`.
