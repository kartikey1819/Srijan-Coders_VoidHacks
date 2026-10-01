# Abhedya-Chakra: shared context for Claude Code

Offline money-mule investigation workstation for Void Hacks 8.0. Stack: Python 3.12, DuckDB, NumPy and FastAPI; React + Cytoscape in `web/`.
Read `plan/00_OVERVIEW.md` (the contracts) and `DATA_HANDLING.md` before coding. A's progress is tracked in `A_TASKLIST.md`.

## Ownership: edit only your own folders
- **A:** `abhedya/{ingest,graph,audit}/`, `abhedya/api/app.py`, `abhedya/api/routes_trace.py`, `abhedya/{engine,cli,config}.py`, `contracts/`, `tools/make_sample.py`, `bench/`, `tests/test_{ingest,trace,api}.py`
- **B:** `abhedya/detect/`, `abhedya/api/routes_risk.py`, `eval/`, `tools/gen_testdata.py`, `tests/test_detect.py`
- **C:** `web/`, `abhedya/{evidence,ai,docs}/`, `abhedya/api/routes_docs.py`, `tests/test_{docs,validator}.py`

Files marked `STUB` were created by A only so imports work; their owner replaces them. Need a change in someone else's file or in `contracts/`? Ask its owner; don't edit it.

## Rules
- The official CSV is evidence: never edit, re-save or "clean" it. Every row is kept. `txn_idx` (0-based file row) is the key; `Transaction_ID` is **not** unique.
- Account IDs and IFSCs are strings. Money is integer paise everywhere.
- `abhedya/` never imports `eval/` or `tests/`. No generator strings (`TASK_EARNING`, `INTERNAL_SETTLEMENT`, `P2P_CRYPTO`) and no 0.96/0.98 ratios in `abhedya/`; use `narr_category` values.
- IP address and device describe the **sender** of a transaction.
- Data-quality flags never feed the risk score.
- Raw narration is never sent to the LLM. The LLM never writes numbers, account IDs or transaction IDs.
- Don't claim any timing that isn't in `bench/results.md`.
- DuckDB performance trap: never bind a Python list as a query parameter (`IN (SELECT unnest(?))`, `= ANY(?)`). It costs about 1 ms per element (1.1 s for 1,174 ids). Inline integer lists instead (see `_ints_sql` in `abhedya/engine.py`), and map account strings to `acct_id` integers first.

## Engine API for B and C (`abhedya/engine.py`)
`get_engine()` provides `.trace(victim, seed_txns=None)` (optionally from the disputed transaction(s), by `txn_idx`), `.account(acct)`, `.account_txns(acct)`, `.txns(idxs)`, `.ring(seed)`, `.search(prefix)` and `.cursor()` (a DuckDB cursor, read-only). They return the models in `contracts/models.py`.

## Commands
- Setup: `python -m venv .venv`, then `.venv\Scripts\pip install -e .[dev]`
- `python -m abhedya ingest --data data/VoidHacks8_MuleAccount_2M_Transactions.csv` (put the CSV in `data/`; it's gitignored)
- `python -m abhedya serve`, then open http://127.0.0.1:8000 (API under `/api`)
- `pytest`: tests run on the committed `data/sample.csv`
- Web (dev): `cd web && npm install && npm run dev` (proxy `/api` → 127.0.0.1:8000)
- Web (demo): `cd web && npm run build`, then `python -m abhedya serve` serves the UI at http://127.0.0.1:8000
- Optional AI narrative: install Ollama, `ollama pull qwen2.5:3b` (override with env `ABHEDYA_LLM_MODEL`). Without it, documents use the template narrative
- Evaluation: `python -m eval.ground_truth`, then `python -m eval.evaluate` → `eval/report.md`
- Synthetic stress data: `python tools/gen_testdata.py --seed 7` → `testdata/` (gitignored, reproducible from the seed)
- Benchmarks: `python bench/run.py` → `bench/results.md`
