# Benchmark results

Generated 2026-10-02 02:58 by `bench/run.py`. Only these numbers may be quoted.

## Machine
- OS: Windows-11-10.0.26300-SP0
- CPU: Intel64 Family 6 Model 165 Stepping 2, GenuineIntel (4 cores / 8 threads)
- RAM: 15.8 GB
- Python 3.12.10, DuckDB 1.5.6, NumPy 2.5.3
- Input: `VoidHacks8_MuleAccount_2M_Transactions.csv` (274 MB, 2,000,000 rows)

## Ingest + index (requirement: <= 60 s for 2M rows on 16 GB)
Runs: 11.18 s, 11.71 s, 10.86 s. Best: **10.86 s**. Peak process memory: **1248 MB**.

| Stage | Seconds (best run) |
|---|---|
| hash | 0.67 |
| load_csv | 4.14 |
| verify_order | 0.01 |
| account_map | 0.30 |
| derive+validate | 4.25 |
| dq_summary | 0.01 |
| account_table | 0.14 |
| graph_arrays | 1.35 |

Mule detection (features + risk for all 24,873 accounts, run after indexing): **27.38 s**, peak process memory 1214 MB.

## Latency (requirement: 4-hop trace <= 2 s)
| Operation | n | p50 | p95 | p99 | max | unit |
|---|---|---|---|---|---|---|
| trace: 300 victims | 300 | 4.3 | 4.9 | 5.2 | 5.8 | ms |
| trace: 200 random accounts as 'victim' | 200 | 361.2 | 486.2 | 591.7 | 1116.9 | ms |
| trace: 50 busiest accounts as 'victim' | 50 | 509.2 | 727.0 | 842.6 | 842.6 | ms |
| account summary: 200 random | 200 | 48.8 | 63.4 | 116.5 | 178.2 | ms |
| account txns (200 rows): 200 random | 200 | 95.1 | 158.2 | 195.2 | 203.0 | ms |
| ring isolation from a victim: 10 runs | 10 | 75.1 | 206.7 | 206.7 | 206.7 | ms |
| HTTP GET /api/trace: 300 victims | 300 | 6.3 | 9.3 | 10.2 | 13.2 | ms |
| HTTP GET /api/account: 200 random | 200 | 43.6 | 63.8 | 75.2 | 137.5 | ms |
