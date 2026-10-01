# Local AI narrator check

Generated 2026-10-02 04:36 by `bench/llm_check.py`. Model `qwen2.5:3b` via Ollama (GPU) on Intel64 Family 6 Model 165 Stepping 2, GenuineIntel, temperature 0, bounded JSON schema output. The model writes summary, modus operandi and recommendation; layer and holding paragraphs come from templates.

- Accepted by the validator: **10 / 10** victims (the rest use the template narrative; facts are identical either way)
- First call (model load included): 20.1 s
- Later calls: median 13.4 s, max 20.0 s

| Victim | Result | Seconds | Note |
|---|---|---|---|
| ICIC10000106 | accepted | 20.1 |  |
| KKBK10000189 | accepted | 9.0 |  |
| KKBK10000217 | accepted | 9.8 |  |
| BARB10000071 | accepted | 13.4 |  |
| HDFC10000185 | accepted | 18.6 |  |
| AIRP10000221 | accepted | 10.0 |  |
| AXIS10000188 | accepted | 9.8 |  |
| BARB10000127 | accepted | 14.5 |  |
| ICIC10000204 | accepted | 15.1 |  |
| PYTM10000271 | accepted | 20.0 |  |

## Sample accepted narrative (ICIC10000106)

- **summary**: The victim's funds were moved through multiple layers of accounts, starting with E-ACC-002 (layer 1 collector mule) transferring to E-ACC-003, E-ACC-004, E-ACC-005, and E-ACC-006 (layer 2 distributor mules) within 15 minutes, before being transferred to E-ACC-007 (layer 3 cash-out account) for cash-out via wallet or crypto P2P. _(refs: E-ACC-002, E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006, E-ACC-007)_
- **modus_operandi**: Funds were rapidly transferred between layer 1 collector mule (E-ACC-002) and layer 2 distributor mules (E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006) within 15 minutes, before being moved to layer 3 cash-out accounts (E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010) for final cash-out via wallet or crypto P2P. _(refs: E-ACC-002, E-ACC-003, E-ACC-004, E-ACC-005, E-ACC-006, E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010)_
- **recommendation**: A debit hold should be placed on the layer 3 cash-out accounts (E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010) for the amount still held in these accounts, pending verification by the Investigating Officer. _(refs: E-ACC-007, E-ACC-008, E-ACC-009, E-ACC-010)_
