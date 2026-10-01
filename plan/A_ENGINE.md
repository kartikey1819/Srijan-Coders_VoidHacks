# A — Engine + Integrator (main PC)

**You own:** ingest, validation, graph, victim trace, ring isolation, account lookup, API wiring, audit/manifest, benchmarks, and all merges.
**Your share of the jury score:** the 40% blind-victim trace (backend), plus the 10% for engineering.
**Read first:** `plan/00_OVERVIEW.md` (the contracts) and `DATA_HANDLING.md`.

## Deliverables others depend on (don't be late on these)
| When | What | Who needs it |
|---|---|---|
| h1 | Repo + skeleton + `contracts/models.py` + fixture + `sample.csv` + stubs + `CLAUDE.md` pushed | B, C |
| h6 | `Engine.trace` real + `/api/trace` live; fixture regenerated from real output | C |
| h10 | `/api/search`, `/api/account`, `/api/account/{id}/txns`, `/api/dq/summary` | C |
| h14 | `/api/ring` + export ZIP; FastAPI serves `web/dist` | C |
| h22 | Full end-to-end run on the main PC | everyone |

---

## A0. Bootstrap (h0–1). Do this before anything else
1. `git init` in a new folder `abhedya-chakra/`. Copy in `DATA_HANDLING.md` and `plan/`. Create the private GitHub repo, add B and C as collaborators, and protect `main` (PR required, no force-push).
2. `.gitignore`: `data/*` except `!data/sample.csv`, plus `*.duckdb`, `*.npy`, `cases/`, `testdata/`, `web/node_modules/`, `web/dist/`, `__pycache__/`, `.venv/`.
3. `pyproject.toml`: package `abhedya`, Python ≥3.12. Dependencies are listed in 00 §8. Add `[dev]` = pytest.
4. Create every folder in 00 §1 with an `__init__.py`. Write `contracts/models.py` **verbatim** from 00 §4, and the fixture JSON from 00 §6.
5. Stubs, so everyone can import from minute one:
   - `engine.py`: `get_engine()` returns an Engine whose `trace()` loads the fixture and whose other methods raise `NotImplementedError`.
   - `detect/__init__.py`: `get_risk_many` returns `{}`; `run` is a no-op.
   - `ai/narrator.py`: `narrate` returns `None`.
   - `api/app.py`: includes `routes_trace`, `routes_risk`, `routes_docs` (each an empty `APIRouter(prefix="/api")`) and mounts `web/dist` if it exists.
6. `tools/make_sample.py`: write `data/sample.csv` = header + every row whose narration contains `TASK_EARNING`, `SETTLEMENT` or `CRYPTO`, plus a seeded random 47,046 other rows, keeping the original order. Rows are copied byte-for-byte, never edited. This tool may use generator strings, because it's a test tool.
7. `CLAUDE.md`, from the template at the end of this file.
8. Post the official CSV's SHA-256 in the team chat. Push, then tell B and C "M0 is up".

## A1. Ingest: `ingest/load.py` (h1–2.5)
- `sha256_file(path)`, streamed in 8 MB chunks.
- Run the canonical SQL from 00 §5.1 into `txn_raw`, with DuckDB `threads` set to the CPU count and `preserve_insertion_order=true`.
- Check `rejects`; it should hold 0 rows. Print the count either way.
- Assert that `txn_idx` 0 is `TXN401119292` and 10 is `TXN583175063`.

## A2. Derive: `ingest/derive.py`
- Build `txn` from `txn_raw` with a single `CREATE TABLE txn AS SELECT …`:
  - `amount_paise = CAST(Amount*100 AS BIGINT)`;
  - `ts_epoch = epoch(ts)`;
  - `narr_base`, `narr_category` and `narr_instruction_like` (rules in 00 §5.3, as SQL `CASE` + `regexp_matches`);
  - `ip_octet1`, `ip_class`, `device_class`.
- On day 1, run `SELECT narr_base, count(*) … GROUP BY 1 ORDER BY 2 DESC` and check that no important category falls into `other`.

## A3. Validate: `ingest/validate.py`
- Compute `dq_flags` as a list built from the `DATA_HANDLING.md` §2 rules, in SQL.
- For `DUP_TXN_ID`, use a window `count(*) OVER (PARTITION BY transaction_id) > 1`.
- Write `dq_summary`. Expected counts: DUP_TXN_ID 4,502 rows (2,252 repeats); RTGS_BELOW_MIN 59,747; UPI_ABOVE_P2P_LIMIT 355; everything else 0.

## A4. Accounts and dense IDs
- `account` = union of senders and receivers, ordered by account string, with `acct_id = row_number()-1`, plus IFSC, prefix, bank name (from `docs/banks.py`; create that file with the map if C hasn't yet) and in/out counts, sums, first/last ts.
- Join back to fill `txn.src_id` and `txn.dst_id`.
- Expect **24,873** accounts.

## A5. Graph arrays: `graph/build.py`
- Pull the needed columns into NumPy in one query: `src_id, dst_id, ts_epoch, amount_paise, txn_idx, narr_category code (uint8), mode code (uint8)`.
- **Out-CSR:** order = `np.lexsort((txn_idx, ts_epoch, src_id))`, then `out_ptr = np.searchsorted(src_sorted, np.arange(V+1))`. Store `out_dst, out_ts, out_amt, out_txn, out_cat` in that order.
- **In-CSR:** the same, keyed by `dst_id`.
- Save to `data/cache/<sha256>/` as `.npy`. `serve` loads them with `np.load(mmap_mode=None)`.
- Expected size is about 2M × 27 B per direction.
- Print the stage timings for A1–A5; the total is the "ingest + index" number.

## A6. Victim trace: `graph/trace.py` (h3–8). This is the most important code in the project
**Model:** each account holds *lots* of victim money: `(lot_id, remaining_paise, arrival_epoch, hop)`. Money moves forward in time only and is conserved.

```
trace(victim, max_hops=4):
  seed: for each out-edge e of victim (time order):
        add Lot(remaining=e.amt, t=e.ts, hop=1) to dst; record edge(hop=1, attributed=e.amt, rule="seed")
  heap = [(lot.t, account) for each new lot]; expanded = set()
  while heap:
    pop account u (skip if u is terminal or all its lots are at max_hops)
    for e in out-edges(u) in time order, starting at the first e.ts >= earliest live lot.t:
        live = lots of u with remaining > 0 and lot.t <= e.ts and lot.hop < max_hops
        if no live lots: continue          (stop the scan once every lot is exhausted)
        take from lots in PRIORITY order until e.amt is covered or the lots run out:
          1. amount_match: e.amt is within [0.90, 1.00] × lot.remaining   (single-outflow pass-through, statement's ≥90%)
          2. window:       180 <= e.ts - lot.t <= 900                     (statement's 3–15 min)
          3. oldest:       smallest lot.t
          (within a level, the oldest lot wins; rule recorded = level of the first lot used)
        attributed = Σ taken; if attributed == 0: continue
        record edge(hop = lot.hop+1, delay_s = e.ts - lot.t, attributed, rule, terminal = e.cat in TERMINAL)
        add Lot(remaining=attributed, t=e.ts, hop=lot.hop+1) to e.dst
        if not terminal: push e.dst to heap
  roles:  hop==1 → L1;  received via a terminal edge → L3;  any other hop ≥ 2 → L2
          (an account seen at several hops keeps its smallest hop; L3 beats L2; L1 beats both)
  held = received - sent per account; freeze_candidates = held >= 100 paise, sorted desc
  fill node.risk from detect.get_risk_many(...)   (empty until B lands)
```
- **Attribution order is a measured choice.** Put `ATTRIBUTION_ORDER = ("amount_match","window","oldest")` in `config.py`. Run B's `eval/ground_truth.json` with this order and with `("window","amount_match","oldest")`, and keep whichever scores better. Write the result into the PR description.
- **Terminal receivers get the lot but are not expanded.** Max-hop receivers likewise.
- **Never** hard-code 0.96, 0.98 or narration strings. Use categories and `config.py` constants only.

**Tests (`tests/test_trace.py`):**
- **Conservation:** Σ held over non-victim nodes == loss_paise, exactly, for every victim in the ground truth.
- No edge with `ts` earlier than the lot it consumed; no hop above `max_hops`.
- `KKBK10000000` output equals the fixture, apart from `elapsed_ms` and `data_sha256`.
- **Accuracy:** ≥ 299/300 victims with exactly matching L1/L2/L3 sets against `eval/ground_truth.json`. Until B delivers it (~h3), use the fixture.
- **Latency:** p99 < 200 ms in-process over all 300 victims plus 1,000 random accounts. Use Numba only if this fails.

## A7. Engine + API: `engine.py`, `api/routes_trace.py` (h8–12)
- Implement every `Engine` method in 00 §3.
  - `search` = prefix match on `account` (a sorted NumPy array + `searchsorted` is enough).
  - `account()`: one SQL query for totals, plus top 10 counterparties by total in each direction, plus the modes/devices/ip_class/dq histograms.
- DuckDB: one connection opened at startup, and `con.cursor()` per request (FastAPI runs sync routes in threads).
- Serialise with orjson (`ORJSONResponse`).
- Routes exactly as in 00 §5.4. Unknown account → 404.
- `cli.py`:
  - `ingest --data PATH [--skip-detect]`;
  - `serve [--port 8000]`, which runs uvicorn with `workers=1` on host `127.0.0.1`.

## A8. Ring isolation: `graph/ring.py` (h12–14)
- `S = detect.flagged_accounts(con)`. Until B delivers, fall back to accounts that sent any `script`-device or `foreign_proxy` edge, or received a terminal-category edge.
- Starting from the seed (or its neighbours in S, if the seed isn't in S), run a BFS over edges whose endpoints are **both** in S and whose `ts` falls in `[t_from, t_to]` if given.
- Add the **entry accounts**: non-S senders into ring members whose `role_hint` is L1. These become role `VICTIM`. Cap at 1,000.
- Aggregate parallel edges into `GraphEdge` objects. Return the whole component with **no node cap**; expect about 1,373 nodes and 2,954 edges on the official file.
- `export.zip` contains:
  - `transactions.csv`: the original CSV rows, re-read from `txn` with the original column names and values;
  - `members.csv`;
  - `manifest.json` with SHA-256 of each file, the input SHA-256 and the parameters.
  Write an audit log entry for the export.

## A9. Audit, manifest, static files (h14)
- `audit/log.py`: JSONL in `data/audit.jsonl` with `{ts, action, params, result_sha256}`.
- `manifest.py`: input hash, row count, stage timings, git commit (`git rev-parse HEAD`), DuckDB/Python versions.
- `app.py` serves `web/dist/index.html` at `/` and its assets.

## A10. Benchmarks: `bench/run.py` (h14–22)
- Ingest stage times (3 runs).
- Peak RSS with psutil, sampled every 100 ms.
- Trace p50/p95/p99 for 300 victims + 1,000 random accounts + the 50 highest-degree accounts.
- `/api/trace` end-to-end latency over HTTP.
- Write `bench/results.md`, including machine specs.
- Show these numbers in the demo. **Never** claim a timing that isn't in this file.

## A11. Integration duty (continuous)
- Review and merge PRs every 2–3 hours. Run `pytest` before each merge.
- After merging, run `python -m abhedya ingest` on the full file, then `serve`, then click through one victim.
- At M3 (h22), run the full demo path, file bugs to the owners, and keep a `KNOWN_ISSUES.md`.
- At freeze (h28):
  - Build `web/` (`npm ci && npm run build`).
  - Run 5 random victims from `ground_truth.json` the way the judges will.
  - Write `DEMO.md`: the exact commands and the click path.

---

## `CLAUDE.md` template (commit this at M0)
```markdown
# Abhedya-Chakra — shared context for Claude Code
Offline money-mule investigation workstation for Void Hacks 8.0. Python 3.12 + DuckDB + NumPy + FastAPI; React + Cytoscape in web/.
Read plan/00_OVERVIEW.md (contracts) and DATA_HANDLING.md before coding.

## Ownership — edit only your own folders
- A: abhedya/{ingest,graph,audit,api/app.py,api/routes_trace.py,engine.py,cli.py,config.py}, contracts/, tools/make_sample.py, bench/
- B: abhedya/detect/, abhedya/api/routes_risk.py, eval/, tools/gen_testdata.py
- C: web/, abhedya/{evidence,ai,docs}/, abhedya/api/routes_docs.py
Need a change in someone else's file or in contracts/? Ask its owner; don't edit it.

## Rules
- The official CSV is evidence: never edit, re-save or "clean" it. Every row is kept; txn_idx is the key; Transaction_ID is NOT unique.
- Account IDs and IFSCs are strings. Money is integer paise everywhere.
- abhedya/ never imports eval/. No generator strings (TASK_EARNING, INTERNAL_SETTLEMENT, P2P_CRYPTO) or 0.96/0.98 ratios in abhedya/.
- Data-quality flags never feed the risk score.
- Raw narration is never sent to the LLM. The LLM never writes numbers, account IDs or transaction IDs.
- Don't claim any timing that isn't in bench/results.md.

## Commands
- pip install -e .[dev]  ·  pytest  ·  python -m abhedya ingest --data data/<file>.csv  ·  python -m abhedya serve
- web: cd web && npm install && npm run dev (proxy /api → 127.0.0.1:8000)

## Git
Branch a/… b/… c/…; small PRs; git pull --rebase origin main first; pytest must pass on data/sample.csv. Never push to main or force-push.
```
