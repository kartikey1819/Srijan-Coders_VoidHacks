# Design: Case Register

The investigator UI (`web/src`) is laid out like an official case register: numbered entries, ruled fields and
typed values, with one place for every fact. The answer comes first (which accounts hold the victim's money, and how
much); the graph and timeline are the evidence annex. Product facts live in `PRODUCT.md`.

## Two looks, one kit
A header switch sets `<html data-look>`. The choice is remembered per browser (localStorage, in try/catch) and can be
overridden with `?look=official|briefing`. Both looks share the same markup, components, data and tests; only the
tokens in `web/src/index.css` differ.

| Token | Official (default) | Briefing |
|---|---|---|
| Page / sheet | `#f3f5f7` / `#ffffff` | `#eef1f5` / `#ffffff` |
| Ink / secondary / muted | `#14213d` / `#33415a` / `#5c6773` | `#0d1b2a` / `#26364a` / `#4f5b6a` |
| Rules | `#d9dee4`, strong `#aab3bd` | same |
| Victim | ink, drawn as a square | ink, drawn as a square |
| L1 / L2 / L3 | `#c46a12` / `#6b4fb5` / `#00897b` | `#e8711a` / `#6d4fc2` / `#00917f` |
| Still held (reserved) | `#a4161a` | `#b3141f` |
| Base / small / case figure | 14 / 12.5 / 22 px | 15 / 13 / 32 px |
| Corner radius | 2 px | 4 px |
| Motion | none (state changes are instant steps) | 220 ms ease-out; trail edges fade in during playback |
| Layer bands on register headings | none | 6 px band in the layer colour |

**Colour rules**
- Validated with the dataviz checker on white, across all pairs (the graph can place any layers side by side):
  - Official: worst CVD ΔE 11.5, normal-vision 22.0.
  - Briefing: worst CVD ΔE 11.4, normal-vision 24.3.
  - The reserved red clears every layer colour (normal-vision ≥ 17.7).
- Red means only "money still held / freeze". L3 is teal so that red never doubles as a layer.
- A layer is never shown by colour alone. Column position, register grouping, labels and the square victim carry it
  too.

**Type**
- Atkinson Hyperlegible Next for text, and Atkinson Hyperlegible Mono for account IDs, transaction IDs and tabular
  figures. Both were designed for low-vision legibility: 0/O and 1/I/l stay distinct on a projector.
- The fonts are bundled from npm (`@fontsource-variable/*`), so no font request ever leaves the machine.

## Components
- **Shell:** product name, ID search (format check as you type, near matches from `/api/search`), look switch, and a
  dataset line (rows, accounts, file hash, offline). Tabs are links with `aria-current`. Hash routes
  (`route.ts`) are the single source of truth, so Back and Forward work and pasted links work.
- **Case header:** victim, amount taken, still held (red), the L1 · L2 · L3 spread with time since the theft, and freeze
  requests by bank. The primary action is "Case diary & notices".
- **Register:** layer groups with numbered rows: account, bank, arrival as T+ time, received, still held, and Ring.
  Rows are ordered freeze-first. They are keyboard-reachable (Tab, then Enter to open).
- **Annex:**
  - Cytoscape graph: Victim | L1 | L2 | L3 columns, edge width = victim money, dashed edges = more than 15 minutes.
  - "Victim money still in mule accounts" chart: stacked by layer, sharing the time cursor.
- **Timeline:** play / pause, speed, previous / next transfer, and a range input with a readable `aria-valuetext`.
  It shows transfer ticks, or an activity histogram when there are more than 150 transfers, plus a 15-day switch. It
  stays pinned to the bottom of the screen. `data-visible-edges` on the graph is kept for tests.
- **Drawer:** the account panel opens beside the work, not below the fold. Esc closes it and focus returns.
- **Ring:**
  - The labelled starting account.
  - Layer filters.
  - Accounts appear when their money first arrives.
  - Scrubbing touches only the elements whose state changes.
  - ZIP export.
- **Charts** (`charts.tsx`, d3-scale and d3-shape rendered as SVG): titles state the finding. Each has a source line,
  hover / focus tooltips, hit areas larger than the marks, bars ≤ 24 px with 4 px rounded data ends, hairline grids,
  and no dual axes. Every bar links through to the filtered list.

## Do / don't
- Do: put the answer before the evidence; give every figure its source; use plain words ("money arrived T+7 min").
- Don't use:
  - badges, points, celebratory motion or alarm colours;
  - gradient text, glow, or cards inside cards;
  - eyebrow labels;
  - em dashes in visible copy;
  - `dangerouslySetInnerHTML`.

## Measured (full 2M-row file, 1366×768, headless Edge)
| Measure | Result |
|---|---|
| Trace screen ready | about 0.33 s |
| Trace slider | 7 ms per step |
| Ring (1,373 accounts) ready | about 1.0 s |
| Ring slider | 31.5 ms median (Cytoscape redraw of 2,954 edges dominates) |
| `/api/overview` | 122 ms first call, then cached |
| Design detector (`impeccable detect`) | 0 findings after the fix |
