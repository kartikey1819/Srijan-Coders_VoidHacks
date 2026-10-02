Worlds: 20 (small; vocab dev; seeds 1–20), 60,085 rows in total.

| Tier | Flagged HIGH | Meaning |
|---|---|---|
| MUST_FLAG | 1800/1968 (91.5%) | mules showing ≥ 2 statement indicators: higher is better |
| SHOULD_FLAG | 340/801 (42.4%) | mules showing 1 indicator |
| EXPECTED_MISS | 0/437 (0.0%) | mules showing none (cannot be found from the statement's signals) |
| MUST_NOT_FLAG | 0/1739 (0.0%) | legitimate accounts: **false positives**, lower is better |
| AMBIGUOUS | 25/30 (83.3%) | legitimate accounts showing ≥ 2 statement indicators |

| Family | Flagged HIGH |
|---|---|
| legit:api_business | 0/20 (0.0%) |
| legit:background | 0/1200 (0.0%) |
| legit:client | 0/60 (0.0%) |
| legit:couple_back_and_forth | 0/40 (0.0%) |
| legit:crypto_investor | 0/20 (0.0%) |
| legit:employer | 0/20 (0.0%) |
| legit:exchange | 0/69 (0.0%) |
| legit:family_pool | 0/20 (0.0%) |
| legit:hospital | 0/20 (0.0%) |
| legit:merchant | 0/60 (0.0%) |
| legit:payment_aggregator | 0/20 (0.0%) |
| legit:payroll_large | 0/20 (0.0%) |
| legit:payroll_small | 20/20 (100.0%) |
| legit:refunding_merchant | 0/20 (0.0%) |
| legit:traveller_foreign_ip | 0/20 (0.0%) |
| legit:treasury_sweep | 0/40 (0.0%) |
| legit:vendor | 0/95 (0.0%) |
| legit:wallet_provider | 5/5 (100.0%) |
| mule:chain_basic | 342/474 (72.2%) |
| mule:chain_deep | 402/553 (72.7%) |
| mule:chain_plain_cashout | 105/440 (23.9%) |
| mule:chain_slow | 291/418 (69.6%) |
| mule:chain_unwitting | 313/466 (67.2%) |
| mule:funnel | 16/46 (34.8%) |
| mule:scatter_gather | 123/133 (92.5%) |
| mule:shared_l1 | 474/602 (78.7%) |
| mule:smurf_cycle | 74/74 (100.0%) |

False positives by family: none

Victim traces (from the disputed transfer): seed 1: L1 15/15, recall 0.982, precision 0.952; seed 2: L1 14/14, recall 0.992, precision 0.97; seed 3: L1 13/13, recall 0.991, precision 0.96; seed 4: L1 15/15, recall 0.966, precision 1.0; seed 5: L1 13/13, recall 0.986, precision 0.979 …
Mean trace recall 0.979, mean precision 0.980, L1 found 280/280, slowest trace 17 ms.
Pipeline time per world: median 3.3 s, max 3.8 s.

Invariant problems: 0
