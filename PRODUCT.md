# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Primary: cyber-crime investigators** (Indore Police / 1930 Cyber Cell). They receive multi-bank transaction
  exports after a fraud complaint and must find where the victim's money went, which accounts still hold it, and
  send freeze requests to banks before it is withdrawn. Time pressure is real: mule networks move money within
  minutes.
- **Evaluators: the Void Hacks 8.0 jury** (police officials and industry mentors). They judge in two ways:
  - the team presents on its own laptop through a projector;
  - judges then use the tool hands-on, typing 5 unannounced victim account IDs themselves.
  Controls must therefore be self-explanatory to a first-time user, and readable from the back of a room.

## Product Purpose
Abhedya-Chakra is an offline workstation that turns a raw bank transaction export into an investigation:
1. it ingests and validates the file;
2. it scores every account for mule risk (0–100, with reasons);
3. it traces a victim's money through up to 4 hops (collector → distributor → cash-out);
4. it isolates the whole syndicate ring;
5. it drafts a police case diary and one bank freeze notice per bank.

Success means an officer can go from a victim account ID to court-ready freeze notices in minutes, and can defend
every number in them.

## Positioning
Every figure is traceable to a transaction row in the original, never-modified file:
- the trace conserves every paisa and states which attribution rule moved each rupee (3–15 minute window, then
  ≥ 90 % amount match, then own-money-first);
- the optional local AI writes prose only from evidence IDs, and is checked by a validator and an output firewall;
- nothing leaves the machine.

## Operating Context
- Runs locally: `python -m abhedya serve --data <csv>`. A browser on 127.0.0.1, offline, single user.
- Typical hardware: 16 GB office laptops, often at 1366×768. In judging, a projector.
- Data: the official 2,000,000-row file (24,873 accounts, 15-day window 2026-09-15 to 2026-09-29), 11 columns
  including IFSC, payment mode, narration, IP and device.
- Outputs:
  - a police case diary (HTML, printable);
  - Section 94 BNSS (old Section 91 CrPC) freeze notices addressed to bank nodal officers;
  - CSV / ZIP exports of flagged accounts and isolated rings.
- Jury weights: blind victim trace 40 %, detection precision / recall 30 %, court-ready output and usability 20 %,
  engineering 10 %.

## Capabilities and Constraints
- **Capabilities:**
  - flagged-account list with reason codes;
  - victim trace with exact layer accounts, amounts, timestamps and the attribution rule per transfer;
  - choice of disputed transfers;
  - syndicate ring isolation with export;
  - minute-by-minute temporal playback;
  - account summaries (counterparties, channels, devices, IP classes, data-quality flags);
  - data-quality report;
  - document generation with or without the local AI.
- **Required by the problem statement:**
  - interactive graph that stays responsive at 500+ nodes / 1,500+ edges (the official ring has 1,373 / 2,954);
  - temporal playback slider across the 15 days;
  - one-click subgraph isolation with export;
  - fully offline.
- **Terminology:** victim (complainant), L1 collector mule, L2 distributor mule, L3 cash-out, ring / syndicate,
  freeze candidate, disputed transfer, data-quality flag, mule risk index (0–100; HIGH ≥ 70).
- **Money and IDs:** money in Indian rupee grouping (₹4,55,541.61). Account IDs are 12 characters (4-letter bank
  prefix + 8 digits). Timestamps are shown as in the source file.
- **Language:** English only.

## Brand Commitments
- Name: **Abhedya-Chakra** (event theme "Abhedya – Cyber Security & Digital Forensics"; Void Hacks 8.0).
- No police emblem, government seal or official logo. Nothing may imply official endorsement.
- Tone: official, factual, restrained. Not gamified: no badges, points, streaks, celebratory motion or playful
  language.

## Evidence on Hand
- Measured results only, from these files:
  - `bench/results.md` / `bench/results.json`;
  - `eval/report.md` (precision / recall 1.0000, 300 / 300 traces);
  - `bench/llm_results.md`;
  - `reports/final_readiness_report.md`;
  - `reports/final_test_matrix.md`.
- No testimonials, users, deployments or endorsements exist. None may be invented.

## Product Principles
1. **Every number is traceable:** each figure on screen leads back to rows in the original file.
2. **The investigator reads, then explores:** exact accounts and amounts must be readable as text without operating
   the graph.
3. **Explain, do not assert:** risk scores and trace steps show the rule or signal behind them.
4. **Time is evidence:** when money moved, and how fast, is shown as precisely as how much.
5. **Offline and honest:** no network, no invented data, limitations stated plainly.

## Accessibility & Inclusion
- WCAG AA contrast.
- Full keyboard operation of the trace and ring workflows.
- Meaning never carried by colour alone (role colours are always paired with position or labels).
- `prefers-reduced-motion` respected.
- Legible on a projector.
