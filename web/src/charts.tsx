import { scaleBand, scaleLinear } from 'd3-scale'
import { area, curveStepAfter, line } from 'd3-shape'
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

/** Mule Risk Index distribution: 20 five-point buckets, threshold at 70, flagged buckets emphasised. */
export function ScoreHistogram({ hist, threshold = 70, onPick }: { hist: number[]; threshold?: number; onPick?: () => void }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const h = 190, m = { t: 18, r: 8, b: 26, l: 44 }
  const x = scaleBand<number>().domain(hist.map((_, i) => i)).range([m.l, Math.max(m.l + 1, w - m.r)]).paddingInner(0.12)
  const y = scaleLinear().domain([0, Math.max(1, ...hist)]).nice().range([h - m.b, m.t])
  const flagged = hist.slice(threshold / 5).reduce((a, b) => a + b, 0)
  const total = hist.reduce((a, b) => a + b, 0)
  const bw = Math.min(24, x.bandwidth())
  return (
    <Chart title={`${flagged.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} accounts score ${threshold} or more`}
           sub="Accounts per 5-point band of the 0-100 Mule Risk Index. Flagged bands are highlighted; the rule marks the threshold."
           source="risk table (all accounts)" tip={tip}>
      <div ref={ref}>
        {w > 0 && (
          <svg height={h} role="img" aria-label={`Histogram of risk scores; ${flagged} accounts at ${threshold} or above`}>
            <g className="grid">{y.ticks(4).map((v) => <line key={v} x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} />)}</g>
            {y.ticks(4).map((v) => <text key={v} x={m.l - 6} y={y(v) + 4} textAnchor="end">{v.toLocaleString('en-IN')}</text>)}
            {hist.map((n, i) => {
              const on = i * 5 >= threshold
              const bx = (x(i) ?? 0) + (x.bandwidth() - bw) / 2
              const top = y(n), base = y(0)
              const r = Math.min(4, (base - top) / 2)
              return (
                <g key={i} tabIndex={0} role="button" aria-label={`${i * 5}-${i === 19 ? 100 : i * 5 + 4}: ${n} accounts`}
                   onClick={on ? onPick : undefined} style={{ cursor: on && onPick ? 'pointer' : 'default' }}
                   onPointerMove={(e) => setTip({ x: Math.min((x(i) ?? 0) + 10, w - 150), y: Math.max(0, top - 10),
                     body: <><b>{n.toLocaleString('en-IN')}</b> accounts<br />score {i * 5}-{i === 19 ? 100 : i * 5 + 4}{e.isPrimary ? '' : ''}</> })}
                   onPointerLeave={() => setTip(null)} onFocus={() => setTip({ x: (x(i) ?? 0), y: top - 10,
                     body: <><b>{n.toLocaleString('en-IN')}</b> accounts, score {i * 5}-{i === 19 ? 100 : i * 5 + 4}</> })}
                   onBlur={() => setTip(null)}>
                  <rect x={x(i)} y={m.t} width={x.bandwidth()} height={h - m.b - m.t} fill="transparent" />
                  {n > 0 && <path className="grow-y" style={{ animationDelay: `${i * 20}ms` }} fill={on ? 'var(--held)' : 'var(--bar-off)'}
                    d={`M${bx},${base}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - r}Q${bx + bw},${top} ${bx + bw},${top + r}V${base}Z`} />}
                </g>
              )
            })}
            {hist.map((n, i) => (n > 0 && (i * 5 >= threshold || i === 0)) ? (
              <text key={`v${i}`} x={(x(i) ?? 0) + x.bandwidth() / 2} y={y(n) - 4} textAnchor="middle" style={{ fill: 'var(--ink-2)', fontWeight: 650 }}>
                {n.toLocaleString('en-IN')}</text>) : null)}
            <line x1={x(threshold / 5)! - 2} x2={x(threshold / 5)! - 2} y1={m.t} y2={h - m.b} stroke="var(--held)" strokeWidth={2} />
            <text x={x(threshold / 5)! + 2} y={m.t + 10} style={{ fill: 'var(--held)', fontWeight: 650 }}>flagged at {threshold}</text>
            <line className="axis" x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule-2)" />
            {[0, 20, 40, 60, 80, 100].map((v) => (
              <text key={v} x={v === 100 ? w - m.r : (x(Math.min(v / 5, 19)) ?? 0)} y={h - 8} textAnchor={v === 100 ? 'end' : 'start'}>{v}</text>
            ))}
          </svg>
        )}
      </div>
    </Chart>
  )
}

/** Horizontal bars, one series: one colour. Each label is a link through to the filtered list. */
export function BarList({ title, sub, source, rows, color = 'var(--ink-2)', colorOf, onPick, max = 10, format }: {
  title: ReactNode; sub?: ReactNode; source?: string; rows: { key: string; label: string; count: number }[]
  color?: string; colorOf?: (key: string) => string; onPick?: (key: string) => void; max?: number; format?: (n: number) => string
}) {
  const shown = rows.slice(0, max)
  const top = Math.max(1, ...shown.map((r) => r.count))
  return (
    <Chart title={title} sub={sub} source={source}>
      <div className="barlist">
        {shown.map((r, i) => (
          <div key={r.key} style={{ display: 'contents' }}>
            {onPick ? <button className="lbl" onClick={() => onPick(r.key)} title={r.label}>{r.label}</button>
                    : <span title={r.label}>{r.label}</span>}
            <div><div className="bar grow-x" style={{ width: `${(100 * r.count) / top}%`, background: colorOf?.(r.key) ?? color, animationDelay: `${Math.min(i, 10) * 30}ms` }} /></div>
            <span className="val">{format ? format(r.count) : r.count.toLocaleString('en-IN')}</span>
          </div>
        ))}
      </div>
      {rows.length > max && <div className="src">{rows.length - max} more not shown</div>}
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
