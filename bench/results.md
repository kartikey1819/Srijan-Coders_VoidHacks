# Benchmark results

Generated 2026-10-02 06:25 by `bench/run.py --runs 5`. Only these numbers may be quoted. Every run is a fresh Python process; min / median / max are over those runs. The OS file cache is not flushed between runs (a first-ever read from disk can be slower).

## Machine
- OS: Windows-11-10.0.26300-SP0
- CPU: Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz (4 cores / 8 threads); DuckDB threads: 8; the Python feature loops are single-threaded
- RAM: 15.8 GB
- Python 3.12.10, DuckDB 1.5.6, NumPy 2.5.3
- Input: `VoidHacks8_MuleAccount_2M_Transactions.csv` (274 MB, 2,000,000 rows, 24,873 accounts)

## Summary (requirement: 2M transactions ingested and indexed in <= 60 s on 16 GB RAM)
| Test | min / median / max (s) | process wall incl. Python start, median (s) | peak memory, max (MB) |
|---|---|---|---|
| 1. Ingest + index | 12.12 / 12.65 / 12.71 | 13.29 | 1380 |
| 2. Detection (all accounts) | 12.67 / 12.79 / 12.85 | 13.33 | 864 |
| 3. Complete pipeline (1 + 2) | 25.21 / 26.71 / 26.98 | 27.09 | 1376 |
| 4. Engine load (cold start of the query side) | 0.06 / 0.06 / 0.13 | - | 376 |

Detection result (every run identical): {'HIGH': 1073, 'MEDIUM': 308, 'LOW': 23492} of 24,873 accounts.

## Test 1: ingest + index, per stage (s)
| Stage | min | median | max |
|---|---|---|---|
| hash | 0.62 | 0.62 | 0.67 |
| load_csv | 4.89 | 5.04 | 5.45 |
| verify_order | 0.01 | 0.01 | 0.01 |
| account_map | 0.30 | 0.30 | 0.37 |
| derive+validate | 4.79 | 4.86 | 5.16 |
| dq_summary | 0.01 | 0.01 | 0.02 |
| account_table | 0.15 | 0.15 | 0.16 |
| graph_arrays | 1.30 | 1.34 | 1.41 |

## Test 2: detection, per stage (s)
| Stage | min | median | max |
|---|---|---|---|
| features | 12.46 | 12.58 | 12.63 |
| load_edges (part of features) | 0.14 | 0.15 | 0.15 |
| counts_channels (part of features) | 2.41 | 2.43 | 2.44 |
| pass_through_fanout_fanin (part of features) | 3.72 | 3.76 | 3.81 |
| cycles (part of features) | 6.03 | 6.09 | 6.13 |
| risk_score_2_passes | 0.05 | 0.05 | 0.06 |
| write_tables | 0.15 | 0.15 | 0.16 |

## Test 3: complete pipeline split (s)
| Part | min / median / max |
|---|---|
| ingest + index | 11.36 / 12.40 / 12.84 |
| detection | 13.00 / 13.53 / 13.74 |

## Test 4: investigation (requirement: 4-hop trace <= 2 s)
Cold start, fresh process: engine load 0.06 / 0.06 / 0.13 s; first trace 10.97 / 11.08 / 11.22 ms. HTTP server start to first answer: 1.45 s; first HTTP trace 8.3 ms. Warm latencies below are from the last of the 3 query processes.

| Operation | n | min | p50 | p95 | max (ms) |
|---|---|---|---|---|---|
| trace (4 hops): 300 victims | 300 | 3.3 | 3.7 | 4.3 | 11.3 |
| trace: 200 random accounts as 'victim' | 200 | 1.0 | 338.7 | 419.6 | 504.6 |
| trace: 50 busiest accounts as 'victim' | 50 | 373.2 | 466.5 | 553.6 | 588.4 |
| account summary: 200 random | 200 | 27.6 | 36.8 | 41.5 | 47.7 |
| account txns (200 rows): 200 random | 200 | 92.2 | 96.6 | 105.0 | 114.6 |
| ring isolation from a victim's L1: 20 victims | 20 | 66.5 | 73.9 | 84.8 | 88.3 |
| evidence + diary + bank notices (templates): 20 victims | 20 | 39.4 | 41.8 | 47.1 | 47.5 |
| validator on a full narrative: 20 victims | 20 | 1.1 | 1.2 | 1.3 | 1.4 |
| AI unavailable -> template fallback: 5 victims | 5 | 1248.0 | 1263.1 | 1321.4 | 1321.4 |
| full investigation (trace + every trail account + ring + documents): 20 victims | 20 | 350.4 | 498.4 | 550.2 | 566.0 |

### Over HTTP (uvicorn, 1 worker, AI model unreachable)
| Operation | n | min | p50 | p95 | max (ms) |
|---|---|---|---|---|---|
| GET /api/trace: 300 victims | 300 | 4.8 | 5.3 | 5.8 | 8.2 |
| GET /api/account: 200 random | 200 | 29.9 | 39.0 | 41.8 | 47.2 |
| GET /api/risk/top (HIGH, 500 rows): 20 | 20 | 9.5 | 9.8 | 14.2 | 24.8 |
| POST /api/docs (AI off): 10 victims | 10 | 38.4 | 41.3 | 59.9 | 59.9 |
| POST /api/docs (AI on, model unreachable): 5 victims | 5 | 1295.1 | 1300.9 | 1401.7 | 1401.7 |

Live AI model latency is measured separately by `bench/llm_check.py` (see `bench/llm_results.md`).
