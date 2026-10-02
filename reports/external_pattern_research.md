# External pattern research (for test design only)

These sources were used **only** to design independent test scenarios (`tests/adversarial_data/`).
Nothing here is imported into `abhedya/`, and no source is treated as proof that a pattern means "mule".
Every quote below was read from the source itself on 2026-10-02. One source (the Isle of Man FIU
typologies PDF) refused automated access and is **not** used.

| # | Source | What it says (short) | What it contributed to the tests |
|---|---|---|---|
| 1 | Altman, Blanuša, von Niederhäusern, Egressy, Anghel, Atasu, *Realistic Synthetic Financial Transactions for Anti-Money Laundering Models*, NeurIPS 2023 ([arXiv 2306.16424](https://arxiv.org/abs/2306.16424)) | Fig. 2, "Laundering Patterns Modelled": **fan-out, fan-in, gather-scatter, scatter-gather, simple cycle, random, bipartite, stack** (intermediate vertices). Laundering is embedded among legitimate transactions, and real-data labels are incomplete ("many instances of laundering being missed") | One scenario family per pattern, built from graph shape only, embedded in legitimate background traffic. Evaluated per family, so a detector that only knows one shape shows up as a gap, not an average |
| 2 | FBI public service announcement I-111919-PSA *Money Mules* (19 Nov 2019), distributed by Europol for EMMA ([PDF](https://www.europol.europa.eu/sites/default/files/documents/emma_psa_fbi.pdf)) | Mules move funds by "physical currency (cash), bank transfers, money services businesses, pre-paid cards, cryptocurrency". They are asked "to receive funds and then forward all or a portion". Three groups: **unwitting, witting, complicit**. Unwitting mules are "told to keep a portion of the funds" | Variable commission (0–10%, not one fixed ratio). Mules that keep a normal personal history and are partly used (unwitting). Cash-out not only to crypto/wallet: also to ordinary accounts, which the statement's L3 identifiers will **not** catch (documented as expected misses) |
| 3 | FinCEN Advisory FIN-2020-A003 *Imposter Scams and Money Mule Schemes* (7 Jul 2020) ([PDF](https://www.fincen.gov/system/files/advisory/2020-07-07/Advisory_%20Imposter_and_Money_Mule_COVID_19_508_FINAL.pdf)) | "No single financial red flag indicator is necessarily indicative of illicit or suspicious activity" (institutions should look for multiple indicators). Red flags: an account that "had a low balance until the customer became involved"; a new account where "shortly thereafter, someone transfers the funds out" and "may keep a portion"; "accounts in his or her name at multiple banks"; deposits "quickly diverted via wire transaction to foreign accounts" | **Single-indicator benign families** (only crypto, only a foreign IP, only a script device, only high fan-in, only fast pass-through) that must not be flagged HIGH on one signal alone. New/dormant accounts that suddenly pass money through. One person with accounts at several banks |
| 4 | FinCEN Advisory FIN-2014-A005 *funnel accounts* (as summarised in search results; [advisory page](https://www.fincen.gov/resources/advisories/fincen-advisory-fin-2014-a005)) | Funnel accounts: deposits made in one place and withdrawn elsewhere "with little time elapsing between deposit and withdrawal" | Funnel family: many small inflows from distinct senders, quickly forwarded in one or two large outflows (fan-in then pass-through) |
| 5 | FinCEN Advisory on currency mule laundering networks (Aug 2025) ([PDF](https://www.fincen.gov/system/files/2025-08/FinCEN-Advisory-CMLN-508.pdf), as summarised in search results) | Red flag: an account receiving "numerous transfers or deposits with a significant number of withdrawals or transfers, none of which appear to be related to routine payroll, living expenses" | The contrast case: legitimate accounts with **many in and out transfers that are payroll / living expenses** (salary accounts, employers, treasury sweeps) are hard negatives |
| 6 | Industry and academic material on transaction-monitoring false positives: Lucinity and Flagright explainers; ScienceDirect 2024 qualitative industry study ([S0167739X24002607](https://www.sciencedirect.com/science/article/pii/S0167739X24002607)) | Rule-based monitoring commonly reports 85–95% false-positive alert rates. Typical sources: routine payroll, vendor payments, high-value businesses, legitimate cross-border payments | Hard-negative families: payroll fan-out, merchant fan-in, payment aggregator in-and-out, high-value business, family pooling, refunds, internal transfers between one person's own accounts |
| 7 | Press Information Bureau, *I4C and RBIH sign MoU…* (May 2026) ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2260277&reg=3&lang=1)) | I4C integrates the NCRP / Suspect Registry with RBIH's MuleHunter.AI, which analyses "transaction patterns and account behaviour… before funds are withdrawn or dispersed" | Context only (Indian setting, victim → mule chain → dispersal). Supports including victims who also have normal spending, so tracing must start from the disputed transfer |

## Scenario families derived (implemented in `tests/adversarial_data/scenarios.py`)

**Laundering-like (expected to be flagged when the statement's indicators are present):**
1. Rapid pass-through (single mule)
2. Fan-in → L1 → fan-out (gather-scatter)
3. Multi-layer chain (stack)
4. Victim → L1 → L2 → L3 with wallet/crypto cash-out
5. Script / emulator-assisted movement
6. Foreign-proxy IP activity
7. Several victims → one shared L1
8. Several independent rings at once
9. Amounts from small to very large, with variable commission
10. Timing from minutes to days
11. Split transfers (many small instead of one)
12. Normal-looking personal transactions mixed in (unwitting mule)
13. Activity spread over several days
14. Smurfing cycle (same ring repeated)
15. Scatter-gather and bipartite
16. Cash-out to an ordinary account (no statement identifier: an **expected miss**, reported separately)

**Legitimate look-alikes (must not be flagged HIGH):**
salary account, employer payroll fan-out, merchant fan-in, payment aggregator (in then out quickly), high-value business,
family pooling, legitimate shared device / IP, treasury sweep between own accounts, frequent small payments, refunds,
legitimate crypto investor (wallet top-ups only), traveller on a foreign IP, power user on a script/API client, and
circular-looking but legitimate flows (rent split among flatmates).

Labels come from the **scenario's meaning** (who launders, who is legitimate), not from our detector's rules or thresholds.
A family whose only "suspicious" feature is a single indicator is labelled legitimate, following source 3.
