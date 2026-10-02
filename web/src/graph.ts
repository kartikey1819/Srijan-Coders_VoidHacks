import type cytoscape from 'cytoscape'
import { cssVar } from './look'

const COLUMN = { VICTIM: 0, L1: 1, L2: 2, L3: 3, UNKNOWN: 4 } as const

/** Layered preset layout: one column per role (Victim | L1 | L2 | L3), rows in a given order.
 *  Long columns wrap into sub-columns so a 1,400-node ring stays readable. */
export function layeredPositions(
  items: { id: string; role: keyof typeof COLUMN; order: string }[],
  opts: { colGap?: number; rowGap?: number; maxRows?: number; subGap?: number } = {},
): Record<string, { x: number; y: number }> {
  const { colGap = 340, rowGap = 64, maxRows = 40, subGap = 150 } = opts
  const byCol = new Map<number, typeof items>()
  for (const it of items) {
    const c = COLUMN[it.role] ?? 4
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(it)
  }
  const out: Record<string, { x: number; y: number }> = {}
  let x = 0
  for (const c of [...byCol.keys()].sort((a, b) => a - b)) {
    const col = byCol.get(c)!.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id.localeCompare(b.id)))
    const sub = Math.ceil(col.length / maxRows)
    const rows = Math.min(col.length, maxRows)
    col.forEach((it, i) => {
      const s = Math.floor(i / maxRows)
      const r = i % maxRows
      out[it.id] = { x: x + s * subGap, y: (r - (rows - 1) / 2) * rowGap }
    })
    x += (sub - 1) * subGap + colGap
  }
  return out
}

export function roleColors(): Record<string, string> {
  return { VICTIM: cssVar('--victim'), L1: cssVar('--l1'), L2: cssVar('--l2'), L3: cssVar('--l3'), UNKNOWN: '#8d97a3' }
}

/** Styles read the current look's tokens, so call again after a look change.
 *  Identity is never colour alone: the victim is a square, columns carry the layer, labels carry the account. */
export function graphStyle(opts: { animate: boolean }): cytoscape.StylesheetStyle[] {
  const c = roleColors()
  const ink = cssVar('--ink'), edge = cssVar('--edge'), held = cssVar('--held'), focus = cssVar('--focus')
  const font = cssVar('--font') || 'sans-serif'
  const fade = opts.animate ? { 'transition-property': 'opacity', 'transition-duration': 260 } : {}
  return [
    {
      selector: 'node',
      style: {
        'background-color': (n: cytoscape.NodeSingular) => c[n.data('role')] ?? c.UNKNOWN,
        label: 'data(label)', 'font-family': font, 'font-size': 17, color: ink, 'text-valign': 'bottom', 'text-margin-y': 5,
        'text-wrap': 'wrap', 'text-max-width': '170px', width: 'data(size)', height: 'data(size)',
        'border-width': 2, 'border-color': '#ffffff', 'min-zoomed-font-size': 6,
        'text-background-color': '#ffffff', 'text-background-opacity': 0.8, 'text-background-padding': '2px',
        ...fade,
      },
    },
    { selector: 'node[role = "VICTIM"]', style: { shape: 'round-rectangle', 'font-weight': 700 } },
    {
      selector: 'edge',
      style: {
        width: 'data(width)', 'line-color': edge, 'target-arrow-color': edge, 'target-arrow-shape': 'triangle',
        'curve-style': 'bezier', 'arrow-scale': 0.9, label: 'data(label)', 'font-family': font, 'font-size': 15, color: ink,
        'text-background-color': '#ffffff', 'text-background-opacity': 0.9, 'text-background-padding': '2px',
        'min-zoomed-font-size': 7, ...fade,
      },
    },
    { selector: 'edge.late', style: { 'line-style': 'dashed' } },
    { selector: 'edge.cashout', style: { 'line-color': c.L3, 'target-arrow-color': c.L3 } },
    { selector: 'node.holds', style: { 'border-color': held, 'border-width': 3 } },
    { selector: 'node.sel', style: { 'border-width': 4, 'border-color': focus, 'overlay-opacity': 0 } },
    { selector: '.dim', style: { opacity: 0.16 } },
    { selector: '.future', style: { opacity: 0, events: 'no' } },   // last: not-yet-happened wins over dim
  ]
}
