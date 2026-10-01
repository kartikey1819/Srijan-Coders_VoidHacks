# Evaluation report

Generated 2026-10-02 02:55 by `python -m eval.evaluate`. Data: `SYNTHETIC_TEST_7.csv` (sha256 `527654bb69aa2766…`). Ground truth: `SYNTHETIC_TEST_7.truth.json` (291 mules, 80 victims), built from the generator's own markers.

## 1. Detection (jury criterion: precision and recall, 30%)
Flagged (band HIGH, score >= 70): **275** accounts.

| Precision | Recall | F1 | TP | FP | FN |
|---|---|---|---|---|---|
| **1.0000** | **0.9450** | 0.9717 | 275 | 0 | 16 |

Recall by layer and role-hint agreement:

| Layer | Mules | Recall | Role hint correct |
|---|---|---|---|
| L1 | 25 | 0.9200 | 0.8000 |
| L2 | 149 | 0.9396 | 0.9597 |
| L3 | 103 | 0.9515 | 0.9903 |
| CYCLE | 14 | 1.0000 | n/a |

- Lowest-scoring mule: IPOS07068432 at 13. Highest-scoring other (non-mule, non-victim) account: IPOS79926602 at 68. **Score gap: -55 points.**
- Victims by band: {'LOW': 79, 'MEDIUM': 1} (victims are not mules; they score MEDIUM because their money went to suspects).
- Statement says 1,500 mules; this file contains 291. If the jury scores against 1,500, maximum achievable recall is 0.194. We do not pad the list.

Stable 50/50 split (crc32 of account id): weights were set by hand and not fitted, so both halves are
out-of-sample. They are reported to show the result does not depend on a lucky subset.

| Half | Precision | Recall | TP | FP | FN |
|---|---|---|---|---|---|
| 0 | 1.0000 | 0.9281 | 129 | 0 | 10 |
| 1 | 1.0000 | 0.9605 | 146 | 0 | 6 |

### Threshold sweep
| Threshold | Flagged | Precision | Recall | F1 |
|---|---|---|---|---|
| 30 | 567 | 0.5026 | 0.9794 | 0.6643 |
| 35 | 535 | 0.5290 | 0.9725 | 0.6852 |
| 40 | 462 | 0.6082 | 0.9656 | 0.7463 |
| 45 | 457 | 0.6061 | 0.9519 | 0.7406 |
| 50 | 333 | 0.8318 | 0.9519 | 0.8878 |
| 55 | 311 | 0.8907 | 0.9519 | 0.9203 |
| 60 | 302 | 0.9172 | 0.9519 | 0.9342 |
| 65 | 282 | 0.9787 | 0.9485 | 0.9634 |
| 70 | 275 | 1.0000 | 0.9450 | 0.9717 |
| 75 | 41 | 1.0000 | 0.1409 | 0.2470 |
| 80 | 18 | 1.0000 | 0.0619 | 0.1165 |
| 85 | 10 | 1.0000 | 0.0344 | 0.0664 |
| 90 | 0 | 0.0000 | 0.0000 | 0.0000 |

### Score distribution (count per 10-point bucket, 0-9 … 100)
| Group | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mule | 0 | 3 | 3 | 4 | 4 | 0 | 2 | 257 | 18 | 0 | 0 |
| other | 5613 | 142 | 65 | 25 | 124 | 31 | 25 | 0 | 0 | 0 | 0 |
| victim | 1 | 0 | 2 | 76 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |

### False positives (top 30)
- none

### False negatives
- HDFC08549940: 68 (PT_STRICT:0.79;LINKED_TO_FLAGGED:0.74;SCRIPT_DEVICE_OUT:5;FOREIGN_PROXY_IP_OUT:5)
- AXIS91680917: 60 (LINKED_TO_FLAGGED:0.93;FANOUT_EPISODES:1;SCRIPT_DEVICE_OUT:2;FOREIGN_PROXY_IP_OUT:2)
- BARB35789597: 42 (TERM_OUT:2;LINKED_TO_FLAGGED:0.34)
- AXIS66791721: 42 (TERM_OUT:1;LINKED_TO_FLAGGED:0.21)
- ICIC68728735: 41 (TERM_OUT:1;LINKED_TO_FLAGGED:0.29)
- KKBK79361551: 40 (TERM_IN:2;LINKED_TO_FLAGGED:0.31;SINK:0.95)
- AXIS28232389: 39 (TERM_IN:1;LINKED_TO_FLAGGED:0.33;SINK:0.91)
- IPOS25308500: 37 (TERM_IN:1;LINKED_TO_FLAGGED:0.42)
- SBIN74629113: 33 (LINKED_TO_FLAGGED:0.57;SCRIPT_DEVICE_OUT:2;FOREIGN_PROXY_IP_OUT:2)
- BARB96273786: 32 (TERM_IN:1)
- PUNB67635872: 26 (SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1;LINKED_TO_FLAGGED:0.24)
- PUNB08505340: 24 (LINKED_TO_FLAGGED:0.50;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- BARB70901135: 20 (LINKED_TO_FLAGGED:0.35;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- BARB22481296: 17 (LINKED_TO_FLAGGED:0.42)
- IPOS53819754: 15 (LINKED_TO_FLAGGED:0.26;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- IPOS07068432: 13 (SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)

## 2. Blind-victim simulation (jury criterion: 40%)
Every victim traced with `Engine.trace`; layers and transactions compared with the ground truth.

- Exact match (same L1, L2, L3 accounts and the same transactions): **9 / 80**
- Mean Jaccard overlap with the true layer: L1 1.000, L2 0.551, L3 0.602
- Trace latency in-process: p50 8.0 ms, max 50.1 ms
- Failing victims: HDFC07655844, IPOS17525828, KKBK42397110, IPOS09334444, KKBK34943072, SBIN71608979, HDFC71875879, AIRP12277746, BARB02779179, AIRP68190766, PUNB66784692, KKBK62009371, AIRP10224498, AXIS59562136, ICIC10654725, KKBK42243836, SBIN20306517, PYTM67281789, HDFC04237300, ICIC27105252
