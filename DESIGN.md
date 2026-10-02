# Design: Case Register

The investigator UI (`web/src`) is laid out like an official case register: numbered entries, ruled fields and
typed values, with one place for every fact. The answer comes first (which accounts hold the victim's money, and how
much); the graph and timeline are the evidence annex. Product facts live in `PRODUCT.md`.

## Two looks, one kit: Official | Gen-Z
A header switch sets `<html data-look>` (`official` default, `genz`). The choice is remembered per browser and can
be overridden with `?look=`; the old `briefing` value maps to `genz`. Both looks share the markup, data, behaviour and
tests. Tokens (`web/src/index.css`), fonts, motion and copy voice (`web/src/copy.ts`) differ, and facts never do.

| | Official (default) | Gen-Z |
|---|---|---|
| Ground / panel | light `#f3f5f7` / `#ffffff` | dark `#0b0d12` / `#141821` |
| Ink / muted | `#14213d` / `#5c6773` | `#f2f4f8` / `#8e97a8` |
| Accent | navy ink | electric lime `#c6ff3d` (on `#0b0d12` ink) |
| L1 / L2 / L3 | `#c46a12` / `#6b4fb5` / `#00897b` | `#d97520` / `#8466ec` / `#109e8a` |
| Money at risk (reserved) | `#a4161a` | `#ff4d8d` |
| Text / display / IDs | IBM Plex Sans / IBM Plex Sans / IBM Plex Mono | Inter / Space Grotesk / JetBrains Mono |
| Case figures | 22 px | 40 px, counted up on arrival |
| Radius | 2 px panels and buttons | 14 px panels, pill buttons |
| Motion | 120 ms fades, no movement | 280 ms ease-out rises, staggers, graph build-up, globe particles |
| Copy | "Still held in 11 accounts" | "still catchable in 11 accounts 👀" |

**Colour checks** (dataviz validator, all pairs):
- Official on white: worst CVD ΔE 11.5, normal-vision 22.0.
- Gen-Z on `#141821`: inside the dark band, worst CVD ΔE 12.4, normal-vision 23.9. The at-risk pink clears every layer
  colour (normal-vision 17.3).

**Contrast:** all text at least 4.5:1 in both looks (Gen-Z muted on panel: 6.0:1).

**Fonts:** self-hosted from npm (`@fontsource/*`); no font request leaves the machine.

## Motion rules (Emil Kowalski's design-engineering principles)
- Ease-out curve `cubic-bezier(0.23, 1, 0.32, 1)`; UI motion stays under 300 ms; nothing enters from `scale(0)`.
- Buttons press to `scale(0.97)`; hover effects only on devices with a fine pointer.
- Only `transform` and `opacity` animate. Bars grow with `scaleX/scaleY`, lines draw with `stroke-dashoffset`; the
  detector confirms no layout-property animation.
- Staggers are 30 ms per item, capped at 10 items. Keyboard-repeated actions are never animated.
- `prefers-reduced-motion`: movement, staggers, counters, globe rotation, camera flights and particles switch off;
  short fades remain.

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
- **Home (first screen):** six pipeline steps with live figures and small looping illustrations; a drop zone that
  uploads a CSV, shows each analysis stage with its real timing, and opens the result as a new saved case. Saved cases
  switch from the header.
- **Ring:** a 3D globe (react-force-graph-3d, lazy-loaded) with every account pulled onto one sphere.
  - Clicking a dot lights its money journey (up to 4 hops each way, in time order) and flies the camera there.
  - The journey panel lists where the money came from and went, each with "Go here", plus a breadcrumb.
  - A **Columns** toggle keeps the strict Victim | L1 | L2 | L3 view.
  - Both views share layer filters, the time slider, ZIP export and a PNG snapshot.
- **Resizable workspace:** Investigate, Ring and Flagged use draggable dividers (keyboard-operable, double-click
  resets), remembered per browser. Every panel can be maximized (Esc restores).
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

## Measured, round 1 (full 2M-row file, 1366×768, headless Edge)
| Measure | Result |
|---|---|
| Trace screen ready | about 0.33 s |
| Trace slider | 7 ms per step |
| Ring (1,373 accounts) ready | about 1.0 s |
| Ring slider | 31.5 ms median (Cytoscape redraw of 2,954 edges dominates) |
| `/api/overview` | 122 ms first call, then cached |
| Design detector (`impeccable detect`) | 0 findings after the fix |

## Measured, round 2 (full 2M-row file, headless Edge)
| Measure | Result |
|---|---|
| Trace screen ready (Official) | 427-444 ms |
| Ring globe, 1,373 accounts and 2,954 links | 63-74 fps (headless, software rendering) |
| Ring Columns slider | 33 ms per step |
| Upload 50,000-row `data/sample.csv`, to analysed | 3.3 s (0.5 s upload, 1.9 s stages) |
| Design detector (`impeccable detect`) | 0 findings |
