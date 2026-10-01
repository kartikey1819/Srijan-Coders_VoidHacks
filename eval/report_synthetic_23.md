# Evaluation report

Generated 2026-10-02 02:55 by `python -m eval.evaluate`. Data: `SYNTHETIC_TEST_23.csv` (sha256 `2209876567ce73c8…`). Ground truth: `SYNTHETIC_TEST_23.truth.json` (441 mules, 120 victims), built from the generator's own markers.

## 1. Detection (jury criterion: precision and recall, 30%)
Flagged (band HIGH, score >= 70): **408** accounts.

| Precision | Recall | F1 | TP | FP | FN |
|---|---|---|---|---|---|
| **1.0000** | **0.9252** | 0.9611 | 408 | 0 | 33 |

Recall by layer and role-hint agreement:

| Layer | Mules | Recall | Role hint correct |
|---|---|---|---|
| L1 | 38 | 0.8947 | 0.8684 |
| L2 | 229 | 0.8996 | 0.9301 |
| L3 | 153 | 0.9608 | 0.9935 |
| CYCLE | 21 | 1.0000 | n/a |

- Lowest-scoring mule: ICIC71906159 at 0. Highest-scoring other (non-mule, non-victim) account: AIRP74963253 at 69. **Score gap: -69 points.**
- Victims by band: {'LOW': 116, 'MEDIUM': 4} (victims are not mules; they score MEDIUM because their money went to suspects).
- Statement says 1,500 mules; this file contains 441. If the jury scores against 1,500, maximum achievable recall is 0.294. We do not pad the list.

Stable 50/50 split (crc32 of account id): weights were set by hand and not fitted, so both halves are
out-of-sample. They are reported to show the result does not depend on a lucky subset.

| Half | Precision | Recall | TP | FP | FN |
|---|---|---|---|---|---|
| 0 | 1.0000 | 0.9163 | 186 | 0 | 17 |
| 1 | 1.0000 | 0.9328 | 222 | 0 | 16 |

### Threshold sweep
| Threshold | Flagged | Precision | Recall | F1 |
|---|---|---|---|---|
| 30 | 808 | 0.5322 | 0.9751 | 0.6886 |
| 35 | 760 | 0.5579 | 0.9615 | 0.7061 |
| 40 | 663 | 0.6320 | 0.9501 | 0.7591 |
| 45 | 654 | 0.6330 | 0.9388 | 0.7562 |
| 50 | 488 | 0.8443 | 0.9342 | 0.8870 |
| 55 | 463 | 0.8898 | 0.9342 | 0.9115 |
| 60 | 438 | 0.9384 | 0.9320 | 0.9352 |
| 65 | 414 | 0.9879 | 0.9274 | 0.9567 |
| 70 | 408 | 1.0000 | 0.9252 | 0.9611 |
| 75 | 60 | 1.0000 | 0.1361 | 0.2395 |
| 80 | 29 | 1.0000 | 0.0658 | 0.1234 |
| 85 | 15 | 1.0000 | 0.0340 | 0.0658 |
| 90 | 0 | 0.0000 | 0.0000 | 0.0000 |

### Score distribution (count per 10-point bucket, 0-9 … 100)
| Group | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mule | 3 | 4 | 4 | 11 | 7 | 1 | 3 | 379 | 29 | 0 | 0 |
| other | 7475 | 220 | 73 | 25 | 164 | 49 | 27 | 0 | 0 | 0 | 0 |
| victim | 2 | 0 | 5 | 109 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |

### False positives (top 30)
- none

### False negatives
- ICIC89966077: 68 (PT_STRICT:0.63;LINKED_TO_FLAGGED:0.79;FANOUT_EPISODES:1;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- AIRP66766717: 64 (PT_STRICT:0.65;LINKED_TO_FLAGGED:0.94;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- AIRP86254583: 60 (PT_STRICT:0.60;FANOUT_EPISODES:1;SCRIPT_DEVICE_OUT:2;FOREIGN_PROXY_IP_OUT:2;LINKED_TO_FLAGGED:0.24)
- PYTM35246353: 58 (TERM_OUT:2;LINKED_TO_FLAGGED:0.43)
- ICIC66731321: 46 (LINKED_TO_FLAGGED:0.92;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- SBIN60002594: 45 (TERM_OUT:1;LINKED_TO_FLAGGED:0.46)
- KKBK12494688: 44 (LINKED_TO_FLAGGED:0.78;SCRIPT_DEVICE_OUT:2;FOREIGN_PROXY_IP_OUT:2)
- AXIS69513832: 41 (TERM_OUT:1;LINKED_TO_FLAGGED:0.29)
- KKBK05313085: 41 (LINKED_TO_FLAGGED:0.87;SCRIPT_DEVICE_OUT:2;FOREIGN_PROXY_IP_OUT:2)
- KKBK38669152: 40 (LINKED_TO_FLAGGED:0.80;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- PYTM83321908: 40 (LINKED_TO_FLAGGED:0.82;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- PUNB05077731: 39 (TERM_OUT:1;LINKED_TO_FLAGGED:0.23)
- PYTM45141995: 39 (TERM_OUT:2;LINKED_TO_FLAGGED:0.22)
- PUNB34296768: 38 (TERM_IN:2;LINKED_TO_FLAGGED:0.27;SINK:0.92)
- ICIC01384505: 38 (TERM_OUT:1)
- IPOS85245118: 36 (TERM_IN:2;SINK:0.96)
- ICIC61441276: 34 (TERM_IN:1;SINK:0.94)
- PUNB03008126: 34 (LINKED_TO_FLAGGED:0.77;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- BARB90741855: 33 (TERM_OUT:1)
- PYTM65018052: 32 (LINKED_TO_FLAGGED:0.69;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- IPOS29146336: 31 (LINKED_TO_FLAGGED:0.68;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- BARB06644141: 30 (LINKED_TO_FLAGGED:0.67;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- IPOS91235023: 28 (TERM_IN:2)
- SBIN16813475: 28 (TERM_IN:1)
- PUNB66667760: 28 (LINKED_TO_FLAGGED:0.58;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- SBIN75623996: 21 (LINKED_TO_FLAGGED:0.38;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- AXIS73482700: 19 (LINKED_TO_FLAGGED:0.35;SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- HDFC58911383: 17 (LINKED_TO_FLAGGED:0.43)
- HDFC56598739: 11 (SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- SBIN79325402: 11 (SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- ICIC91916877: 6 (SCRIPT_DEVICE_OUT:1;FOREIGN_PROXY_IP_OUT:1)
- AIRP50391752: 6 ()
- ICIC71906159: 0 ()

## 2. Blind-victim simulation (jury criterion: 40%)
Every victim traced with `Engine.trace`; layers and transactions compared with the ground truth.

- Exact match (same L1, L2, L3 accounts and the same transactions): **6 / 120**
- Mean Jaccard overlap with the true layer: L1 1.000, L2 0.521, L3 0.578
- Trace latency in-process: p50 11.2 ms, max 75.1 ms
- Failing victims: IPOS71854187, ICIC88532204, AXIS56224987, IPOS55357723, PYTM76492626, PUNB05209224, ICIC23218137, ICIC15553168, PUNB09231467, HDFC60320656, BARB65318692, AXIS54606209, IPOS47152802, PYTM13583160, AIRP25644330, KKBK14784555, SBIN22735535, KKBK02075297, IPOS93850112, KKBK11002107
