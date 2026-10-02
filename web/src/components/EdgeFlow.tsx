import { ArrowLeft } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useWidth } from '../useWidth'
import { inr, inrShort, ROLE_TEXT, spanText, toEpoch } from '../format'
import { prefersReducedMotion } from '../look'
import type { ringIndex } from '../ringJourney'
import type { GraphEdge, TxnRow } from '../types'

interface Props {
  edge: GraphEdge
  ix: ReturnType<typeof ringIndex>
  onBack: () => void
  onGo: (a: string) => void
}

type Ix = ReturnType<typeof ringIndex>
interface Party { acct: string; role: string; amount: number; n: number }

const roleVar = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()})` : r === 'VICTIM' ? 'var(--victim)' : 'var(--unknown)')

/** Up to `k` biggest parties, the rest folded into one "others" entry (so the diagram never overflows). */
function top(list: GraphEdge[], side: 'src' | 'dst', ix: Ix, k: number): Party[] {
  const s = list.slice().sort((a, b) => b.total_paise - a.total_paise)
  const out: Party[] = s.slice(0, k).map((e) => ({ acct: e[side], role: ix.role.get(e[side])?.role ?? 'UNKNOWN', amount: e.total_paise, n: e.n_txn }))
  const rest = s.slice(k)
  if (rest.length) out.push({ acct: `${rest.length} more`, role: 'UNKNOWN', amount: rest.reduce((a, e) => a + e.total_paise, 0), n: rest.reduce((a, e) => a + e.n_txn, 0) })
  return out
}

/** Everything behind one link of the ring, drawn as a flow (money into the sender, this transfer, money out of the
 *  receiver; band width = amount), then the totals, every transaction row and the neighbours. Fits any panel width:
 *  wide panels flow left to right, narrow ones top to bottom. */
export function EdgeFlow({ edge, ix, onBack, onGo }: Props) {
  const [rows, setRows] = useState<TxnRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ref, w] = useWidth<HTMLDivElement>()
  const [edgeWas, setEdgeWas] = useState(edge)
  if (edge !== edgeWas) { setEdgeWas(edge); setRows(null); setErr(null) }   // another link: drop the old rows while it loads
  useEffect(() => {
    let live = true
    api.byIndex(edge.txn_idxs).then((r) => live && setRows(r)).catch((e) => live && setErr(String((e as Error).message)))
    return () => { live = false }
  }, [edge])
  const s = ix.role.get(edge.src), d = ix.role.get(edge.dst)
  const before = top(ix.inn.get(edge.src) ?? [], 'src', ix, 4)
  const after = top(ix.out.get(edge.dst) ?? [], 'dst', ix, 4)
  const span = toEpoch(edge.last_ts) - toEpoch(edge.first_ts)
  const wide = w >= 520
  return (
    <div className="edge-flow" ref={ref}>
      <button className="btn ghost sm" onClick={onBack}><ArrowLeft /> Back to the journey</button>
      <p className="small muted" style={{ margin: '10px 0 6px' }}>Money into the sender, this transfer, and money out of the receiver.
        Band width shows the amount; click an account to follow it.</p>
      {w > 0 && <FlowDiagram w={w} wide={wide} edge={edge} src={{ acct: edge.src, role: s?.role ?? 'UNKNOWN' }} dst={{ acct: edge.dst, role: d?.role ?? 'UNKNOWN' }}
                             before={before} after={after} onGo={onGo} />}
      <div className="ef-stats">
        <div><b>{inr(edge.total_paise)}</b><span>moved {edge.src} → {edge.dst}</span></div>
        <div><b>{edge.n_txn}</b><span>transfer{edge.n_txn === 1 ? '' : 's'}</span></div>
        <div><b>{span > 0 ? spanText(span) : 'one time'}</b><span>{edge.first_ts.slice(5, 16)}{span > 0 ? ` to ${edge.last_ts.slice(5, 16)}` : ''}</span></div>
        <div><b>{ROLE_TEXT[s?.role ?? 'UNKNOWN']?.split(' ')[0]} → {ROLE_TEXT[d?.role ?? 'UNKNOWN']?.split(' ')[0]}</b><span>{s?.bank_prefix} → {d?.bank_prefix}</span></div>
      </div>
      <h3>Transactions on this link</h3>
      {err && <p className="error">{err}</p>}
      {!rows && !err && <p className="muted small">Loading the rows from the file…</p>}
      {rows && (
        <div className="ef-table">
          <table className="tbl small">
            <thead><tr><th>Time</th><th>Transaction</th><th className="num">Amount</th></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.txn_idx} title={`row ${t.txn_idx} in the file`}>
                <td className="mono nw">{t.ts.slice(5)}</td>
                <td><span className="mono">{t.transaction_id}</span> · {t.mode}<div className="narr">{t.narration}</div>
                  <div className="narr">{t.device} · {t.ip} ({t.ip_class.replace('_', ' ')})</div></td>
                <td className="num">{inr(t.amount_paise)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FlowDiagram({ w, wide, edge, src, dst, before, after, onGo }: {
  w: number; wide: boolean; edge: GraphEdge; src: { acct: string; role: string }; dst: { acct: string; role: string }
  before: Party[]; after: Party[]; onGo: (a: string) => void
}) {
  const max = Math.max(edge.total_paise, ...before.map((p) => p.amount), ...after.map((p) => p.amount), 1)
  const band = (a: number) => 2 + 14 * Math.sqrt(a / max)
  const reduced = prefersReducedMotion()
  const node = (x: number, y: number, p: { acct: string; role: string }, big: boolean, anchorIn: 'start' | 'middle' | 'end' | 'above', sub?: string) => {
    const above = anchorIn === 'above', anchor = above ? 'middle' : anchorIn
    const real = !p.acct.endsWith('more')
    return (
      <g className={real ? 'ef-node' : ''} onClick={real ? () => onGo(p.acct) : undefined} role={real ? 'button' : undefined}
         tabIndex={real ? 0 : undefined} aria-label={real ? `Follow ${p.acct}` : undefined}
         onKeyDown={real ? (e) => { if (e.key === 'Enter') onGo(p.acct) } : undefined}>
        <circle cx={x} cy={y} r={big ? 9 : 6} fill={roleVar(p.role)} stroke="var(--sheet)" strokeWidth={2} />
        <text x={anchor === 'start' ? x + 14 : anchor === 'end' ? x - 14 : x} y={above ? y - 12 : anchor === 'middle' ? y + (big ? 26 : 20) : y + 4}
              textAnchor={anchor} className={big ? 'ef-big' : 'ef-small'}>{p.acct}</text>
        {sub && <text x={anchor === 'start' ? x + 14 : anchor === 'end' ? x - 14 : x} y={anchor === 'middle' ? y + (big ? 40 : 33) : y + 17}
                      textAnchor={anchor} className="ef-sub">{sub}</text>}
      </g>
    )
  }
  if (wide) {
    const rows = Math.max(before.length, after.length, 1)
    const h = Math.max(150, rows * 38 + 30)
    const cx1 = w * 0.38, cx2 = w * 0.62, cy = h / 2, lx = 10, rx = w - 10
    const yAt = (i: number, n: number) => (n <= 1 ? cy : 22 + (i * (h - 44)) / (n - 1))
    return (
      <svg className="ef-svg" width={w} height={h} role="img" aria-label={`Flow: ${before.length} senders into ${src.acct}, ${inrShort(edge.total_paise)} to ${dst.acct}, ${after.length} receivers after`}>
        {before.map((p, i) => { const y = yAt(i, before.length)
          return <path key={`b${i}`} className={reduced ? '' : 'ef-flow'} d={`M${lx + 6},${y} C${cx1 - 120},${y} ${cx1 - 80},${cy} ${cx1},${cy}`}
                       stroke={roleVar(p.role)} strokeWidth={band(p.amount)} fill="none" strokeOpacity={0.55} /> })}
        <path className={reduced ? '' : 'ef-flow ef-main'} d={`M${cx1},${cy} L${cx2},${cy}`} stroke="var(--ink)" strokeWidth={band(edge.total_paise)} fill="none" />
        {after.map((p, i) => { const y = yAt(i, after.length)
          return <path key={`a${i}`} className={reduced ? '' : 'ef-flow'} d={`M${cx2},${cy} C${cx2 + 80},${cy} ${cx2 + 120},${y} ${rx - 6},${y}`}
                       stroke={roleVar(p.role)} strokeWidth={band(p.amount)} fill="none" strokeOpacity={0.55} /> })}
        <text x={(cx1 + cx2) / 2} y={cy - band(edge.total_paise) / 2 - 8} textAnchor="middle" className="ef-amt">{inrShort(edge.total_paise)} · {edge.n_txn}×</text>
        {before.map((p, i) => <g key={`bn${i}`}>{node(lx, yAt(i, before.length), p, false, 'start', inrShort(p.amount))}</g>)}
        {after.map((p, i) => <g key={`an${i}`}>{node(rx, yAt(i, after.length), p, false, 'end', inrShort(p.amount))}</g>)}
        {node(cx1, cy, src, true, 'middle', ROLE_TEXT[src.role])}
        {node(cx2, cy, dst, true, 'middle', ROLE_TEXT[dst.role])}
        {before.length === 0 && <text x={lx} y={cy + 4} className="ef-sub">money enters the ring here</text>}
        {after.length === 0 && <text x={rx} y={cy + 4} textAnchor="end" className="ef-sub">money stops here</text>}
      </svg>
    )
  }
  // narrow: top to bottom
  const cx = w / 2, colGap = Math.min(110, (w - 40) / Math.max(before.length, after.length, 1))
  const xAt = (i: number, n: number) => cx + (i - (n - 1) / 2) * colGap
  const y0 = 30, y1 = 106, y2 = 186, y3 = 264, h = 306
  return (
    <svg className="ef-svg" width={w} height={h} role="img" aria-label={`Flow from ${src.acct} to ${dst.acct}`}>
      {before.map((p, i) => <path key={`b${i}`} className={reduced ? '' : 'ef-flow'} d={`M${xAt(i, before.length)},${y0 + 6} C${xAt(i, before.length)},${y1 - 40} ${cx},${y1 - 40} ${cx},${y1}`}
                                  stroke={roleVar(p.role)} strokeWidth={band(p.amount)} fill="none" strokeOpacity={0.55} />)}
      <path className={reduced ? '' : 'ef-flow ef-main'} d={`M${cx},${y1} L${cx},${y2}`} stroke="var(--ink)" strokeWidth={band(edge.total_paise)} fill="none" />
      {after.map((p, i) => <path key={`a${i}`} className={reduced ? '' : 'ef-flow'} d={`M${cx},${y2} C${cx},${y2 + 40} ${xAt(i, after.length)},${y3 - 40} ${xAt(i, after.length)},${y3 - 6}`}
                                 stroke={roleVar(p.role)} strokeWidth={band(p.amount)} fill="none" strokeOpacity={0.55} />)}
      <text x={cx + band(edge.total_paise) / 2 + 8} y={(y1 + y2) / 2 + 4} className="ef-amt">{inrShort(edge.total_paise)} · {edge.n_txn}×</text>
      {before.map((p, i) => <g key={`bn${i}`}>{node(xAt(i, before.length), y0, p, false, 'above')}</g>)}
      {node(cx, y1, src, true, 'start')}
      {node(cx, y2, dst, true, 'start')}
      {after.map((p, i) => <g key={`an${i}`}>{node(xAt(i, after.length), y3, p, false, 'middle')}</g>)}
    </svg>
  )
}
