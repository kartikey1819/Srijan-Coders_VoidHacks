import cytoscape from 'cytoscape'
import { useEffect, useRef } from 'react'
import { inrShort, toEpoch } from '../format'
import { graphStyle, layeredPositions } from '../graph'
import { prefersReducedMotion, useLookTick } from '../look'
import type { TraceResult } from '../types'

interface Props {
  trace: TraceResult
  cutoff: number          // epoch seconds; transfers after it are hidden (time-lapse)
  selected: string | null
  onSelect: (account: string | null) => void
  look: string
}

/** The trail as evidence: Victim | L1 | L2 | L3 columns, edge width = victim money, labels readable at fit. */
export function TraceGraph({ trace, cutoff, selected, onSelect, look }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<cytoscape.Core | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect
  const tick = useLookTick()

  useEffect(() => {
    const c = cytoscape({ container: box.current, minZoom: 0.2, maxZoom: 3, boxSelectionEnabled: false })
    c.on('tap', 'node', (e) => select.current(e.target.id()))
    c.on('tap', (e) => { if (e.target === c) select.current(null) })
    cy.current = c
    return () => c.destroy()
  }, [])

  useEffect(() => {
    cy.current?.style(graphStyle({ animate: look === 'briefing' && !prefersReducedMotion() }))
  }, [look, tick])

  useEffect(() => {
    const c = cy.current!
    // order each column by where its money came from (barycentre of senders), so lines cross less
    const preds = new Map<string, string[]>()
    for (const e of trace.edges) preds.set(e.dst, [...(preds.get(e.dst) ?? []), e.src])
    const rank = new Map<string, number>()
    const order = new Map<string, string>()
    for (const role of ['VICTIM', 'L1', 'L2', 'L3'] as const) {
      const key = (a: string) => {
        const ps = (preds.get(a) ?? []).filter((p) => rank.has(p))
        return ps.length ? ps.reduce((s, p) => s + rank.get(p)!, 0) / ps.length : 2
      }
      const col = trace.nodes.filter((n) => n.role === role)
        .sort((a, b) => key(a.account) - key(b.account) || (a.first_in_ts ?? '').localeCompare(b.first_in_ts ?? ''))
      col.forEach((n, i) => {
        rank.set(n.account, col.length > 1 ? i / (col.length - 1) : 0.5)
        order.set(n.account, String(i).padStart(6, '0'))
      })
    }
    const pos = layeredPositions(trace.nodes.map((n) => ({ id: n.account, role: n.role, order: order.get(n.account) ?? '' })),
      { colGap: 250, rowGap: 62 })
    const agg = new Map<string, { src: string; dst: string; att: number; t: number; late: boolean; cash: boolean; n: number }>()
    for (const e of trace.edges) {
      const k = `${e.src}>${e.dst}`
      const a = agg.get(k) ?? { src: e.src, dst: e.dst, att: 0, t: Infinity, late: false, cash: false, n: 0 }
      a.att += e.attributed_paise; a.t = Math.min(a.t, toEpoch(e.ts)); a.n += 1
      a.late ||= (e.delay_s ?? 0) > 900; a.cash ||= e.terminal
      agg.set(k, a)
    }
    const maxAtt = Math.max(1, ...[...agg.values()].map((a) => a.att))
    const els: cytoscape.ElementDefinition[] = [
      ...trace.nodes.map((n) => ({
        group: 'nodes' as const,
        data: {
          id: n.account, role: n.role,
          first: n.first_in_ts ? toEpoch(n.first_in_ts) : 0,
          label: n.role === 'VICTIM' ? `${n.account}\nvictim` : `${n.account}${n.held_paise > 0 ? `\nholds ${inrShort(n.held_paise)}` : ''}`,
          size: 20 + 4 * Math.log10(1 + (n.role === 'VICTIM' ? trace.loss_paise : n.received_paise) / 100),
        },
        classes: n.role !== 'VICTIM' && n.held_paise > 0 ? 'holds' : '',
        position: pos[n.account],
      })),
      ...[...agg.values()].map((a) => ({
        group: 'edges' as const,
        data: { id: `${a.src}>${a.dst}`, source: a.src, target: a.dst, t: a.t,
                width: 1.5 + 7 * Math.sqrt(a.att / maxAtt),
                label: `${inrShort(a.att)}${a.n > 1 ? ` (${a.n})` : ''}` },
        classes: [a.late ? 'late' : '', a.cash ? 'cashout' : ''].join(' ').trim(),
      })),
    ]
    c.batch(() => { c.elements().remove(); c.add(els) })
    c.fit(undefined, 36)
  }, [trace])

  useEffect(() => {
    const c = cy.current!
    c.batch(() => {
      c.edges().forEach((e) => { e.toggleClass('future', e.data('t') > cutoff) })
      c.nodes().forEach((n) => { n.toggleClass('future', n.data('role') !== 'VICTIM' && n.data('first') > cutoff) })
    })
    if (box.current) box.current.dataset.visibleEdges = String(c.edges().filter((e) => !e.hasClass('future')).length)
  }, [cutoff, trace])

  useEffect(() => {
    const c = cy.current!
    c.batch(() => {
      c.elements().removeClass('sel dim')
      if (!selected) return
      const n = c.getElementById(selected)
      if (n.empty()) return
      n.addClass('sel')
      c.elements().not(n.closedNeighborhood()).addClass('dim')
    })
  }, [selected, trace])

  return <div className="graph" ref={box} role="img"
              aria-label={`Money trail graph: ${trace.nodes.length} accounts, ${trace.edges.length} transfers. The same accounts are listed in the register.`} />
}
