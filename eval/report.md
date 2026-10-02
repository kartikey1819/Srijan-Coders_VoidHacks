# Evaluation report

Generated 2026-10-02 06:30 by `python -m eval.evaluate`. Data: `VoidHacks8_MuleAccount_2M_Transactions.csv` (sha256 `2c9f81fd34f728c0…`). Ground truth: `ground_truth.json` (1,073 mules, 300 victims), built from the generator's own markers.

## 1. Detection (jury criterion: precision and recall, 30%)
Flagged (band HIGH, score >= 70): **1,073** accounts.

| Precision | Recall | F1 | TP | FP | FN |
|---|---|---|---|---|---|
| **1.0000** | **1.0000** | 1.0000 | 1073 | 0 | 0 |

Recall by layer and role-hint agreement:

| Layer | Mules | Recall | Role hint correct |
|---|---|---|---|
| L1 | 129 | 1.0000 | 1.0000 |
| L2 | 559 | 1.0000 | 1.0000 |
| L3 | 385 | 1.0000 | 1.0000 |

- Lowest-scoring mule: AIRP10000469 at 73. Highest-scoring other (non-mule, non-victim) account: SBIN10003602 at 46. **Score gap: 27 points.**
- Victims by band: {'MEDIUM': 300} (victims are not mules; they score MEDIUM because their money went to suspects).
- Statement says 1,500 mules; this file contains 1,073. If the jury scores against 1,500, maximum achievable recall is 0.715. We do not pad the list.

Stable 50/50 split (crc32 of account id): weights were set by hand and not fitted, so both halves are
out-of-sample. They are reported to show the result does not depend on a lucky subset.

| Half | Precision | Recall | TP | FP | FN |
|---|---|---|---|---|---|
| 0 | 1.0000 | 1.0000 | 543 | 0 | 0 |
| 1 | 1.0000 | 1.0000 | 530 | 0 | 0 |

### Threshold sweep
| Threshold | Flagged | Precision | Recall | F1 |
|---|---|---|---|---|
| 30 | 1580 | 0.6791 | 1.0000 | 0.8089 |
| 35 | 1382 | 0.7764 | 1.0000 | 0.8741 |
| 40 | 1381 | 0.7770 | 1.0000 | 0.8745 |
| 45 | 1081 | 0.9926 | 1.0000 | 0.9963 |
| 50 | 1073 | 1.0000 | 1.0000 | 1.0000 |
| 55 | 1073 | 1.0000 | 1.0000 | 1.0000 |
| 60 | 1073 | 1.0000 | 1.0000 | 1.0000 |
| 65 | 1073 | 1.0000 | 1.0000 | 1.0000 |
| 70 | 1073 | 1.0000 | 1.0000 | 1.0000 |
| 75 | 259 | 1.0000 | 0.2414 | 0.3889 |
| 80 | 230 | 1.0000 | 0.2144 | 0.3530 |
| 85 | 203 | 1.0000 | 0.1892 | 0.3182 |
| 90 | 129 | 1.0000 | 0.1202 | 0.2146 |

### Score distribution (count per 10-point bucket, 0-9 … 100)
| Group | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mule | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 843 | 101 | 129 | 0 |
| other | 20415 | 2753 | 125 | 199 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| victim | 0 | 0 | 0 | 0 | 300 | 0 | 0 | 0 | 0 | 0 | 0 |

### False positives (top 30)
- none

### False negatives
- none

## 2. Blind-victim simulation (jury criterion: 40%)
Every victim traced with `Engine.trace`; layers and transactions compared with the ground truth.

- Exact match (same L1, L2, L3 accounts and the same transactions): **300 / 300**
- Mean Jaccard overlap with the true layer: L1 1.000, L2 1.000, L3 1.000
- Trace latency in-process: p50 3.8 ms, max 15.3 ms
