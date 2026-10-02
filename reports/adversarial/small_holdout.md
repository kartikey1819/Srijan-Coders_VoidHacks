Worlds: 20 (small; vocab holdout; seeds 401–420), 59,125 rows in total.

| Tier | Flagged HIGH | Meaning |
|---|---|---|
| MUST_FLAG | 1656/1806 (91.7%) | mules showing ≥ 2 statement indicators: higher is better |
| SHOULD_FLAG | 312/739 (42.2%) | mules showing 1 indicator |
| EXPECTED_MISS | 0/412 (0.0%) | mules showing none (cannot be found from the statement's signals) |
| MUST_NOT_FLAG | 0/1741 (0.0%) | legitimate accounts: **false positives**, lower is better |
| AMBIGUOUS | 28/36 (77.8%) | legitimate accounts showing ≥ 2 statement indicators |

| Family | Flagged HIGH |
|---|---|
| legit:api_business | 0/20 (0.0%) |
| legit:background | 0/1200 (0.0%) |
| legit:client | 0/60 (0.0%) |
| legit:couple_back_and_forth | 0/40 (0.0%) |
| legit:crypto_investor | 0/20 (0.0%) |
| legit:employer | 0/20 (0.0%) |
| legit:exchange | 0/72 (0.0%) |
| legit:family_pool | 0/20 (0.0%) |
| legit:hospital | 0/20 (0.0%) |
| legit:merchant | 0/60 (0.0%) |
| legit:payment_aggregator | 0/20 (0.0%) |
| legit:payroll_large | 0/20 (0.0%) |
| legit:payroll_small | 20/20 (100.0%) |
| legit:refunding_merchant | 0/20 (0.0%) |
| legit:traveller_foreign_ip | 0/20 (0.0%) |
| legit:treasury_sweep | 0/40 (0.0%) |
| legit:vendor | 0/97 (0.0%) |
| legit:wallet_provider | 8/8 (100.0%) |
| mule:chain_basic | 325/424 (76.7%) |
| mule:chain_deep | 376/536 (70.1%) |
| mule:chain_plain_cashout | 114/384 (29.7%) |
| mule:chain_slow | 254/436 (58.3%) |
| mule:chain_unwitting | 267/410 (65.1%) |
| mule:funnel | 19/52 (36.5%) |
| mule:scatter_gather | 119/124 (96.0%) |
| mule:shared_l1 | 417/514 (81.1%) |
| mule:smurf_cycle | 77/77 (100.0%) |

False positives by family: none

Victim traces (from the disputed transfer): seed 401: L1 13/13, recall 1.0, precision 0.972; seed 402: L1 14/14, recall 1.0, precision 1.0; seed 403: L1 13/13, recall 1.0, precision 0.955; seed 404: L1 14/14, recall 0.982, precision 0.963; seed 405: L1 13/13, recall 0.988, precision 1.0 …
Mean trace recall 0.985, mean precision 0.975, L1 found 272/272, slowest trace 11 ms.
Pipeline time per world: median 3.2 s, max 3.7 s.

Invariant problems: 0
