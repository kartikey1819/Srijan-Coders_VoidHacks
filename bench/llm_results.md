# Local AI narrator check

Generated 2026-10-02 06:30 by `bench/llm_check.py`. Model `qwen2.5:3b` via Ollama (GPU) on Intel64 Family 6 Model 165 Stepping 2, GenuineIntel, temperature 0, bounded JSON schema output. The model writes summary, modus operandi and recommendation; layer and holding paragraphs come from templates.

- Accepted by the validator: **8 / 10** victims (the rest use the template narrative; facts are identical either way)
- First call (model load included): 26.3 s
- Later calls: median 15.3 s, max 30.6 s

| Victim | Result | Seconds | Note |
|---|---|---|---|
| ICIC10000106 | accepted | 26.3 |  |
| KKBK10000189 | accepted | 13.9 |  |
| KKBK10000217 | accepted | 10.8 |  |
| BARB10000071 | accepted | 20.9 |  |
| HDFC10000185 | accepted | 22.1 |  |
| AIRP10000221 | accepted | 15.3 |  |
| AXIS10000188 | accepted | 13.8 |  |
| BARB10000127 | accepted | 14.3 |  |
| ICIC10000204 | template fallback | 30.6 | AI narrative rejected by the validator: summary paragraph 1: E-ACC-003 is described as 'collector' but it is a layer 2 distributor account; summary paragraph 1: E-ACC-004 is described as 'collector' but it is a layer 2 distributor account; summary paragraph 1: E-ACC-005 is described as 'collector' but it is a layer 2 distributor account |
| PYTM10000271 | template fallback | 26.8 | AI narrative rejected by the validator: summary paragraph 1 E-ACC-008 is described as a ICICI Bank account but it is at Airtel Payments Bank; modus_operandi paragraph 1 E-ACC-008 is described as a ICICI Bank account but it is at Airtel Payments Bank; recommendation paragraph 1 E-ACC-007 is described as a Bank of Baroda account but it is at ICICI Bank |

## Sample accepted narrative (ICIC10000106)

- **summary**: E-ACC-002, a layer 1 collector mule, transferred funds to multiple layer 2 distributor mules (E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006) within 15 minutes, facilitating the fraud. _(refs: E-ACC-002, E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006)_
- **modus_operandi**: Funds were moved rapidly through multiple layers, with E-ACC-002 transferring to layer 2 distributor mules (E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006) within 15 minutes, before being cashed out via layer 3 accounts (E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010) within an hour. _(refs: E-ACC-002, E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006, E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010)_
- **recommendation**: A debit hold should be placed on the layer 3 cash-out accounts (E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010) for the amount still held in these accounts, pending verification by the Investigating Officer. _(refs: E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010)_
