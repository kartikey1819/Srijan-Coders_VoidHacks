# Final test matrix

Final regression on 2026-10-02, on the code in this commit:
- `python -m pytest` gave **181 passed, 0 failed, 0 skipped**, run twice in a row (154 s and 155 s), then 182 after bug 20's browser test (browser and contract files rerun: 26 / 26);
- benchmarks: `bench/run.py --runs 5` and `bench/llm_check.py --n 10`;
- official evaluation: `python -m eval.evaluate`;
- four independent suites: `python -m tests.adversarial_data.evaluate`.

Runtimes are measured; for pytest they come from the JUnit report of the second run.

Datasets:
- **official**: `VoidHacks8_MuleAccount_2M_Transactions.csv`, 2,000,000 rows;
- **sample**: `data/sample.csv`, 50,000 official rows;
- **mini**: hand-built CSVs inside each test;
- **random**: Hypothesis-generated;
- **independent**: `tests/adversarial_data` worlds, seeds recorded.

| Area | Test | Dataset | Expected | Actual | Status | Runtime |
|---|---|---|---|---|---|---|
| Integration | Real UI on real API, workflows 1–10 + data-quality screen + pasted link / back (`test_e2e_workflows.py`) | sample | each workflow shows the stated result, no browser errors | 11 / 11 (bug 20 found and fixed) | PASS | 8.7 s |
| Integration | API ↔ UI type contract (`test_contract.py`) | — | every TS interface matches its pydantic model | 15 / 15 | PASS | <0.1 s |
| Integration | API routes, 404s, byte-identical ring export, disputed-transfer trace (`test_api.py`) | sample | correct JSON, 404 for unknown | 6 / 6 | PASS | 2.1 s |
| Integration | One-command start `serve --data` | official | ingests if missing / stale, then serves | used for every manual run and the HTTP benchmark | PASS | 1.45 s to first answer (db present) |
| Official data | Detection precision / recall (`eval/report.md`) | official | high precision and recall | 1.0000 / 1.0000 (1,073 TP, 0 FP, 0 FN) | PASS | 1.8 s (evaluation) |
| Official data | Blind-victim traces | official | exact L1 / L2 / L3 and transactions | 300 / 300 exact | PASS | p50 3.8 ms each |
| Official data | Source file never modified | official | same SHA-256 before / after | `2c9f81fd…f73101` unchanged | PASS | — |
| Ingest | Counts, row order = file order, raw values kept, ids as strings, full-file facts (`test_ingest.py`) | sample, official | no row lost or reordered | 5 / 5 | PASS | <0.1 s (+ fixtures) |
| Robustness | Malformed values, header-only / empty, missing / extra / reordered columns, BOM, CRLF, quoted newlines, duplicates, hostile text, file untouched (`test_robustness.py`) | mini | every row kept and flagged; clear errors | 8 / 8 | PASS | 3.1 s |
| Adversarial | Window edges 179 / 180 / 181 / 899 / 900 / 901 s; 90 % amount edge; pass-through edges (`test_adversarial_shapes.py`) | mini | inclusive 180–900 s; ≥ 90.00 % matches | 12 / 12 | PASS | 8.9 s (file) |
| Adversarial | Same-second ties (both orders), 12 outflows in one second | mini | row order decides; money balances | 3 / 3 | PASS | (above) |
| Adversarial | Hub with 6,000 edges; dense 40-account clique; 30-hop chain | mini | practical runtime; money balances; 4-hop limit | 4.9 s / 0.5 s / 0.3 s; balanced | PASS | (above) |
| Adversarial | Detection traps: boundaries, partial dispersal, fan-out sizes, terminal direction, ordinary = LOW, back-and-forth, one-off wallet, drained collector, repeated ring, no generator knowledge (`test_detect.py`) | mini, sample | flagged / not flagged as stated | 18 / 18 | PASS | 3.6 s |
| Adversarial | Trace rules: split, residue, own-money-first, pro-rata, shared mule, hop limit, return to victim, ambiguity warning (`test_trace.py`) | mini, official | exact attribution | 12 / 12 | PASS | 3.1 s |
| Property | Score bounds, conservation / time / real edges, determinism, unrelated component, DQ never changes risk, file order (`test_properties.py`) | random (~120 datasets) | holds for every generated dataset | 6 / 6 | PASS | 43.1 s |
| Independent | small, dev wording, seeds 1–20 | independent, 60,085 rows | high MUST_FLAG, ~0 FP | MUST 91.5 %, SHOULD 42.4 %, FP 0 / 1,739, L1 280 / 280, trace 0.979 / 0.980 | PASS | 11.4 s |
| Independent | small, holdout wording, seeds 401–420 | independent, 59,125 rows | same | MUST 91.7 %, SHOULD 42.2 %, FP 0 / 1,741, L1 272 / 272, trace 0.985 / 0.975 | PASS | 11.1 s |
| Independent | medium, dev wording, seeds 201–210 | independent, 178,804 rows | same | MUST 91.8 %, SHOULD 42.5 %, FP 2 / 5,125, L1 845 / 845, trace 0.980 / 0.982 | PASS | 15.7 s |
| Independent | large, holdout wording, seeds 301–303 | independent, 358,124 rows | same | MUST 91.9 %, SHOULD 42.2 %, FP 2 / 10,234, L1 1,693 / 1,693, trace 0.978 / 0.983 | PASS | 32.0 s |
| Independent | Invariants (conservation, time order) across all 53 worlds | independent | 0 violations | 0 | PASS | (above) |
| Independent | Funnel accounts | independent | found | ~36 % | KNOWN LIMIT | (above) |
| Reproducibility | Independent suites rerun on final code vs committed results | independent | identical except timings | identical, all 4 suites | PASS | — |
| Reproducibility | Detection bands across 5 fresh processes | official | identical | HIGH 1,073 / MEDIUM 308 / LOW 23,492 every run | PASS | — |
| Performance | Test 1: ingest + index, 5 runs | official | ≤ 60 s | 12.12 / 12.65 / 12.71 s, 1,380 MB peak | PASS | — |
| Performance | Test 2: detection, 5 runs | official | practical | 12.67 / 12.79 / 12.85 s, 864 MB peak | PASS | — |
| Performance | Test 3: complete pipeline, 5 runs | official | ≤ 60 s | 25.21 / 26.71 / 26.98 s, 1,376 MB peak | PASS | — |
| Performance | Test 4: 4-hop trace, 300 victims, warm / cold / HTTP | official | ≤ 2 s | p50 3.7 ms, max 11.3 ms; cold first trace 11 ms; HTTP p50 5.3 ms | PASS | — |
| Performance | Full investigation (trace + all trail accounts + ring + documents), 20 victims | official | interactive | p50 498 ms, max 566 ms | PASS | — |
| Performance | Busiest accounts as "victim" (worst case) | official | ≤ 2 s | p50 467 ms, max 588 ms | PASS | — |
| LLM grounding | 20 hostile replies, structure, honest replies kept, untrusted fields never in prompt, conflicting evidence refused, model failures, model down, AI on / off isolation (table hashes), fast fallback (`test_llm_grounding.py`) | sample, official | every hostile reply rejected; facts identical | 36 / 36 (incl. 2 live-model tests) | PASS | 80.1 s |
| LLM grounding | Validator rules: numbers, ids, roles, banks, dates, IPs, guilt words, non-English, schema bounds (`test_validator.py`) | official evidence | rejected / accepted as stated | 17 / 17 | PASS | 0.2 s |
| LLM live | 10 victims, qwen2.5:3b on GPU (`bench/llm_results.md`) | official | grounded or fallback | 8 accepted, 2 genuine mistakes rejected → template | PASS | median 15.3 s, first 26.3 s |
| Fallback | Model stopped → documents still produced | sample, official | template documents, fast | 1.26 s (was 2.3 s, bug 18) | PASS | — |
| Documents | Indian ₹ grouping, evidence ids, fingerprint, diary + one notice per bank, firewall blocks unknown account, AI on / off same facts, API (`test_docs.py`) | sample | as stated | 6 / 6 | PASS | 0.4 s |
| Security | Path traversal ×6, injection-shaped ids ×8 on 5 routes + search, resource limits ×8, seed misuse, HTML escaping (`test_security.py`) | sample | clean 4xx, no file leak, DB unchanged, escaped | 24 / 24 (NUL-byte 500 found and fixed, bug 19) | PASS | 0.6 s |
