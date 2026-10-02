Worlds: 3 (large; vocab holdout; seeds 301–303), 358,124 rows in total.

| Tier | Flagged HIGH | Meaning |
|---|---|---|
| MUST_FLAG | 11057/12037 (91.9%) | mules showing ≥ 2 statement indicators: higher is better |
| SHOULD_FLAG | 2034/4822 (42.2%) | mules showing 1 indicator |
| EXPECTED_MISS | 0/2708 (0.0%) | mules showing none (cannot be found from the statement's signals) |
| MUST_NOT_FLAG | 2/10234 (0.0%) | legitimate accounts: **false positives**, lower is better |
| AMBIGUOUS | 166/212 (78.3%) | legitimate accounts showing ≥ 2 statement indicators |

| Family | Flagged HIGH |
|---|---|
| legit:api_business | 0/120 (0.0%) |
| legit:background | 1/7200 (0.0%) |
| legit:client | 0/360 (0.0%) |
| legit:couple_back_and_forth | 0/240 (0.0%) |
| legit:crypto_investor | 0/120 (0.0%) |
| legit:employer | 0/120 (0.0%) |
| legit:exchange | 0/403 (0.0%) |
| legit:family_pool | 1/120 (0.8%) |
| legit:hospital | 0/120 (0.0%) |
| legit:merchant | 0/180 (0.0%) |
| legit:payment_aggregator | 0/120 (0.0%) |
| legit:payroll_large | 0/120 (0.0%) |
| legit:payroll_small | 120/120 (100.0%) |
| legit:refunding_merchant | 0/120 (0.0%) |
| legit:traveller_foreign_ip | 0/120 (0.0%) |
| legit:treasury_sweep | 0/240 (0.0%) |
| legit:vendor | 0/577 (0.0%) |
| legit:wallet_provider | 46/46 (100.0%) |
| mule:chain_basic | 1968/2656 (74.1%) |
| mule:chain_deep | 2496/3333 (74.9%) |
| mule:chain_plain_cashout | 695/2798 (24.8%) |
| mule:chain_slow | 1756/2686 (65.4%) |
| mule:chain_unwitting | 1821/2716 (67.0%) |
| mule:funnel | 107/294 (36.4%) |
| mule:scatter_gather | 741/794 (93.3%) |
| mule:shared_l1 | 3031/3814 (79.5%) |
| mule:smurf_cycle | 476/476 (100.0%) |

False positives by family: {'background': 1, 'family_pool': 1}

Victim traces (from the disputed transfer): seed 301: L1 563/563, recall 0.975, precision 0.981; seed 302: L1 564/564, recall 0.971, precision 0.983; seed 303: L1 566/566, recall 0.987, precision 0.984
Mean trace recall 0.978, mean precision 0.983, L1 found 1693/1693, slowest trace 63 ms.
Pipeline time per world: median 15.0 s, max 15.2 s.

Invariant problems: 0
