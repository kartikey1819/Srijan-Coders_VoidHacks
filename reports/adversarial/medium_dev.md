Worlds: 10 (medium; vocab dev; seeds 201–210), 178,804 rows in total.

| Tier | Flagged HIGH | Meaning |
|---|---|---|
| MUST_FLAG | 5487/5977 (91.8%) | mules showing ≥ 2 statement indicators: higher is better |
| SHOULD_FLAG | 974/2294 (42.5%) | mules showing 1 indicator |
| EXPECTED_MISS | 0/1380 (0.0%) | mules showing none (cannot be found from the statement's signals) |
| MUST_NOT_FLAG | 2/5125 (0.0%) | legitimate accounts: **false positives**, lower is better |
| AMBIGUOUS | 89/118 (75.4%) | legitimate accounts showing ≥ 2 statement indicators |

| Family | Flagged HIGH |
|---|---|
| legit:api_business | 0/60 (0.0%) |
| legit:background | 0/3600 (0.0%) |
| legit:client | 0/180 (0.0%) |
| legit:couple_back_and_forth | 0/120 (0.0%) |
| legit:crypto_investor | 0/60 (0.0%) |
| legit:employer | 0/60 (0.0%) |
| legit:exchange | 0/214 (0.0%) |
| legit:family_pool | 2/60 (3.3%) |
| legit:hospital | 0/60 (0.0%) |
| legit:merchant | 0/90 (0.0%) |
| legit:payment_aggregator | 0/60 (0.0%) |
| legit:payroll_large | 0/60 (0.0%) |
| legit:payroll_small | 60/60 (100.0%) |
| legit:refunding_merchant | 0/60 (0.0%) |
| legit:traveller_foreign_ip | 0/60 (0.0%) |
| legit:treasury_sweep | 0/120 (0.0%) |
| legit:vendor | 0/290 (0.0%) |
| legit:wallet_provider | 29/29 (100.0%) |
| mule:chain_basic | 1003/1336 (75.1%) |
| mule:chain_deep | 1097/1494 (73.4%) |
| mule:chain_plain_cashout | 368/1422 (25.9%) |
| mule:chain_slow | 913/1396 (65.4%) |
| mule:chain_unwitting | 898/1318 (68.1%) |
| mule:funnel | 56/146 (38.4%) |
| mule:scatter_gather | 358/391 (91.6%) |
| mule:shared_l1 | 1528/1908 (80.1%) |
| mule:smurf_cycle | 240/240 (100.0%) |

False positives by family: {'family_pool': 2}

Victim traces (from the disputed transfer): seed 201: L1 84/84, recall 0.977, precision 0.982; seed 202: L1 87/87, recall 0.964, precision 0.971; seed 203: L1 84/84, recall 0.974, precision 0.983; seed 204: L1 85/85, recall 0.974, precision 0.986; seed 205: L1 79/79, recall 0.993, precision 0.97 …
Mean trace recall 0.980, mean precision 0.982, L1 found 845/845, slowest trace 53 ms.
Pipeline time per world: median 20.1 s, max 21.5 s.

Invariant problems: 0
