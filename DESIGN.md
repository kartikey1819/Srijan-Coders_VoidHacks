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
- **Left sidebar (navy):** four screens, each in English with the Hindi name beneath:
  - Dashboard (डैशबोर्ड);
  - Trace Victim Funds (पीड़ित राशि का पता लगाएँ);
  - Suspect Accounts (संदिग्ध खाते);
  - Fraud Networks (धोखाधड़ी नेटवर्क).

  The footer shows the open case (switcher, transactions, accounts) and that nothing leaves the computer. There is no
  separate data page: the Dashboard names the dataset every report uses and uploads new files.
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
The first screen shows the selector, the summary and the insight cards together, without scrolling.

1. **Select the victim account** (a compact bar): account number, "Follow money up to N transfers away", Trace, or choose an
   identified victim (largest loss first). It also asks "Which payments did the victim report?" (the disputed-transfer
   picker).
2. **Summary:** one plain sentence, then the journey strip: taken from victim, then N collectors, N distributors,
   N cash-out accounts, then can still be frozen. Each station shows its count and amount, with the time on each
   arrow. Arrows carry a slow, continuous flow (off with reduced motion). Download trail, View fraud network and
   Prepare case diary sit in the summary's header.
3. **Four insight cards:**
   - how fast the money moved (the collector's pass-on time, in minutes, hours or days; the ruler reads 0-60 min
     around the 3-15 minute mule pattern, and slower trails sit at its far end);
   - how widely it was spread (mini fan and bank chips);
   - signs of an organised operation (foreign proxy IPs, scripts, wallet / crypto cash-outs);
   - amount that can be recovered.
4. **How the money moved:** the money-trail tree.
   - Columns run Victim, Layer 1 Collector, Layer 2 Distributors, Layer 3 Cash-out. Each account sits under the account
     that first paid it.
   - Pointing at a box follows its path and shows what the account received from this victim, passed on and still
     holds; a click opens the account panel; Replay builds the tree transfer by transfer.
   - The timeline (play, step, 1x-2x, previous / next, 15-day switch) drives it, and later boxes are faded. Step sizes
     fit the trail: only steps that leave at least four frames are offered, and "Transfer by transfer" jumps from one
     transfer to the next (the default for trails longer than two hours).
   - Solid lines mean money moved within the hour, dashed means later. More than six accounts paid by one account
     fold into "+N more", which expands on a click.
5. **Collector account: first minutes after the victim's payment**: four figures, then each payment out as a
   waterfall (each bar starts where the last one ended, ending with what is still in the account), next to
   the **Trace record**:
   - victim and payments followed;
   - how far, and the method in plain words (3-15 minute window, at least 90 % amount match, own money first);
   - accounts per layer, warning signs, points to check, and time taken.
6. **Accounts to freeze** next to **Transactions in the trail** (mode and device, with foreign proxies in red).

Summary actions: Download trail (CSV), View fraud network, and **Prepare case diary and freeze notices**.

## Case documents
A large dialog:
- **Left side:** the case particulars:
  - FIR / Case No., NCRP / 1930 Complaint No., Investigating Officer, Rank, Police Station, Sections of law;
  - the local AI switch, which says whether the model is installed;
  - Prepare documents;
  - a **Verification passed / failed** box. It says how many accounts, IFSCs, transaction IDs and amounts the output
    firewall checked against the data, how many failed, and shows the evidence fingerprint.
- **Right side:** tabs for Case diary, FIR draft, All freeze notices (N), and one per bank with its hold amount;
  Complete case file (ZIP); Save HTML; Print / PDF; the document on paper.
- **The documents:**
  - the FIR draft follows the Section 173 BNSS FIR layout (acts and sections, occurrence, complainant, suspected
    accounts by layer, property stolen, first information, action taken), marked as a draft format for the
    officer's verification; its figures pass the same output firewall;
  - the case diary follows Section 192 BNSS with six numbered sections;
  - each bank's notice cites Sections 94 and 106 BNSS (91 and 102 CrPC) and asks for a debit hold limited to the
    amount shown.
  - the complete case file is one ZIP: every document, the evidence, the manifest (SHA-256 of each file), the money
    trail as CSV and a README.

## Trace several victims (`#traceall=A,B,C`)
For the blind test: paste the complainants' account numbers (any separator, up to 20) and Trace all. Reached from
Trace Victim Funds ("Several victims") and the Dashboard's third recommended action. For a demonstration,
**Paste 5 random victims** fills the box with five identified victims picked at random (a different five each
click) and **Paste the 5 largest-loss victims** with the top five; Trace all stays a separate click.
- **Totals:** victims traced (each in milliseconds), total taken, can still be frozen, mule accounts, accounts
  shared by two or more victims.
- **These complaints may be clubbed:** groups of complainants joined by shared mule accounts, and each shared
  account with its role, the complainants, their money received and still held.
- **Side by side:** one column per victim with its collectors, distributors and cash-out accounts (largest first,
  shared ones marked), the amount that can be frozen, Open trace and Documents.
- **Combined trails (CSV):** every victim's trail in one file, with the victim on each row.

## Other screens
- **Dashboard:**
  - top right, **Data in use for every report**: the open dataset (switchable), its transactions and
    accounts, and **Upload new file**, which opens the analyse dialog (drop zone, live stages, saved cases with Open /
    Remove);
  - first view, **Where the victims' money went** (`/api/flow`: every identified victim traced once with the trace
    screen's rules, summed per layer): Victims → Collectors → Distributors → Cash-out stations with account counts,
    amounts, and two facts each (average / largest loss; share passed on within 15 min and victims each; share passed
    on within the hour and cash-outs each; share by wallet / crypto). Arrows carry the amount, a slow continuous flow
    and the median time after the victim paid. Beside it, **Can still be frozen** (total, share of the loss, where it
    is held by layer); under it, every account checked (donut: regular, victims, each layer) and three notes: banks to
    notify, whether the suspects form one linked network, and whether any money was sent back to an earlier account.
    Below 1360 px the freeze strip moves under the chain so the key figures stay in the first view. The freeze
    panel ends with **Recommended actions**: freeze the largest pool first, send notices to the banks (the one with
    the most suspect accounts named), and club the complaints that share a collector, with the largest group traced
    together in one click;
  - why accounts were flagged; suspects by bank; daily activity; victims found.

  Every chart opens the filtered list.
- **Account panel** (everywhere an account opens): **How the score of N was reached**, the four checks (passes money
  on fast; splits, gathers or circles money; cash-out channel, script device or foreign IP; money from or to other
  suspects), each with its points on its own out of its maximum and the reason in words, then how they combine (overlap
  is not counted twice) or the named pattern that set a minimum. It is recomputed from the stored features and always
  equals the stored score.
- **Suspect Accounts:** the list with role badges and reasons in words, filters, the account panel beside it (the
  divider is resizable and remembered), and CSV downloads.
- **Fraud Networks:**
  - Without an account: a start list of collector accounts.
  - With one: **Money flow** (default) shows that account's money left to right: who paid in (two steps back), the
    account, then where its money went (three time-respecting steps on); line thickness is the amount. It is sized to
    the window: the panels and time slider fill the space under the header, each column shows as many accounts as
    fit (largest first) with the rest in "+N more", and boxes narrow to the panel width. A click re-centres on that
    account; pointing shows what it received in the network, passed on and kept.
  - **Trail** isolates one victim's money through that account instead of the whole network,
    drawn exactly like the trace tree (Victim, Layer 1 Collector, Layer 2 Distributors, Layer 3 Cash-out; amount and
    time after the victim paid on every box; solid within the hour, dashed later). The account is outlined. A picker
    lists every victim whose money reached it (largest first). Pointing at a box shows what it received from that
    victim, passed on and still holds; a click opens its journey beside the tree. **Globe** is the toggle for the
    whole network (click a dot to light its journey; double-click a link for its flow). Layer filters, the time
    slider and ZIP export work in both.

## Motion (Emil Kowalski's design-engineering rules)
- Ease-out `cubic-bezier(0.23, 1, 0.32, 1)`; UI motion 160-200 ms; only `transform` and `opacity` animate.
- Buttons press to `scale(0.97)`; hover effects only with a fine pointer.
- `prefers-reduced-motion` switches movement off.
- Fixed overlays (account panel, dialogs) are portalled to `<body>`: a transformed ancestor would otherwise capture
  `position: fixed`. Screen entrances therefore animate opacity only.
- The impeccable design detector reports 0 findings on `web/src`.
