# Benchmark results

Generated 2026-10-02 02:23 by `bench/run.py`. Only these numbers may be quoted.

## Machine
- OS: Windows-11-10.0.26300-SP0
- CPU: Intel64 Family 6 Model 165 Stepping 2, GenuineIntel (4 cores / 8 threads)
- RAM: 15.8 GB
- Python 3.12.10, DuckDB 1.5.6, NumPy 2.5.3
- Input: `VoidHacks8_MuleAccount_2M_Transactions.csv` (274 MB, 2,000,000 rows)

## Ingest + index (requirement: <= 60 s for 2M rows on 16 GB)
Runs: 10.65 s, 10.70 s, 9.44 s. Best: **9.44 s**. Peak process memory: **1245 MB**.

| Stage | Seconds (best run) |
|---|---|
| hash | 0.64 |
| load_csv | 3.02 |
| verify_order | 0.01 |
| account_map | 0.30 |
| derive+validate | 3.99 |
| dq_summary | 0.01 |
| account_table | 0.14 |
| graph_arrays | 1.34 |

## Latency (requirement: 4-hop trace <= 2 s)
| Operation | n | p50 | p95 | p99 | max | unit |
|---|---|---|---|---|---|---|
| trace: 300 victims | 300 | 1.5 | 1.9 | 2.2 | 4.7 | ms |
| trace: 200 random accounts as 'victim' | 200 | 271.8 | 346.2 | 390.9 | 423.7 | ms |
| trace: 50 busiest accounts as 'victim' | 50 | 371.2 | 427.6 | 438.1 | 438.1 | ms |
| account summary: 200 random | 200 | 37.3 | 42.5 | 47.1 | 59.1 | ms |
| account txns (200 rows): 200 random | 200 | 91.5 | 104.6 | 110.7 | 134.4 | ms |
| ring isolation from a victim: 10 runs | 10 | 53.6 | 72.9 | 72.9 | 72.9 | ms |
| HTTP GET /api/trace: 300 victims | 300 | 3.0 | 3.5 | 4.0 | 6.2 | ms |
| HTTP GET /api/account: 200 random | 200 | 39.6 | 45.7 | 46.8 | 49.3 | ms |
