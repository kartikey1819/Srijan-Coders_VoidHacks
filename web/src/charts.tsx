import { scaleBand, scaleLinear } from 'd3-scale'
import { arc, area, curveStepAfter, line, pie } from 'd3-shape'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { inr, inrShort, tPlus } from './format'
import { heldAt, LAYERS, type Trail } from './trail'

/** Width of an element, tracked (charts redraw to their container). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

interface TipState { x: number; y: number; body: ReactNode }

export function Chart({ title, sub, source, children, tip }: {
  title: ReactNode; sub?: ReactNode; source?: string; children: ReactNode; tip?: TipState | null
}) {
  return (
    <figure className="chart" style={{ margin: 0, position: 'relative' }}>
      <figcaption><h3>{title}</h3>{sub && <div className="sub">{sub}</div>}</figcaption>
      {children}
      {source && <div className="src">Source: {source}</div>}
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.body}</div>}
    </figure>
  )
}

const BANDS = [
  { key: 'LOW', label: 'Low (0-39)', from: 0, to: 39, fill: 'var(--bar-off)' },
  { key: 'MEDIUM', label: 'Medium (40-69)', from: 40, to: 69, fill: 'var(--muted)' },
  { key: 'HIGH', label: 'Flagged (70-100)', from: 70, to: 100, fill: 'var(--held)' },
] as const

/** Mule Risk Index spread, in two readings of the same 20 five-point buckets:
 *  a band strip (how the whole file splits) and a zoomed histogram of the decision zone (where the cut-off sits and
 *  how empty the space below it is). Emphasis: flagged in the reserved colour, everything else grey. */
export function ScoreSpread({ hist, bands, threshold = 70, onPick }: {
  hist: number[]; bands: Record<string, number>; threshold?: number; onPick?: () => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const [all, setAll] = useState(false)
  const total = hist.reduce((a, b) => a + b, 0) || 1
  const flagged = bands.HIGH ?? hist.slice(threshold / 5).reduce((a, b) => a + b, 0)
  const lo = all ? 0 : 8                                   // decision zone starts at 40
  const shown = hist.slice(lo).map((n, k) => ({ i: k + lo, n }))
  // the empty run just below the threshold, computed from the data
  let gapFrom = threshold / 5
  while (gapFrom > lo && hist[gapFrom - 1] === 0) gapFrom--
  const gap = gapFrom < threshold / 5 ? [gapFrom * 5, threshold - 1] : null
  const h = 200, m = { t: 22, r: 8, b: 26, l: 46 }
  const x = scaleBand<number>().domain(shown.map((d) => d.i)).range([m.l, Math.max(m.l + 1, w - m.r)]).paddingInner(0.18)
  const y = scaleLinear().domain([0, Math.max(1, ...shown.map((d) => d.n))]).nice().range([h - m.b, m.t])
  const bw = Math.min(24, x.bandwidth())
  const lab = (i: number) => `${i * 5}-${i === 19 ? 100 : i * 5 + 4}`
  const show = (i: number, n: number, px: number, py: number) => setTip({ x: Math.min(px, w - 170), y: Math.max(0, py),
    body: <><b>{n.toLocaleString('en-IN')}</b> account{n === 1 ? '' : 's'}<br />score {lab(i)}{i * 5 >= threshold ? ', flagged' : ''}</> })
  return (
    <Chart title={<>{flagged.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} accounts are flagged
             <span className="muted" style={{ fontWeight: 400 }}> ({((100 * flagged) / total).toFixed(1)}%)</span></>}
           sub="Mule Risk Index, 0-100. Accounts at 70 or more are flagged." source="risk table (all accounts)" tip={tip}>
      <div ref={ref}>
        <div className="strip" role="img" aria-label={BANDS.map((b) => `${b.label}: ${bands[b.key] ?? 0}`).join(', ')}>
          {BANDS.map((b) => {
            const n = bands[b.key] ?? 0
            if (!n) return null
            return (
              <div key={b.key} className="band grow-x" tabIndex={0} style={{ flexGrow: n, background: b.fill }}
                   onPointerMove={(e) => setTip({ x: Math.min(e.nativeEvent.offsetX + (e.currentTarget.offsetLeft ?? 0), w - 170), y: 46,
                     body: <><b>{n.toLocaleString('en-IN')}</b> accounts<br />{b.label}, {((100 * n) / total).toFixed(1)}%</> })}
                   onPointerLeave={() => setTip(null)} onFocus={() => setTip({ x: 0, y: 46, body: <><b>{n.toLocaleString('en-IN')}</b> {b.label}</> })}
                   onBlur={() => setTip(null)} onClick={b.key === 'HIGH' ? onPick : undefined}
                   aria-label={`${b.label}: ${n} accounts`} />
            )
          })}
        </div>
        <div className="strip-legend">
          {BANDS.map((b) => (
            <span key={b.key}><i style={{ background: b.fill }} />{b.label} <b>{(bands[b.key] ?? 0).toLocaleString('en-IN')}</b>
              <span className="muted"> {(((bands[b.key] ?? 0) * 100) / total).toFixed(1)}%</span></span>
          ))}
        </div>
        <div className="row between" style={{ margin: '14px 0 2px' }}>
          <span className="small muted">{all ? 'Every account, by score' : 'Zoom on scores 40-100, where the decision is made'}</span>
          <div className="seg" role="group" aria-label="Score range">
            <button aria-pressed={!all} onClick={() => setAll(false)}>40-100</button>
            <button aria-pressed={all} onClick={() => setAll(true)}>All scores</button>
          </div>
        </div>
        {w > 0 && (
          <svg height={h} role="img" aria-label={`Accounts per score band; ${flagged} at ${threshold} or above`}>
            {gap && (x(gap[0] / 5) ?? 0) < (x(threshold / 5) ?? 0) && (
              <g>
                <rect x={x(gap[0] / 5)} y={m.t} width={(x(threshold / 5) ?? 0) - (x(gap[0] / 5) ?? 0) - 4} height={h - m.b - m.t}
                      fill="var(--sheet-2)" />
                <text x={((x(gap[0] / 5) ?? 0) + (x(threshold / 5) ?? 0)) / 2} y={(h - m.b + m.t) / 2} textAnchor="middle" style={{ fill: 'var(--ink-2)' }}>
                  No account scores {gap[0]}-{gap[1]}</text>
              </g>
            )}
            <g className="grid">{y.ticks(4).map((v) => <line key={v} x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} />)}</g>
            {y.ticks(4).map((v) => <text key={v} x={m.l - 6} y={y(v) + 4} textAnchor="end">{v.toLocaleString('en-IN')}</text>)}
            {shown.map(({ i, n }, k) => {
              const on = i * 5 >= threshold
              const bx = (x(i) ?? 0) + (x.bandwidth() - bw) / 2, top = y(n), base = y(0), r = Math.min(4, (base - top) / 2)
              return (
                <g key={i} tabIndex={0} role="button" aria-label={`score ${lab(i)}: ${n} accounts`} style={{ cursor: on && onPick ? 'pointer' : 'default' }}
                   onClick={on ? onPick : undefined} onPointerMove={() => show(i, n, (x(i) ?? 0) + 8, top - 44)}
                   onPointerLeave={() => setTip(null)} onFocus={() => show(i, n, x(i) ?? 0, top - 44)} onBlur={() => setTip(null)}>
                  <rect x={x(i)} y={m.t} width={x.bandwidth()} height={h - m.b - m.t} fill="transparent" />
                  {n > 0 && <path className="grow-y" style={{ animationDelay: `${k * 20}ms` }} fill={on ? 'var(--held)' : 'var(--bar-off)'}
                    d={`M${bx},${base}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${base}Z`} />}
                  {n > 0 && (on || !all || i === 0) && <text x={(x(i) ?? 0) + x.bandwidth() / 2} y={top - 5} textAnchor="middle"
                    style={{ fill: 'var(--ink-2)', fontWeight: 600 }}>{n.toLocaleString('en-IN')}</text>}
                </g>
              )
            })}
            <line x1={(x(threshold / 5) ?? 0) - 2} x2={(x(threshold / 5) ?? 0) - 2} y1={m.t - 8} y2={h - m.b} stroke="var(--held)" strokeWidth={2} />
            <text x={(x(threshold / 5) ?? 0) + 2} y={m.t - 10} style={{ fill: 'var(--held)', fontWeight: 650 }}>flagged at {threshold}</text>
            <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule-2)" />
            {shown.filter(({ i }) => i % (all ? 4 : 2) === 0).map(({ i }) => (
              <text key={i} x={x(i) ?? 0} y={h - 8}>{i * 5}</text>
            ))}
            <text x={w - m.r} y={h - 8} textAnchor="end">100</text>
          </svg>
        )}
      </div>
    </Chart>
  )
}

/** Part-to-whole of the flagged accounts by layer: a donut with the total in the middle, a legend that is also the
 *  table (count and share), hover/focus lift, click-through to the filtered list. */
export function LayerDonut({ rows, onPick, title, sub, source }: {
  rows: { key: string; label: string; count: number }[]; onPick?: (key: string) => void
  title: ReactNode; sub?: ReactNode; source?: string
}) {
  const [hot, setHot] = useState<string | null>(null)
  const data = rows.filter((r) => r.count > 0)
  const total = data.reduce((a, r) => a + r.count, 0) || 1
  const size = 200, R = size / 2, inner = R * 0.6
  const arcs = pie<{ key: string; label: string; count: number }>().value((d) => d.count).sort(null).padAngle(0.02)(data)
  const mk = arc<(typeof arcs)[number]>().innerRadius(inner).outerRadius(R - 6).cornerRadius(3)
  const color = (k: string) => (k === 'L1' || k === 'L2' || k === 'L3' ? `var(--${k.toLowerCase()})` : 'var(--unknown)')
  const cur = data.find((d) => d.key === hot)
  return (
    <Chart title={title} sub={sub} source={source}>
      <div className="donut">
        <svg viewBox={`${-R} ${-R} ${size} ${size}`} width={size} height={size} role="img"
             aria-label={data.map((d) => `${d.label}: ${d.count}`).join(', ')}>
          {arcs.map((a, i) => {
            const mid = (a.startAngle + a.endAngle) / 2, lift = hot === a.data.key ? 6 : 0
            return (
              <path key={a.data.key} d={mk(a) ?? ''} fill={color(a.data.key)} className="slice fade-in"
                    style={{ transform: `translate(${Math.sin(mid) * lift}px, ${-Math.cos(mid) * lift}px)`, animationDelay: `${i * 60}ms`,
                             opacity: hot && hot !== a.data.key ? 0.45 : 1, cursor: onPick ? 'pointer' : 'default' }}
                    tabIndex={0} role="button" aria-label={`${a.data.label}: ${a.data.count} accounts, ${Math.round((100 * a.data.count) / total)}%`}
                    onPointerEnter={() => setHot(a.data.key)} onPointerLeave={() => setHot(null)}
                    onFocus={() => setHot(a.data.key)} onBlur={() => setHot(null)} onClick={() => onPick?.(a.data.key)} />
            )
          })}
          <text textAnchor="middle" y={-4} className="donut-big">{(cur ? cur.count : total).toLocaleString('en-IN')}</text>
          <text textAnchor="middle" y={16} className="donut-small">{cur ? `${Math.round((100 * cur.count) / total)}% · ${cur.label}` : 'flagged accounts'}</text>
        </svg>
        <ul className="donut-legend">
          {data.map((d) => (
            <li key={d.key} className={hot === d.key ? 'on' : ''} onPointerEnter={() => setHot(d.key)} onPointerLeave={() => setHot(null)}>
              <i style={{ background: color(d.key) }} />
              {onPick ? <button className="lbl" onClick={() => onPick(d.key)}>{d.label}</button> : <span>{d.label}</span>}
              <b>{d.count.toLocaleString('en-IN')}</b><span className="muted">{Math.round((100 * d.count) / total)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Chart>
  )
}

/** Horizontal bars, one series: one colour. Each row is a single button (whole-row hit target, keyboard reachable):
 *  hover or focus highlights it and dims the rest, the detail line explains it, a click opens the filtered list.
 *  The value column carries the share of `total` when given, so no number is colour-only or tooltip-only. */
export function BarList({ title, sub, source, rows, color = 'var(--ink-2)', colorOf, onPick, max = 10, format, total, unit = 'accounts', pickHint = 'View accounts' }: {
  title: ReactNode; sub?: ReactNode; source?: string; rows: { key: string; label: string; count: number; detail?: string }[]
  color?: string; colorOf?: (key: string) => string; onPick?: (key: string) => void; max?: number; format?: (n: number) => string
  total?: number; unit?: string; pickHint?: string
}) {
  const [all, setAll] = useState(false)
  const [hot, setHot] = useState<string | null>(null)
  const shown = all ? rows : rows.slice(0, max)
  const top = Math.max(1, ...shown.map((r) => r.count))
  const cur = rows.find((r) => r.key === hot)
  const fmt = (n: number) => (format ? format(n) : n.toLocaleString('en-IN'))
  const pct = (n: number) => (total ? `${((100 * n) / total).toFixed(n * 1000 >= total ? 0 : 1)}%` : '')
  return (
    <Chart title={title} sub={sub} source={source}>
      <ul className={`bars${hot ? ' has-hot' : ''}`} onPointerLeave={() => setHot(null)}>
        {shown.map((r, i) => {
          const body = (
            <>
              <span className="b-label" title={r.detail ?? r.label}>{r.label}</span>
              <span className="b-track"><span className="b-bar grow-x" style={{ width: `${(100 * r.count) / top}%`, background: colorOf?.(r.key) ?? color, animationDelay: `${Math.min(i, 10) * 30}ms` }} /></span>
              <span className="b-val">{fmt(r.count)}</span>
              {total ? <span className="b-pct">{pct(r.count)}</span> : null}
            </>
          )
          return (
            <li key={r.key} className={hot === r.key ? 'hot' : ''} onPointerEnter={() => setHot(r.key)}>
              {onPick
                ? <button className="b-row" onClick={() => onPick(r.key)} onFocus={() => setHot(r.key)} onBlur={() => setHot(null)}
                          aria-label={`${r.detail ?? r.label}: ${fmt(r.count)} ${unit}${total ? `, ${pct(r.count)}` : ''}. ${pickHint}`}>{body}</button>
                : <div className="b-row">{body}</div>}
            </li>
          )
        })}
      </ul>
      <div className="b-foot">
        <span className="b-detail" aria-live="polite">
          {cur ? <><b>{fmt(cur.count)}</b> {unit}{total ? ` (${pct(cur.count)})` : ''}: {cur.detail ?? cur.label}{onPick ? <span className="muted"> · click to {pickHint.toLowerCase()}</span> : null}</>
               : onPick ? <span className="muted">Hover a row for details; click to {pickHint.toLowerCase()}.</span> : null}
        </span>
        {rows.length > max && <button className="btn ghost sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
      </div>
    </Chart>
  )
}

/** Daily columns (one series). */
export function DailyColumns({ title, sub, source, days }: {
  title: ReactNode; sub?: ReactNode; source?: string; days: { day: string; value: number }[]
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const h = 150, m = { t: 8, r: 8, b: 24, l: 40 }
  const x = scaleBand<string>().domain(days.map((d) => d.day)).range([m.l, Math.max(m.l + 1, w - m.r)]).paddingInner(0.2)
  const y = scaleLinear().domain([0, Math.max(1, ...days.map((d) => d.value))]).nice().range([h - m.b, m.t])
  const bw = Math.min(24, x.bandwidth())
  return (
    <Chart title={title} sub={sub} source={source} tip={tip}>
      <div ref={ref}>
        {w > 0 && (
          <svg height={h} role="img" aria-label="Daily column chart">
            <g className="grid">{y.ticks(3).map((v) => <line key={v} x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} />)}</g>
            {y.ticks(3).map((v) => <text key={v} x={m.l - 6} y={y(v) + 4} textAnchor="end">{v.toLocaleString('en-IN')}</text>)}
            {days.map((d, i) => {
              const bx = (x(d.day) ?? 0) + (x.bandwidth() - bw) / 2, top = y(d.value), base = y(0)
              const r = Math.min(4, (base - top) / 2)
              return (
                <g key={d.day} tabIndex={0} aria-label={`${d.day}: ${d.value}`}
                   onPointerMove={() => setTip({ x: Math.min(x(d.day) ?? 0, w - 140), y: Math.max(0, top - 30), body: <><b>{d.value.toLocaleString('en-IN')}</b><br />{d.day}</> })}
                   onPointerLeave={() => setTip(null)}
                   onFocus={() => setTip({ x: x(d.day) ?? 0, y: top - 30, body: <><b>{d.value.toLocaleString('en-IN')}</b> {d.day}</> })}
                   onBlur={() => setTip(null)}>
                  <rect x={x(d.day)} y={m.t} width={x.bandwidth()} height={h - m.b - m.t} fill="transparent" />
                  {d.value > 0 && <path className="grow-y" style={{ animationDelay: `${i * 25}ms` }} fill="var(--ink-2)"
                    d={`M${bx},${base}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${base}Z`} />}
                  {(i % 2 === 0 || days.length < 9) && <text x={(x(d.day) ?? 0) + x.bandwidth() / 2} y={h - 8} textAnchor="middle">{d.day.slice(8)}</text>}
                </g>
              )
            })}
            <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule-2)" />
          </svg>
        )}
      </div>
    </Chart>
  )
}

/** Where the victim's money sat over time, stacked by layer, with the shared time cursor. */
export function HeldOverTime({ trail, cursor, onCursor, height = 150 }: {
  trail: Trail; cursor: number; onCursor: (t: number) => void; height?: number
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const m = { t: 8, r: 64, b: 22, l: 52 }
  const t1 = Math.max(trail.tEnd, trail.t0 + 60)
  const x = scaleLinear().domain([trail.t0, t1]).range([m.l, Math.max(m.l + 1, w - m.r)])
  const pts = [...trail.held, { ...trail.held[trail.held.length - 1], t: t1 }]
  const maxTotal = Math.max(1, ...pts.map((p) => p.L1 + p.L2 + p.L3))
  const y = scaleLinear().domain([0, maxTotal]).nice().range([height - m.b, m.t])
  const base = (p: typeof pts[number], k: number) => LAYERS.slice(0, k).reduce((s, l) => s + p[l], 0)
  const at = heldAt(trail, hover ?? Math.min(cursor, t1))
  const tAt = hover ?? Math.min(cursor, t1)
  const now = heldAt(trail, Math.min(cursor, t1))
  const total = now.L1 + now.L2 + now.L3
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect()
    return Math.round(Math.min(t1, Math.max(trail.t0, x.invert(clientX - r.left))))
  }
  return (
    <Chart title={<>Victim money still in mule accounts at {tPlus(Math.min(cursor, t1) - trail.t0)}: <span className="held">{inr(total)}</span></>}
           sub="Stacked by layer. Click the chart to move the time cursor." source="trace edges (attributed amounts)">
      <div ref={ref} style={{ position: 'relative' }}>
        {w > 0 && (
          <svg height={height} role="img" aria-label={`Victim money held by layer over time; ${inr(total)} at the cursor`}
               onPointerMove={(e) => setHover(pick(e.clientX, e.currentTarget))} onPointerLeave={() => setHover(null)}
               onClick={(e) => onCursor(pick(e.clientX, e.currentTarget))} style={{ cursor: 'crosshair' }}>
            <g className="grid">{y.ticks(3).map((v) => <line key={v} x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} />)}</g>
            {y.ticks(3).map((v) => <text key={v} x={m.l - 6} y={y(v) + 4} textAnchor="end">{inrShort(v)}</text>)}
            {LAYERS.map((l, k) => {
              const a = area<typeof pts[number]>().curve(curveStepAfter).x((p) => x(p.t)).y0((p) => y(base(p, k))).y1((p) => y(base(p, k) + p[l]))
              const ln = line<typeof pts[number]>().curve(curveStepAfter).x((p) => x(p.t)).y((p) => y(base(p, k) + p[l]))
              return (
                <g key={l}>
                  <path className="fade-in" d={a(pts) ?? ''} fill={`var(--${l.toLowerCase()})`} fillOpacity={0.22} />
                  <path className="draw" pathLength={1} d={ln(pts) ?? ''} fill="none" stroke={`var(--${l.toLowerCase()})`} strokeWidth={2} />
                </g>
              )
            })}
            <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule-2)" />
            <text x={m.l} y={height - 6}>theft</text>
            <text x={w - m.r} y={height - 6} textAnchor="end">{tPlus(t1 - trail.t0)}</text>
            <line x1={x(Math.min(cursor, t1))} x2={x(Math.min(cursor, t1))} y1={m.t} y2={height - m.b} stroke="var(--ink)" strokeWidth={1.5} />
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={height - m.b} stroke="var(--muted)" strokeWidth={1} />}
            {LAYERS.map((l, k) => {
              const p = pts[pts.length - 1]
              const v = p[l]
              if (v <= 0) return null
              return <text key={l} x={w - m.r + 6} y={y(base(p, k) + v / 2) + 4} style={{ fill: 'var(--ink-2)' }}>{l} {inrShort(v)}</text>
            })}
          </svg>
        )}
        <div className="legend" style={{ marginTop: 2 }}>
          {LAYERS.map((l) => <span key={l}><span className={`key ${l}`} />{l} {inr(at[l])}</span>)}
          <span className="muted">at {tPlus(tAt - trail.t0)}</span>
        </div>
      </div>
    </Chart>
  )
}
