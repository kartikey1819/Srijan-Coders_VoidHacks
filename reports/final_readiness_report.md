# Final readiness report

Date: 2026-10-02. Code: `main` of this repository (this report's commit). Machine: Intel Core i5-10300H (4 cores / 8
threads), 15.8 GB RAM, GTX 1650 (used only by the optional local AI model), Windows 11, Python 3.12.10, DuckDB 1.5.6.
Every number below was measured by a script in this repository; the scripts and their outputs are named in each
section. Test-by-test detail: `reports/final_test_matrix.md`.

## Verdict

**Ready for submission and demo**, with the limitations in section 9 stated openly. All 182 automated tests
pass (0 skipped, including the live AI model and the 10 browser workflows). The official file is processed in
**26.7 s** (median) end to end, against a 60 s budget for ingest alone. The official evaluation is unchanged at
precision and recall 1.0000, with 300 / 300 exact traces. Over 656k rows of independently generated data, the engine finds
91.5–91.9 % of clear-cut mules with 4 false positives among 18,839 legitimate accounts.

## 1. Integration: PASS
- One command: `python -m abhedya serve --data <csv>` ingests when the database is missing or was built from a
  different file (SHA-256 check), then serves on 127.0.0.1. Bad input ends with a plain message.
- The API and UI types agree field by field: `tests/test_contract.py`, 15 models.
- The real UI runs on the real API in headless Microsoft Edge: `tests/test_e2e_workflows.py`, 11 / 11. The
  workflows cover the flagged account, exact layers, ring of 1,373 accounts, time slider, diary, bank notice, AI on,
  AI off, model unavailable, invalid account and the data-quality screen.
- The UI can now pick the disputed transfer(s) a trace starts from (`DisputedPicker`).

## 2. Official dataset (`eval/report.md`, `python -m eval.evaluate`)
| Measure | Result |
|---|---|
| Precision / recall (HIGH band, score ≥ 70) | **1.0000 / 1.0000** (1,073 TP, 0 FP, 0 FN) |
| Role hint correct (L1 / L2 / L3) | 1.0000 / 1.0000 / 1.0000 |
| Score gap, lowest mule vs highest other account | 27 points (73 vs 46) |
| Blind-victim traces, exact layers and transactions | **300 / 300** |
| File integrity | SHA-256 `2c9f81fd…f73101` before and after every run; the file is only read |

The ground truth is built by `eval/ground_truth.py` from the generator's own markers. It is never imported by
`abhedya/`, which `tests/test_detect.py::test_no_generator_knowledge_in_engine` checks. The statement says 1,500 mules
but the file contains 1,073; the list is not padded.

## 3. Independent data (`tests/adversarial_data/`, `reports/adversarial/`)
We wrote a scenario generator from published laundering typologies (`reports/external_pattern_research.md`:
AMLworld / NeurIPS 2023, FBI–Europol mule PSA, FinCEN advisories). It has 9 laundering and 14 legitimate
families, and its labels come from what each scenario means, not from the engine. Narration wording comes in
two vocabularies: *dev* (seen while fixing) and *holdout*.

| Suite | Worlds / rows | Clear-cut mules (MUST_FLAG) | 1-indicator mules (SHOULD_FLAG) | False positives (MUST_NOT_FLAG) | Victim L1 found | Trace recall / precision |
|---|---|---|---|---|---|---|
| small, dev | 20 / 60,085 | 91.5 % | 42.4 % | 0 / 1,739 | 280 / 280 | 0.979 / 0.980 |
| small, holdout | 20 / 59,125 | 91.7 % | 42.2 % | 0 / 1,741 | 272 / 272 | 0.985 / 0.975 |
| medium, dev | 10 / 178,804 | 91.8 % | 42.5 % | 2 / 5,125 | 845 / 845 | 0.980 / 0.982 |
| large, holdout | 3 / 358,124 | 91.9 % | 42.2 % | 2 / 10,234 | 1,693 / 1,693 | 0.978 / 0.983 |

Money-conservation and time-order invariants were violated 0 times. The rerun on the final code gives
identical results, field by field, apart from timings.

**Honesty note:** the first holdout run, before the vocabulary fix, found only 56.8 % of clear-cut mules
(`reports/adv_holdout_prefix.md`). The fix was made after seeing that, so the later holdout numbers are no longer
a clean holdout. They show the fix works on wording the dev runs never used, not untouched generalisation.

## 4. Adversarial tests
| Area | Tests | Result |
|---|---|---|
| Broken input: malformed values, header-only, empty, missing / extra / reordered columns, BOM, CRLF, quoted newlines, duplicates, hostile text | `test_robustness.py` (8) | pass; every row kept and flagged, the source file never modified |
| Time boundaries 179 / 180 / 181 s and 899 / 900 / 901 s; 90 % amount edge (900.00 vs 899.99); same-second ties; 12 outflows in one second | `test_adversarial_shapes.py` | pass |
| Network shapes: hub with 6,000 edges (built and traced in 4.9 s), dense 40-account clique (0.5 s), 30-hop chain (stops at 4) | `test_adversarial_shapes.py` | pass; money balances in every case |
| Property tests, about 120 random datasets: score bounds, conservation, determinism, unrelated component, data-quality flags never change risk, file order | `test_properties.py` (6) | pass |
| Known traps: two-account back-and-forth, one-off wallet top-up, drained collector, repeated ring vs one-off loop | `test_detect.py` | pass |

## 5. False positives
- Official: 0.
- Independent: 4 of 18,839 legitimate accounts (family_pool × 3, background × 1).
- The AMBIGUOUS tier (legitimate accounts showing ≥ 2 of the statement's own mule indicators) is flagged
  75–83 % of the time. This is mostly small payroll runs (salary in, many quick payouts) and wallet providers
  (many senders, fast onward). On the statement's own definition those look like mules; an investigator decides.
  The reason codes say why each was flagged.

## 6. Performance on 2,000,000 rows (`bench/results.md`, `bench/run.py --runs 5`)
Each run is a fresh process; figures are min / median / max over 5 runs. The OS file cache is not flushed.

| Test | Time (s) | Peak memory |
|---|---|---|
| 1. Ingest + index (budget 60 s) | 12.12 / **12.65** / 12.71 | 1,380 MB |
| 2. Detection, all 24,873 accounts | 12.67 / **12.79** / 12.85 | 864 MB |
| 3. Complete pipeline (1 + 2) | 25.21 / **26.71** / 26.98 | 1,376 MB |
| 4. Query side: engine load, cold | 0.06 / 0.06 / 0.13 | 376 MB |

Detection breakdown (median): ring search 6.09 s, pass-through / fan-out / fan-in 3.76 s, counts and channels
2.43 s, scoring 0.05 s, writing tables 0.15 s.

Investigation, warm (p50 / max):
- 4-hop victim trace: 3.7 / 11.3 ms. Over HTTP: 5.3 / 8.2 ms. The first trace in a new process takes 11 ms.
- Busiest accounts used as "victim": 467 / 588 ms.
- Full investigation (trace, every trail account, ring, evidence and documents): 498 / 566 ms.
- Diary plus notices: 41.8 ms. Validator: 1.2 ms.
- HTTP server start to first answer: 1.45 s.

## 7. AI narrative: grounding, prompt injection, fallback
- **Grounding** (`test_llm_grounding.py`, `test_validator.py`: 53 tests). The validator rejects:
  - 20 hostile model replies;
  - numbers, accounts, banks, dates, times and IPs not in the evidence;
  - guilt language;
  - wrong roles or banks for an evidence ID;
  - non-English output.
  Honest replies are accepted. Documents are refused if the evidence is internally inconsistent.
- **Prompt injection.** The model receives only evidence IDs and facts. Narration, IP and device text never
  reach it, and payment mode is reduced to UPI / IMPS / NEFT / RTGS / "other channel". A test plants injection
  text in every field and checks the prompt.
- **Isolation.** Hashes of the risk, feature and transaction tables are identical with the AI on, off or failing,
  and the AI path holds a read-only connection. Accounts, amounts and transaction IDs in documents always come from
  the evidence.
- **Live model** (`bench/llm_results.md`; qwen2.5:3b on the GPU):
  - **8 / 10** replies accepted;
  - median 15.3 s per narrative, 26.3 s for the first (model load);
  - the 2 rejections were genuine mistakes: layer-2 accounts called "collector", and accounts given the wrong
    bank. The template was used instead, and the facts were identical.
- **Fallback.** With the model stopped, documents are still produced, in 1.26 s (was 2.3 s; see bug 18).
  With the AI switched off they take 41 ms.

## 8. Security (`test_security.py`, 24 tests; `test_api.py`)
- **Path traversal** (encoded `../`, `..\`, through the docs and asset routes) never serves a file outside the app.
- **Injection-shaped IDs** (quotes, `DROP TABLE`, NUL byte, 5,000 characters) on every account route give a clean
  404 / 422, and the database is unchanged. The NUL-byte case found bug 19.
- **Limits:** hops ≤ 8, row limits are capped, and a malformed `seed_txn` is rejected.
- **HTML escaping:** documents escape hostile case fields (`<script>`, attribute breakout). Jinja autoescape is on,
  plus the output firewall.
- **Network:** the server binds 127.0.0.1 only, with one worker. There are no CDN pages, and nothing leaves the
  machine.

## 9. Remaining issues and limitations (stated, not hidden)
1. **Funnel accounts** (many depositors, then drained) are found only about 36 % of the time on independent data.
   A stricter rule caused 26 official false positives, so the conservative version was kept.
2. **Mules showing a single indicator** are flagged about 42 % of the time. Mules showing none are 0 % by design:
   nothing in a bank statement separates them.
3. **Plain cash-out chains** (no wallet or crypto wording) are found about 25 % of the time. Cash-out recognition
   still depends on narration wording, now a list of crypto exchanges, tickers and wallet terms rather than two
   words.
4. **The holdout was used once to find a problem** (section 3); there is no untouched holdout left. `cycle_max_len=5`
   was also prompted by a test; it has no cost and no false-positive effect.
5. **Ambiguous legitimate patterns** (small payroll, wallet providers) are flagged. That is consistent with the
   statement's definition, but an investigator must review them.
6. **The live AI model** is accepted 8 / 10 times and takes about 15 s per narrative. The template fallback is
   always available, and the AI never changes a fact.
7. **Not yet measured:**
   - performance with the OS file cache flushed (first read from a cold disk);
   - Linux or macOS;
   - machines with less than 16 GB of RAM.
8. **Data assumptions:**
   - bank names come from the 4-letter account prefix, not an IFSC registry;
   - timestamps are naive (treated as UTC; only differences matter);
   - ingest replaces the database file (single writer).
9. **Detection weights are hand-set,** not fitted. The 27-point official score gap is wide, but the official file is
   synthetic and much cleaner than the independent data.

## 10. Bugs found in this phase: 20 found, 19 fixed, 1 partly fixed
Bugs 1–15 are listed in `plan/A_TASKLIST.md`: input robustness, keyword dependence, smurfing false positives, wallet
top-up, funnels (partly), drain false positives, 5-account rings, raw payment mode reaching the model, validator gaps,
20× detection slowdown, and a BOM-corrupted config. Found in the last part of this phase:

16. **Contract drift:** the UI type for ring results lacked `t_from` / `t_to` (contract test).
17. **Time slider:** it could never show a trail's last transfer (browser workflow 4).
18. **Model fallback stall:** with the AI model stopped, documents stalled about 2.3 s before falling back,
    because Windows retries a refused connection. A 1 s connect limit fixed it (now 1.26 s), with a regression test.
19. **NUL-byte crash:** an account ID containing a NUL byte crashed `/api/risk/{id}` with a 500 (SQL literal cut
    short). It is now quoted safely and gives a 404 (security test).
20. **Pasted links ignored:** a `#trace=` / `#ring=` link pasted into an already-open tab, or back / forward,
    did not change the screen. Found while showing the UI on the 2M data; it now follows the address
    (browser test added).

There were also 5 mistakes in our own new tests: a property test calling an account that doesn't exist, a contract
regex, a conservation check ignoring money returned to the victim, and two security-test mistakes. Each was fixed
in the test, never by weakening the engine or the validator.

## 11. Recommendation
Submit. In the demo:
- start with `python -m abhedya serve --data data/VoidHacks8_MuleAccount_2M_Transactions.csv`;
- quote only `bench/results.md`, `eval/report.md` and this report;
- present AI drafting as optional and validated, never as the source of facts;
- state limitations 1–3 if asked about recall on other data.
