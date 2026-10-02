# Design: police workstation

The investigator UI (`web/src`) is built for Indian police officers, not analysts. Every screen has to be understood at
a glance, in plain words, while still giving exact details. It uses a government frame (tricolour strip, police
masthead, navy sidebar) around quiet, ruled report pages. Product facts live in `PRODUCT.md`.

## Frame
- **Masthead:**
  - a thin tricolour strip;
  - a crest, "Indore Police Commissionerate · Cyber Crime Cell" with its Hindi line, and the system name;
  - account search (Enter traces it);
  - the Day / Night switch, the IST date and time, and "For official use only".
- **Left sidebar (navy):** five screens, each in English with the Hindi name beneath:
  - Dashboard (डैशबोर्ड);
  - Trace Victim Funds (पीड़ित राशि का पता लगाएँ);
  - Suspect Accounts (संदिग्ध खाते);
  - Fraud Networks (धोखाधड़ी नेटवर्क);
  - Data Management (डेटा प्रबंधन).

  The footer shows the loaded data (case switcher, rows, accounts, file fingerprint) and that nothing leaves the computer.
- **Pages scroll naturally;** only the masthead and the sidebar stay put. Every page starts with a breadcrumb, the
  English title with the Hindi title beside it, one line on what the page is for, and its actions. It ends with a
  footer saying results are investigative aids to verify against bank records.

## Themes: Day and Night
One token set per theme on `<html data-theme>` (`light` default, `dark`), remembered per browser, `?theme=` overrides.

| | Day | Night |
|---|---|---|
| Ground / panel | `#eef1f5` / `#ffffff` | `#0e1520` / `#172031` |
| Ink / muted | `#1a2233` / `#4f5b6d` | `#e4e9f1` / `#a5b0c2` |
| Accent | navy blue `#1d4f91` | `#7fb0ff` |
| Sidebar | navy `#0d2d5e` | `#0a1426` |
| Victim / L1 / L2 / L3 | `#1d4f91` / `#c46a12` / `#6b4fb5` / `#00897b` | `#4f8fe8` / `#d97520` / `#8466ec` / `#109e8a` |
| Can still be frozen | green `#157f3b` | `#4ac26b` |
| Money at risk, warnings | red `#b42318` | `#f47067` |
| Main action | burnt orange `#b4530a` | `#f39a4a` |

- **Colour checks** (dataviz validator, categorical, against each theme's own panel colour). Both themes pass every
  check:
  - Day: worst CVD ΔE 15.1, normal vision 22.0.
  - Night: worst CVD ΔE 18.6, normal vision 25.6.
- **Fonts:** Noto Sans and Noto Sans Devanagari for text, IBM Plex Mono for account numbers and IDs. They are
  self-hosted from npm (`@fontsource/*`), so no font request leaves the machine.
- **Sizes:** body text 15 px; buttons and fields at least 38-40 px high; sidebar items 44 px.

## Writing for officers
- **Roles in words:** "Collector (Layer 1)", "Distributor (Layer 2)", "Cash-out (Layer 3)", "Victim".
- **Money in words:** "can still be frozen", "already withdrawn or moved on".
- **Time from the victim's payment:** "+4 min". Rupees use Indian grouping (₹4,55,541.61), and ₹4.55 L for compact
  figures.
- **No internal codes on screen.** Reason codes become sentences ("Passes money on within 3-15 minutes"), and engine
  warnings are rewritten plainly (`components/trace/model.ts`, `plainWarning`).
- **Titles and notes:** every panel title says what it shows, and a one-line note says how to use it.

## Trace Victim Funds (the page the jury tests)
One scrolling report, top to bottom:
1. **Select the victim account:** account number, "Follow money up to N transfers away", Trace, or choose an
   identified victim (largest loss first). It also asks "Which payments did the victim report?" (the disputed-transfer
   picker).
2. **Summary:** one plain sentence, then the journey strip: taken from victim, then N collectors, N distributors,
   N cash-out accounts, then can still be frozen. Each station shows its count and amount, with the time on each
   arrow.
3. **Four insight cards:**
   - how fast the money moved (the collector's pass-on time);
   - how widely it was spread (mini fan and bank chips);
   - signs of an organised operation (foreign proxy IPs, scripts, wallet / crypto cash-outs);
   - amount that can be recovered.
4. **How the money moved:** the money-trail tree.
   - Columns run Victim, Layer 1 Collector, Layer 2 Distributors, Layer 3 Cash-out. Each account sits under the account
     that first paid it.
   - Pointing at a box follows its path; a click opens the account; Replay builds the tree transfer by transfer.
   - The minute-by-minute timeline (play, step size, 1x-2x, previous / next, 15-day switch) drives it, and later boxes
     are faded.
   - Solid lines mean money moved within the hour, dashed means later. More than six accounts paid by one account
     fold into "+N more", which expands on a click.
5. **Where the money sat, minute by minute:** a stacked chart that shares the time cursor.
6. **Collector account: first minutes after the victim's payment** (credit up, debits down, balance draining), next to
   the **Trace record**:
   - victim and payments followed;
   - how far, and the method in plain words (3-15 minute window, at least 90 % amount match, own money first);
   - accounts per layer, warning signs, points to check, and time taken.
7. **Accounts to freeze** next to **Transactions in the trail** (mode and device, with foreign proxies in red).

Header actions: Download trail (CSV), View fraud network, and **Prepare case diary and freeze notices**.

## Case documents
A large dialog:
- **Left side:** the case particulars:
  - FIR / Case No., NCRP / 1930 Complaint No., Investigating Officer, Rank, Police Station, Sections of law;
  - the local AI switch, which says whether the model is installed;
  - Prepare documents;
  - a **Verification passed / failed** box. It says how many accounts, IFSCs, transaction IDs and amounts the output
    firewall checked against the data, how many failed, and shows the evidence fingerprint.
- **Right side:** tabs for Case diary, All freeze notices (N), and one per bank with its hold amount; Save HTML;
  Print / PDF; the document on paper.
- **The documents:**
  - the case diary follows Section 192 BNSS with six numbered sections;
  - each bank's notice cites Sections 94 and 106 BNSS (91 and 102 CrPC) and asks for a debit hold limited to the
    amount shown.

## Other screens
- **Dashboard:**
  - a headline sentence;
  - the score distribution with the 70 line;
  - suspect accounts by role (donut);
  - why accounts were flagged; suspects by bank; daily activity; victims found.

  Every chart opens the filtered list.
- **Suspect Accounts:** the list with role badges and reasons in words, filters, the account panel beside it (the
  divider is resizable and remembered), and CSV downloads.
- **Fraud Networks:**
  - Without an account: a start list of collector accounts.
  - With one: the 3D globe (click a dot to light its money journey; double-click a link for its flow) or the strict
    Columns view, with layer filters, the time slider, PNG picture and ZIP export.
- **Data Management:** the six steps of how the system works, each with a live figure; upload with live stage
  timings; saved cases (open, remove).

## Motion (Emil Kowalski's design-engineering rules)
- Ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; UI motion 160-200 ms; only `transform` and `opacity` animate.
- Buttons press to `scale(0.97)`; hover effects only with a fine pointer.
- `prefers-reduced-motion` switches movement off.
- The impeccable design detector reports 0 findings on `web/src`.
