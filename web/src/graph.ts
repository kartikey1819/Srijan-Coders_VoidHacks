import type cytoscape from 'cytoscape'
import { ROLE_COLOR } from './format'

const COLUMN = { VICTIM: 0, L1: 1, L2: 2, L3: 3, UNKNOWN: 4 } as const

/** Layered preset layout: one column per role (Victim | L1 | L2 | L3), rows in arrival order.
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
  // a column that wraps into k sub-columns pushes the next columns right
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

export const baseStyle: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      'background-color': (n: cytoscape.NodeSingular) => ROLE_COLOR[n.data('role')] ?? '#64748b',
      label: 'data(label)', 'font-size': 10, color: '#0f172a', 'text-valign': 'bottom', 'text-margin-y': 4,
      'text-wrap': 'wrap', 'text-max-width': '140px', width: 'data(size)', height: 'data(size)',
      'border-width': (n: cytoscape.NodeSingular) => (n.data('band') === 'HIGH' ? 3 : 1),
      'border-color': (n: cytoscape.NodeSingular) => (n.data('band') === 'HIGH' ? '#111827' : '#cbd5e1'),
      'min-zoomed-font-size': 7,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'data(width)', 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8', 'target-arrow-shape': 'triangle',
      'curve-style': 'bezier', 'arrow-scale': 0.8, label: 'data(label)', 'font-size': 8, color: '#334155',
      'text-background-color': '#ffffff', 'text-background-opacity': 0.85, 'text-background-padding': '1px',
      'min-zoomed-font-size': 8,
    },
  },
  { selector: 'edge.late', style: { 'line-style': 'dashed' } },
  { selector: 'edge.cashout', style: { 'line-color': '#dc2626', 'target-arrow-color': '#dc2626' } },
  { selector: '.future', style: { display: 'none' } },
  { selector: 'node.sel', style: { 'border-width': 5, 'border-color': '#facc15' } },
  { selector: 'node.dim, edge.dim', style: { opacity: 0.18 } },
]
