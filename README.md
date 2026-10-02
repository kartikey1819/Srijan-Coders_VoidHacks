# Abhedya-Chakra

Offline money-mule investigation workstation (Void Hacks 8.0, Indore Police problem statement).
Load a bank transaction CSV, see every account's mule risk (0–100, with reasons), trace a complainant's
money through up to 4 hops, isolate the whole ring, and produce a police case diary plus one
Sections 94 & 106 BNSS (91 & 102 CrPC) freeze notice per bank. Everything runs on one machine; nothing is uploaded.

## Start (one command)

```
python -m venv .venv && .venv\Scripts\activate        # Linux/macOS: source .venv/bin/activate
pip install -e .
cd web && npm install && npm run build && cd ..       # the investigator UI (once)
python -m abhedya serve --data data/VoidHacks8_MuleAccount_2M_Transactions.csv
```

Open http://127.0.0.1:8000. `serve --data` ingests the file first if the database is missing or was built
from a different file (checked by SHA-256), then serves. The CSV itself is evidence and is only ever read.

Other commands:

| Command | What it does |
|---|---|
| `python -m abhedya ingest --data <csv>` | load + validate + index + detect, without serving |
| `python -m abhedya serve` | serve the existing database |
| `python bench/run.py` | 2M benchmarks (writes `bench/results.md`) |
| `python bench/llm_check.py --n 10` | live AI model acceptance and latency (writes `bench/llm_results.md`) |
| `python -m pytest` | all tests (`pip install -e .[dev]`; browser workflows also need `pip install playwright` and Microsoft Edge) |

## Optional: local AI narrative

The case diary's summary, modus operandi and recommendation can be drafted by a local model through
[Ollama](https://ollama.com) (`ollama pull qwen2.5:3b`). The model sees only evidence IDs and facts, never raw
narration, IP or device text. Every reply is checked by `abhedya/ai/validator.py` (no number, account, bank,
date or role it was not given; no conclusions of guilt). A rejected reply, or no model at all, falls back to fixed templates, so
documents are always produced. Every account, amount and transaction ID in a document is inserted from
the evidence, never written by the model. Detection and tracing never use the model.

## How it works

Team guide (what everything does, how to run, test and demo it, results): [`docs/TEAM_GUIDE.md`](docs/TEAM_GUIDE.md). Full technical walkthrough (every stage, algorithm and parameter): [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md).

| Part | Where | Notes |
|---|---|---|
| Ingest | `abhedya/ingest/` | DuckDB, tolerant reader: every row is kept, bad values are flagged (`DQ` screen) and left out of the money graph |
| Graph | `abhedya/graph/build.py` | NumPy CSR arrays, cached per input hash |
| Detection | `abhedya/detect/` | pass-through speed, fan-out/fan-in, repeated rings, channel and network signals → grouped noisy-OR score, floors, reason codes |
| Trace | `abhedya/graph/trace.py` | per-account ledger replay: 3–15 min window, then ≥90 % amount match, then own-money-first; conserves every paisa |
| Ring | `abhedya/graph/ring.py` | the connected syndicate around an account, with time filter and CSV/ZIP export |
| Documents | `abhedya/evidence/`, `abhedya/docs/` | evidence self-check, output firewall (every figure must come from the evidence), facts fingerprint |
| UI | `web/` | React: dashboard with dataset in use and upload, trace tree with time slider, network money flow, trail and globe, documents |

## Results

- Official data: precision 1.0000, recall 1.0000 over the 1,073 mule accounts; 300/300 victim traces exact.
- Performance on 2M rows: `bench/results.md`. Live AI model: `bench/llm_results.md`.
- Independent and adversarial testing (data generated from published laundering patterns, not from the
  official file): `reports/final_test_matrix.md`, `reports/final_readiness_report.md`, `reports/adversarial/`.
