import { useMemo, useState } from 'react'
import { useWidth } from '../../charts'
import { inr, toEpoch } from '../../format'
import type { TraceResult } from '../../types'
import { after } from './model'

const BW = 196, BH = 50, ROW = 60, TOP = 52, PAD = 16, MAX_KIDS = 6
const HEAD: Record<string, string> = {
  VICTIM: 'Victim', L1: 'Layer 1 · Collector', L2: 'Layer 2 · Distributors', L3: 'Layer 3 · Cash-out',
}
const roleVar = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()})` : r === 'VICTIM' ? 'var(--victim)' : 'var(--unknown)')
const roleBg = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()}-bg)` : r === 'VICTIM' ? 'var(--victim-bg)' : 'var(--unknown-bg)')

interface Box { id: string; role: string; x: number; y: number; title: string; sub: string; at: number; more?: { parent: string; n: number } }
interface Line { key: string; from: string; to: string; t: number; slow: boolean; role: string; label: string | null }

/**
 * The victim's money as a tidy left-to-right tree: every account sits under the account that first paid it, leaves get
 * one row each and parents are centred on their children. Columns are steps away from the victim (Layer 1, 2, 3).
 * `cursor` (epoch s) shows only what had happened by then: later boxes and lines are faded, so playback builds the tree.
 */
export function TrailTree({ trace, cursor, onSelect }: { trace: TraceResult; cursor: number; onSelect: (a: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [ref, width] = useWidth<HTMLDivElement>()
  const W = Math.max(960, width)
  const L = useMemo(() => layout(trace, open, W), [trace, open, W])
  const hl = useMemo(() => (hover ? lineage(hover, L.lines) : null), [hover, L])

  return (
    <div className="tree-wrap" ref={ref}>
      {width > 0 && (
      <div className="tree-canvas" style={{ width: W, height: L.height }}>
        <svg className={`tree${hl ? ' dim' : ''}`} width={W} height={L.height} role="img"
             data-visible-edges={L.lines.filter((e) => !e.to.startsWith('more:') && e.t <= cursor).length}
             aria-label={`Money trail: ${L.boxes.length - 1} accounts after the victim. Click a box to open the account.`}>
          <defs>
            {['VICTIM', 'L1', 'L2', 'L3', 'UNKNOWN'].map((k) => (
              <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" style={{ fill: roleVar(k) }} />
              </marker>
            ))}
          </defs>
          {L.cols.map((c) => (
            <text key={c.hop} x={c.x + BW / 2} y={24} textAnchor="middle" className="tree-head" style={{ fill: roleVar(c.role) }}>
              {HEAD[c.role] ?? `Step ${c.hop}`}
            </text>
          ))}
          {L.lines.map((e) => {
            const a = L.pos.get(e.from), b = L.pos.get(e.to)
            if (!a || !b) return null
            const x1 = a.x + BW, y1 = a.y + BH / 2, x2 = b.x - 4, y2 = b.y + BH / 2, mx = (x1 + x2) / 2
            const on = hl?.lines.has(e.key)
            return (
              <g key={e.key} className={`tline${e.t > cursor ? ' later' : ''}${on ? ' hl' : ''}`}>
                <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} strokeDasharray={e.slow ? '6 5' : undefined}
                      style={{ stroke: roleVar(e.role) }} markerEnd={`url(#ah-${e.role})`} />
                {e.label && <text x={(x1 + x2) / 2} y={y1 - 8} textAnchor="middle" className="tree-time">{e.label}</text>}
              </g>
            )
          })}
          {L.boxes.map((n) => {
            const on = hl?.boxes.has(n.id)
            const later = n.at > cursor
            const act = () => (n.more ? setOpen((s) => new Set(s).add(n.more!.parent)) : onSelect(n.id))
            return (
              <g key={n.id} className={`tbox${later ? ' later' : ''}${on ? ' hl' : ''}${n.more ? ' more' : ''}`}
                 transform={`translate(${n.x},${n.y})`} role="button" tabIndex={0} data-acct={n.more ? undefined : n.id} data-role={n.role}
                 aria-label={n.more ? `Show ${n.more.n} more accounts` : `${n.title}: ${n.sub}. Open account`}
                 onMouseEnter={() => !n.more && setHover(n.id)} onMouseLeave={() => setHover(null)}
                 onFocus={() => !n.more && setHover(n.id)} onBlur={() => setHover(null)}
                 onClick={act} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act() } }}>
                <rect width={BW} height={BH} rx={8} style={{ fill: roleBg(n.role), stroke: roleVar(n.role) }} />
                <text x={BW / 2} y={21} textAnchor="middle" className={n.more ? 'tb-more' : 'tb-acct'}>{n.title}</text>
                <text x={BW / 2} y={39} textAnchor="middle" className="tb-sub">{n.sub}</text>
              </g>
            )
          })}
        </svg>
        {hover && <AccountTip trace={trace} id={hover} box={L.pos.get(hover)} width={W} />}
      </div>
      )}
    </div>
  )
}

/** On hover: what the account received from this victim, what it passed on, and what it still holds. */
function AccountTip({ trace, id, box, width }: { trace: TraceResult; id: string; box?: { x: number; y: number }; width: number }) {
  const n = trace.nodes.find((x) => x.account === id)
  if (!n || !box) return null
  const left = box.x + BW + 12 + 250 > width ? box.x - 262 : box.x + BW + 12
  if (n.role === 'VICTIM') return (
    <div className="ttip" style={{ left, top: box.y }} role="tooltip">
      <b className="mono">{n.account}</b><span className="muted">{n.bank_name} · victim</span>
      <dl><dt>Paid out (the loss)</dt><dd>{inr(trace.loss_paise)}</dd></dl>
    </div>
  )
  const passed = n.sent_paise, kept = n.held_paise
  return (
    <div className="ttip" style={{ left, top: box.y }} role="tooltip">
      <b className="mono">{n.account}</b><span className="muted">{n.bank_name}</span>
      <dl>
        <dt>Received from this victim</dt><dd>{inr(n.received_paise)}</dd>
        <dt>Passed on</dt><dd>{inr(passed)}</dd>
        <dt>Still holds</dt><dd className={kept > 0 ? 'ok' : ''}>{inr(kept)}</dd>
      </dl>
      {n.received_paise > 0 && <span className="tt-bar"><i style={{ width: `${(100 * kept) / n.received_paise}%` }} /></span>}
    </div>
  )
}

function layout(t: TraceResult, open: Set<string>, W: number) {
  const node = new Map(t.nodes.map((n) => [n.account, n]))
  const victim = t.nodes.find((n) => n.role === 'VICTIM')?.account ?? t.victim
  const hop = (a: string) => (a === victim ? 0 : node.get(a)?.hop ?? 1)
  const seedT = t.edges.filter((e) => e.rule === 'seed').map((e) => toEpoch(e.ts))
  const t0 = seedT.length ? Math.min(...seedT) : Math.min(...t.edges.map((e) => toEpoch(e.ts)))
  // primary parent: the earliest payer from the shallowest step; children ordered by when money first arrived
  const inbound = new Map<string, typeof t.edges>()
  for (const e of t.edges) (inbound.get(e.dst) ?? inbound.set(e.dst, []).get(e.dst)!).push(e)
  const parent = new Map<string, string>(), firstIn = new Map<string, number>()
  for (const [id, list] of inbound) {
    list.sort((a, b) => hop(a.src) - hop(b.src) || toEpoch(a.ts) - toEpoch(b.ts))
    if (list[0].src !== id) parent.set(id, list[0].src)
    firstIn.set(id, Math.min(...list.map((e) => toEpoch(e.ts))))
  }
  const kids = new Map<string, string[]>()
  for (const n of t.nodes) { const p = parent.get(n.account); if (p) (kids.get(p) ?? kids.set(p, []).get(p)!).push(n.account) }
  for (const v of kids.values()) v.sort((a, b) => (firstIn.get(a) ?? 0) - (firstIn.get(b) ?? 0))
  const outN = new Map<string, number>()
  for (const e of t.edges) outN.set(e.src, (outN.get(e.src) ?? 0) + 1)

  const maxHop = Math.max(1, ...t.nodes.map((n) => hop(n.account)))
  const colX = (h: number) => PAD + (h * (W - 2 * PAD - BW)) / maxHop
  const boxes: Box[] = [], pos = new Map<string, { x: number; y: number }>()
  const shown = new Set<string>()
  let row = 0
  const box = (id: string, y: number) => {
    const n = node.get(id)
    const role = id === victim ? 'VICTIM' : n?.role ?? 'UNKNOWN'
    const at = id === victim ? t0 : firstIn.get(id) ?? t0
    const ways = outN.get(id) ?? 0
    const sub = id === victim ? `pays ${inr(t.loss_paise)}`
      : role === 'L1' && ways > 1 ? `${inr(n?.received_paise ?? 0)} · splits it ${ways} ways`
      : `${inr(n?.received_paise ?? 0)} · ${after(at - t0)}`
    const p = { x: colX(hop(id)), y }
    pos.set(id, p); shown.add(id)
    boxes.push({ id, role, ...p, title: id, sub, at })
  }
  const place = (id: string): number => {
    const all = kids.get(id) ?? []
    const ch = all.length > MAX_KIDS && !open.has(id) ? all.slice(0, MAX_KIDS - 1) : all
    let y: number
    if (!ch.length) { y = TOP + row * ROW; row++ } else {
      const ys = ch.map(place)
      if (ch.length < all.length) {                       // fold the rest into one "+N more" box
        const my = TOP + row * ROW; row++
        const rest = all.length - ch.length
        boxes.push({ id: `more:${id}`, role: node.get(all[ch.length])?.role ?? 'UNKNOWN', x: colX(hop(all[ch.length])), y: my,
                     title: `+${rest} more`, sub: 'click to show them', at: Math.min(...all.slice(ch.length).map((a) => firstIn.get(a) ?? t0)),
                     more: { parent: id, n: rest } })
        ys.push(my)
      }
      y = (ys[0] + ys[ys.length - 1]) / 2
    }
    box(id, y)
    return y
  }
  place(victim)
  // accounts whose only payer was folded away stay hidden; anything not reached by the tree gets its own row
  const hiddenUnder = (a: string): boolean => { let p = parent.get(a); while (p) { if (!shown.has(p)) return true; p = parent.get(p) } return false }
  for (const n of t.nodes) if (!shown.has(n.account) && !hiddenUnder(n.account) && !parent.has(n.account)) { box(n.account, TOP + row * ROW); row++ }

  const lines: Line[] = []
  t.edges.forEach((e, i) => {
    if (!pos.has(e.src) || !pos.has(e.dst)) return
    const dr = e.dst === victim ? 'VICTIM' : node.get(e.dst)?.role ?? 'UNKNOWN'
    const et = toEpoch(e.ts)
    lines.push({ key: `${e.src}>${e.dst}#${i}`, from: e.src, to: e.dst, t: et, slow: et - t0 > 3600, role: dr,
                 label: null })
  })
  for (const b of boxes) if (b.more) {                  // a line into each "+N more" box from its parent
    lines.push({ key: `${b.more.parent}>${b.id}`, from: b.more.parent, to: b.id, t: b.at, slow: b.at - t0 > 3600, role: b.role, label: null })
    pos.set(b.id, { x: b.x, y: b.y })
  }
  const cols = Array.from({ length: maxHop + 1 }, (_, h) => {
    const c: Record<string, number> = {}
    for (const b of boxes) if (Math.abs(b.x - colX(h)) < 1 && !b.more) c[b.role] = (c[b.role] ?? 0) + 1
    const role = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNKNOWN'
    return { hop: h, x: colX(h), role }
  })
  return { boxes, lines, pos, cols, height: TOP + row * ROW + 4 }
}

function lineage(id: string, lines: Line[]) {
  const boxes = new Set([id]), hl = new Set<string>()
  const up = [id], down = [id]
  while (up.length) {
    const x = up.pop()!
    for (const e of lines) if (e.to === x) { hl.add(e.key); if (!boxes.has(e.from)) { boxes.add(e.from); up.push(e.from) } }
  }
  while (down.length) {
    const x = down.pop()!
    for (const e of lines) if (e.from === x) { hl.add(e.key); if (!boxes.has(e.to)) { boxes.add(e.to); down.push(e.to) } }
  }
  return { boxes, lines: hl }
}
