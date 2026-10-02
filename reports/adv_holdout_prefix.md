Worlds: 3 (small; vocab holdout; seeds 101–103), 8,787 rows in total.

| Tier | Flagged HIGH | Meaning |
|---|---|---|
| MUST_FLAG | 171/301 (56.8%) | mules showing ≥ 2 statement indicators: higher is better |
| SHOULD_FLAG | 27/98 (27.6%) | mules showing 1 indicator |
| EXPECTED_MISS | 0/69 (0.0%) | mules showing none (cannot be found from the statement's signals) |
| MUST_NOT_FLAG | 14/265 (5.3%) | legitimate accounts: **false positives**, lower is better |
| AMBIGUOUS | 5/5 (100.0%) | legitimate accounts showing ≥ 2 statement indicators |

| Family | Flagged HIGH |
|---|---|
| legit:api_business | 0/3 (0.0%) |
| legit:background | 0/180 (0.0%) |
| legit:client | 0/9 (0.0%) |
| legit:couple_back_and_forth | 6/6 (100.0%) |
| legit:crypto_investor | 0/3 (0.0%) |
| legit:employer | 0/3 (0.0%) |
| legit:exchange | 0/14 (0.0%) |
| legit:family_pool | 0/3 (0.0%) |
| legit:hospital | 0/3 (0.0%) |
| legit:merchant | 0/9 (0.0%) |
| legit:payment_aggregator | 0/3 (0.0%) |
| legit:payroll_large | 0/3 (0.0%) |
| legit:payroll_small | 3/3 (100.0%) |
| legit:refunding_merchant | 0/3 (0.0%) |
| legit:traveller_foreign_ip | 2/3 (66.7%) |
| legit:treasury_sweep | 6/6 (100.0%) |
| legit:vendor | 0/14 (0.0%) |
| legit:wallet_provider | 2/2 (100.0%) |
| mule:chain_basic | 28/62 (45.2%) |
| mule:chain_deep | 31/83 (37.3%) |
| mule:chain_plain_cashout | 20/60 (33.3%) |
| mule:chain_slow | 14/66 (21.2%) |
| mule:chain_unwitting | 35/72 (48.6%) |
| mule:funnel | 3/7 (42.9%) |
| mule:scatter_gather | 15/16 (93.8%) |
| mule:shared_l1 | 49/89 (55.1%) |
| mule:smurf_cycle | 3/13 (23.1%) |

False positives by family: {'couple_back_and_forth': 6, 'wallet_provider': 2, 'treasury_sweep': 6}

Victim traces (from the disputed transfer): seed 101: L1 15/15, recall 1.0, precision 0.975; seed 102: L1 13/13, recall 1.0, precision 0.95; seed 103: L1 13/13, recall 0.986, precision 0.986
Mean trace recall 0.995, mean precision 0.970, L1 found 41/41, slowest trace 9 ms.
Pipeline time per world: median 3.3 s, max 3.6 s.

Invariant problems: 0
