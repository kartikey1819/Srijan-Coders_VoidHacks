import { scaleBand, scaleLinear } from 'd3-scale'
import { useEffect, useRef, useState, type ReactNode } from 'react'

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

/** Horizontal bars, one series: one colour. Each row is a single button (whole-row hit target, keyboard reachable):
 *  hover or focus highlights it and dims the rest, the detail line explains it, a click opens the filtered list.
 *  The value column carries the share of `total` when given, so no number is colour-only or tooltip-only. */
export function BarList({ title, sub, source, rows, color = 'var(--ink-2)', colorOf, onPick, max = 10, format, total, unit = 'accounts', pickHint = 'View accounts' }: {
  title: ReactNode; sub?: ReactNode; source?: string; rows: { key: string; label: string; count: number; detail?: string; icon?: ReactNode }[]
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
              <span className="b-label" title={r.detail ?? r.label}>{r.icon}{r.label}</span>
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
