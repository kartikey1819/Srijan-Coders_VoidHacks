# A: Task List and Progress (main PC)

Status: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ blocked/issue
Updated by Claude as work proceeds. Brief: `plan/A_ENGINE.md`. B and C work in their own repos; we merge their work at the end (A11).

## M0: Bootstrap
- ✅ A0.1 Repo layout, `.gitignore`, `pyproject.toml`, venv + deps (DuckDB 1.5.6, NumPy 2.5.3, FastAPI, Pydantic 2.13)
- ✅ A0.2 `contracts/models.py` + sample-trace fixture (extracted verbatim from plan/00)
- 🔄 A0.3 Stubs: `detect/` ✅, `ai/narrator.py`, 3 API routers, `app.py`
- ✅ A0.4 `tools/make_sample.py` → `data/sample.csv` (50,000 rows incl. all 2,954 chain rows, 7.2 MB)
- 🔄 A0.5 `CLAUDE.md`; plan files + `DATA_HANDLING.md` copied in ✅
- ⬜ A0.6 First commit + push to `kizz-code/Srijan-coders`

## M1: Engine core
- ✅ A1 Ingest: SHA-256 + typed DuckDB load + row-order check against the file
- ✅ A2 Derived columns (paise, epoch, narration category, IP/device class): no `other` narrations
- ✅ A3 Data-quality flags + `dq_summary`: RTGS_BELOW_MIN 59,747 · DUP_TXN_ID 4,502 rows · UPI_ABOVE_P2P_LIMIT 355 · all others 0
- ✅ A4 Account table + dense IDs (24,873 accounts)
- ✅ A5 Graph arrays (out/in CSR, .npy cache). **Ingest + index = 10.5 s** for 2M rows (budget 60 s)
- 🔄 A6 Victim trace: **300/300 victims exact**, money conserved in all, p99 0.6 ms. Remaining: TraceResult output + pytest
- ⬜ A7 Engine facade + `/api/trace`, search, account, txns, dq + `serve`

## M2–M3: Ring, audit, benchmarks
- ⬜ A8 Ring isolation + export ZIP
- ⬜ A9 Audit log ✅ (written), manifest ✅ (written), static `web/dist` serving
- ⬜ A10 Benchmarks → `bench/results.md`
- ⬜ A11 Integration: pull in B's and C's repos, full-file runs, demo script

## Log
- **Docs fix:** 2,252 = repeated Transaction_ID occurrences; 4,502 = all rows involved. Flag counts the 4,502.
- **Trace design: three findings, all fixed** (each was a real flaw, not tuning to the data):
  1. A per-victim trace that only knew its own victim's money drained leftover commission (2% at L1, 4% at L2) into *other* victims' later transfers. 32/300 → fixed by giving each trail account its clean inflows as lots too.
  2. Those clean inflows were counted at full value even when already forwarded ("phantom money"). Fixed by replaying each trail account's own ledger in time order. 274 → 300/300.
  3. "amount_match" now means one outflow carries ≥90% of an inflow's *original* amount (the statement's pass-through definition), not ≥90% of a residue.
- Attribution order: window-first and amount-first both give 300/300. Window-first kept (the statement's 3–15 min rule).
