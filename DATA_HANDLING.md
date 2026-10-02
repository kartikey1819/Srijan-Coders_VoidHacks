# Data Handling Rules: Abhedya-Chakra

**Rule zero: the official CSV is evidence. We read it, flag its problems, and never edit it.**

Judges check traces, mule lists and notices against their own copy of the file. Any change we make shows up as a wrong amount or ID in our output.

## 1. Ingest
- Load `VoidHacks8_MuleAccount_2M_Transactions.csv` as-is. Compute its SHA-256 on load and store it in the manifest.
- Store account IDs and IFSCs as strings. Never parse them as numbers.
- Store amounts as integer paise (`round(Amount * 100)`), not floats.
- Give every row a `txn_idx` (row number) as the primary key. **`Transaction_ID` is not unique:** 4,502 rows share their ID with a different transaction (2,252 repeat occurrences). Keep all of them.

## 2. Validate and flag, never fix
Each check adds a flag to the row. No row is edited or dropped.

| Check | Rule | Flag | Found in this file |
|---|---|---|---|
| Account ID format | `^[A-Z]{4}\d{8}$` | `BAD_ACCT_ID` | 0 |
| IFSC format | `^[A-Z]{4}0[A-Z0-9]{6}$`, prefix matches account | `BAD_IFSC` | 0 |
| Duplicate Transaction_ID | Same ID, different row | `DUP_TXN_ID` | 4,502 rows |
| RTGS minimum | ≥ ₹2,00,000 (RBI) | `RTGS_BELOW_MIN` | 59,747 |
| UPI P2P limit | ≤ ₹1,00,000 general limit (NPCI) | `UPI_ABOVE_P2P_LIMIT` | 355 |
| IMPS limit | ≤ ₹5,00,000 | `IMPS_ABOVE_LIMIT` | 0 |
| Time window | Within the 15-day range | `TS_OUT_OF_RANGE` | 0 |
| Self-transfer | Sender ≠ receiver | `SELF_LOOP` | 0 |
| Payment mode | One of UPI/IMPS/NEFT/RTGS | `UNKNOWN_MODE` | 0 |
| Amount | > 0 | `NONPOSITIVE_AMOUNT` | 0 |

- These flags go into a **data-quality report** screen and the account panel as *data anomalies*.
- They **do not** feed the mule risk score, because a rule violation means the data is wrong, not that the account is a mule.
- Word UPI flags as "above general P2P limit", since some UPI categories allow up to ₹5 lakh.

## 3. Derived columns live next to the raw ones
- `bank_name`, mapped from the prefix: IPOS, AXIS, KKBK, SBIN, PUNB, HDFC, ICIC, PYTM, BARB, AIRP.
- `narr_category`: strip the trailing `#nnnn` / `_nnnn` from the narration, then classify it.
- `ip_class`: `185` / `194` / other. `device_class`: human / script.
- The raw value is always kept and always shown alongside.
- Don't replace the fictional IFSC branch codes with real ones, or notices would be addressed to real branches about fake accounts.

## 4. Detection follows the problem statement, not this file
- Use the statement's definitions: the 3–15 min pass-through window, fan-in/fan-out, and its named terminal identifiers (wallet/crypto narration, 185/194 IPs, Web_Emulator/Linux_Script).
- **Do not** hard-code generator quirks:
  - the exact 98%/96% forwarding ratios;
  - exact narration strings as the only signal;
  - the assumption that mules have zero normal traffic.

## 5. Our own test data, kept separate
- Write a generator that follows real rules (rail limits, numeric-style realism) and adds harder cases:
  - mules with normal traffic;
  - several victims sharing one first-layer mule;
  - delays outside 3–15 min;
  - real cycles;
  - high fan-in merchants.
- Output goes to `testdata/` with `SYNTHETIC_TEST` in the filename. Never mix it with the official file.
- Run the engine on both files and report results for each.

## 6. Tune on half, check on half
> Plan as written before the build. The weights were in the end set by hand and not fitted; both halves are
> reported out-of-sample in `eval/report.md`. Where this file differs from the code, `docs/HOW_IT_WORKS.md` is current.

- Split the 300 victims (`TASK_EARNING_REFUND` senders) 150/150. Tune thresholds and weights on one half and report accuracy on the other.
- Don't target 1,500 flagged accounts: only 1,073 mule accounts appear in this file.

## Don'ts
- ❌ Edit, re-save or "clean" the official CSV.
- ❌ Drop duplicate-ID rows.
- ❌ Convert account IDs to numbers.
- ❌ Use data-quality flags as risk signals.
- ❌ Claim timings we haven't benchmarked.
