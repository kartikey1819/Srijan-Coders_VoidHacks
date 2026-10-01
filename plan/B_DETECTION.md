# B — Detection, Risk Score, Evaluation, Test Data

**You own:** `abhedya/detect/`, `abhedya/api/routes_risk.py`, `eval/`, `tools/gen_testdata.py`, `tests/test_detect.py`.
**Your share of the jury score:** the 30% detection precision/recall. You also act as the "judge simulator" that checks A's trace.
**Read first:** `plan/00_OVERVIEW.md` (contracts §3–§5) and `DATA_HANDLING.md`.

## Deliverables others depend on
| When | What | Who needs it |
|---|---|---|
| **h3** | `eval/ground_truth.json` committed | A (trace accuracy tests) |
| h6 | `detect.run`, `get_risk_many`, `flagged_accounts` working on `data/sample.csv` | A (trace nodes, ring) |
| h12 | Risk on the full file; `/api/risk/*`, `/api/victims`, `/api/export/*` live; `REASON_LABELS` | C (account panel, flagged list) |
| h14 | `eval/report.md` v1 | everyone |
| h22 | Synthetic test dataset + engine results on it | A, demo |

**Start at hour 0 without waiting.** Load the official CSV into a scratch DuckDB (`scratch.duckdb`, gitignored) using the SQL in 00 §5.1, plus the derive rules in 00 §5.3, so your `txn` table matches A's. Once A's ingest lands, switch to `data/case.duckdb`.

---

## B1. Ground truth: `eval/ground_truth.py` → `eval/ground_truth.json` (h0–3)
This is the **only** code allowed to use knowledge of how the dataset was generated: narration strings and exact amount ratios. It is a test oracle, never imported by `abhedya/`.
- **Victims:** senders of `…TASK_EARNING_REFUND…` edges. Expect 300, each with exactly one such edge.
- **L1** of a victim: the receiver of that edge.
- **L2** of a victim: receivers of `…INTERNAL_SETTLEMENT…` edges sent by that L1 within 180–900 s after the victim's payment. Each settlement has exactly one victim in that window. Expect 3–6 L2s per victim.
- **L3** of a victim: receivers of `…P2P_CRYPTO…` edges sent by those L2s whose amount equals `round(settlement × 0.96, 2)` for one of that victim's settlements into the L2.
- Output:
  ```json
  {"victims": {"<acct>": {"loss_paise": 0, "L1": [], "L2": [], "L3": [], "txn_idxs": []}},
   "mules": [], "mules_by_role": {"L1": [], "L2": [], "L3": []},
   "counts": {"victims": 300, "L1": 129, "L2": 559, "L3": 385, "mules": 1073}}
  ```
- Assert those counts, and that L1, L2 and L3 don't overlap. Commit the JSON (it's small).

## B2. Features: `detect/features.py` (h1–8)
One row per account, written to table `features`. Use DuckDB SQL for counts and windows, and NumPy/Python loops over per-account event streams for pass-through. **IP and device belong to the sender of a transaction.**

| Feature | Definition | Mainly catches |
|---|---|---|
| `n_in, n_out, uniq_senders, uniq_receivers` | counts | context |
| `pt_strict` | FIFO-match inflow lots to later outflows (no opening balance; outflows with no prior inflow are "unfunded" and skipped). Matched amount with delay ∈ **[180, 900] s** ÷ total inflow | L1 |
| `pt_lenient` | same, delay ∈ [0, 900] s | L1 |
| `pt_outflows` | number of distinct outgoing transfers inside the matched windows (statement: "multiple outgoing") | L1 |
| `episodes_3_7` | number of inflows followed within 900 s by outflows to **k distinct receivers, k ∈ [3,7]** | L1 (the fan-out step) |
| `max_episode_k` | largest k seen | L1 |
| `burst_senders_60m` | max distinct senders in any 60-min window | collectors |
| `term_out_n` | outgoing edges with `narr_category` ∈ {crypto, wallet} | L2 |
| `term_in_n` | **incoming** edges with `narr_category` ∈ {crypto, wallet} | **L3** |
| `script_out_n` | outgoing edges with `device_class = script` | L1/L2 |
| `foreign_out_n` | outgoing edges with `ip_class = foreign_proxy` | L1/L2 |
| `term_in_from_anom` | incoming terminal edges whose sender used a script device or foreign IP | **L3** |
| `sink_ratio` | 1 − sum_out/sum_in (clipped to 0..1) | L3 |
| `cycles_2_4` | time-respecting cycles of length 2–4 returning within 24 h, amounts within ±20%. Only search from accounts above the median on another signal | statement requirement (expect ~0 on this file) |
| `in_from_flagged`, `out_to_flagged` | second pass: share of in/out amount from/to accounts flagged in pass 1 | network position |

All thresholds (180, 900, [3,7], 60 min, 24 h, ±20%) live in `detect/params.py` as a Pydantic `DetectParams`. The params hash is stored in `risk.params_hash`.
**Forbidden in `abhedya/detect/`:** narration literals, 0.96/0.98, `dq_flags`, anything imported from `eval/`.

## B3. Risk score: `detect/risk.py` (h6–12)
- Signal groups, each scaled to 0..1:
  - **G1 velocity:** `pt_strict`, gated by `pt_outflows ≥ 2`.
  - **G2 topology:** max(episodes signal, burst signal, 0.3 × cycle signal).
  - **G3 terminal/channel:** max(term_out, term_in_from_anom, script_out, foreign_out, term_in × sink_ratio).
  - **G4 network:** max(in_from_flagged, out_to_flagged).
- `score = round(100 × (1 − Π_g (1 − w_g · s_g)))`. Starting weights: G1 0.60, G2 0.45, G3 0.55, G4 0.40. Tune them (B5).
- **Floors:**
  - `pt_strict ≥ 0.90` and `pt_outflows ≥ 2` → at least 70;
  - `episodes_3_7 ≥ 1` with `pt_strict ≥ 0.5` → at least 60;
  - `term_in_from_anom ≥ 1` → at least 70.
- **Bands:** HIGH ≥ 70 (this is "flagged"), MEDIUM 40–69, LOW < 40. Choose the final threshold at the natural gap in the score histogram. **Never** pick it to hit a count of 1,500.
- **`role_hint`:**
  - L3 if `term_in_n > 0` and `sink_ratio > 0.5`;
  - otherwise L2 if `term_out_n > 0`;
  - otherwise L1 if `episodes_3_7 ≥ 1` or `pt_strict ≥ 0.9`;
  - otherwise null.
- **Reason codes** go in `detect/reasons.py`, with `REASON_LABELS` (code → plain-English label for the UI):
  `PT_STRICT:x`, `PT_LENIENT:x`, `FANOUT_EPISODES:n`, `FANIN_BURST:n`, `TERM_OUT:n`, `TERM_IN:n`, `TERM_IN_FROM_SCRIPT_OR_FOREIGN:n`, `SCRIPT_DEVICE_OUT:n`, `FOREIGN_PROXY_IP_OUT:n`, `CYCLE:len`, `SINK:x`, `LINKED_TO_FLAGGED:x`. Only codes that fired are stored; highest contribution first.
- Run two passes: pass 1 without G4, compute the flagged set, then pass 2 with G4.

## B4. Public functions, exports, API (h8–12)
- Implement the 00 §3 functions: `run`, `get_risk_many`, `top`, `flagged_accounts`, `candidate_victims`.
- `candidate_victims`: accounts **not** flagged whose outflows go into HIGH accounts with `role_hint = L1`, ranked by amount. The UI shows these as suggested victims, and you use them for rehearsal.
- `detect/export.py` writes:
  - `data/exports/flagged.csv`: `account, ifsc, bank_name, score, band, role_hint, reasons (;-joined), n_in, n_out, sum_in_paise, sum_out_paise`;
  - `ranked.csv`: every account, sorted by score.
  Log both with `audit.log("export", …, sha256)`.
- `api/routes_risk.py`: the routes in 00 §5.4.
- `detect.run` must take **≤ 60 s** on the full file on the main PC. Report it; add Numba to the PT loop only if it's slower.

## B5. Evaluation: `eval/evaluate.py` → `eval/report.md` (h12–14, then rerun often)
1. **Detection:** precision, recall, F1, and FP/FN counts against `mules` (1,073) at the chosen threshold.
   - Recall **per role**. L3 is the one at risk.
   - A threshold sweep from 30 to 90 in steps of 5, shown as a table.
   - The top 30 false positives with their reasons, and all false negatives with their features.
2. **Tuning honesty:** split mules and background accounts by `hash(account) % 2`. Tune weights on half 0 only and report the final numbers on half 1.
3. **Trace accuracy** (checks A's work): for each of the 300 victims, call `Engine.trace` and compare the L1/L2/L3 sets with the ground truth. Report the exact-match count, the Jaccard per role, and the failing victims. Re-run it on every A merge that touches `graph/`.
4. Also note in the report: the statement says 1,500 mules, but the file only contains 1,073. State the maximum achievable recall if the judges score against 1,500.

**Targets on the official file:** precision ≥ 0.98, recall ≥ 0.98 against the 1,073 mules, every role ≥ 0.97, trace exact match ≥ 299/300.

## B6. Rule-following synthetic data: `tools/gen_testdata.py` (h14–22)
- A NumPy-based generator, seeded, with the same 11 columns and the same ID/IFSC format as the official file.
- Writes `testdata/SYNTHETIC_TEST_<seed>.csv` plus `testdata/SYNTHETIC_TEST_<seed>.truth.json` (same schema as `ground_truth.json`).
- Follows the real rules: UPI ≤ ₹1 L, IMPS ≤ ₹5 L, RTGS ≥ ₹2 L, NEFT any. Timestamps in a 15-day window.
- Hard cases, each switchable by a flag:
  1. Mules that also have normal background traffic.
  2. Several victims hitting the same L1 within minutes of each other.
  3. L1 → L2 delays partly outside 3–15 min; L2 → L3 delays of 2–60 min.
  4. Variable commission (0–8%) instead of a fixed ratio.
  5. Real time-respecting cycles (smurfing loops).
  6. High fan-in merchants and salary accounts that are **not** mules.
  7. Narration variants (`CRYPTO-P2P`, `WALLET TOPUP`, ...).
  8. Some L3s that forward once more (a 4th hop).
- `--rows` option: 200k for quick tests, 2M for the stress run.
- Run the full engine (ingest → detect → trace for every truth victim) on it, and add a "Synthetic" section to `eval/report.md`. This proves the engine follows the statement's rules rather than quirks of the official file.

## B7. Tests: `tests/test_detect.py`
- Pass-through boundaries: delay 0 / 179 / 180 / 900 / 901 s; partial dispersal; multiple lots; an unfunded outflow.
- Episodes with k = 2 / 3 / 7 / 8.
- `term_in` vs `term_out` direction, i.e. the sender-side IP/device rule.
- Score lies in 0..100, floors apply, and reasons are ordered.
- **Guard test:** grep `abhedya/detect/` for `TASK_EARNING|INTERNAL_SETTLEMENT|P2P_CRYPTO|0\.96|0\.98|dq_flags|from eval` and fail if anything matches.
