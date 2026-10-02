import { CaretLeft, CaretRight, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fromEpoch, tPlus } from '../format'
import { nextTime } from '../trail'

interface Props {
  times: number[]                    // transfer times (epoch s), sorted
  value: number                      // cursor: transfers at or before it are shown
  onChange: (t: number) => void
  t0?: number                        // the theft, for "T+" readouts
  fullRange?: [number, number]       // the dataset's 15-day window
  label?: string
}

const SPEEDS = [1, 5, 30]

/** Minute-by-minute playback of the money's spread. Transfers are ticks on the track; arrows step between them. */
export function Timeline({ times, value, onChange, t0, fullRange, label = 'Show transfers up to this minute' }: Props) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [whole, setWhole] = useState(false)
  const first = times[0] ?? 0, last = times[times.length - 1] ?? 0
  const lo = whole && fullRange ? fullRange[0] : first
  // whole-minute steps from lo; round the end UP so the last position includes the last transfer
  const hi = lo + Math.max(60, Math.ceil(((whole && fullRange ? fullRange[1] : last) - lo) / 60) * 60)
  const v = Math.min(Math.max(value, lo), hi)
  const val = useRef(value)
  val.current = value

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const next = Math.min(hi, val.current + 60 * speed)
      onChange(next)
      if (next >= hi) setPlaying(false)
    }, 250)
    return () => window.clearInterval(id)
  }, [playing, speed, hi, onChange])

  const shown = useMemo(() => {       // binary search: times are sorted
    let lo = 0, hi = times.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= v) lo = m + 1; else hi = m }
    return lo
  }, [times, v])
  // many transfers: draw an activity histogram (transfers per time bucket) instead of one tick each
  const bins = useMemo(() => {
    if (times.length <= 150) return null
    const n = 120, w = (hi - lo) / n, c = new Array(n).fill(0)
    for (const t of times) if (t >= lo && t <= hi) c[Math.min(n - 1, Math.floor((t - lo) / w))]++
    const top = Math.max(1, ...c)
    return c.map((k, i) => ({ t: lo + i * w, h: k ? Math.max(2, (20 * Math.sqrt(k)) / Math.sqrt(top)) : 0 }))
  }, [times, lo, hi])
  const step = (dir: 1 | -1) => {
    const t = nextTime(times, v, dir)
    if (t !== null) onChange(t)
  }
  const pct = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`

  return (
    <div className="sheet timeline" role="group" aria-label="Timeline">
      <div className="ctrls">
        <button className="btn" onClick={() => { if (v >= hi) onChange(lo); setPlaying((p) => !p) }}
                aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}{playing ? 'Pause' : 'Play'}</button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s} min / step</option>)}
        </select>
        <button className="btn sm" onClick={() => step(-1)} aria-label="Previous transfer" title="Previous transfer"><CaretLeft /></button>
        <button className="btn sm" onClick={() => step(1)} aria-label="Next transfer" title="Next transfer"><CaretRight /></button>
      </div>
      <div className="track">
        <svg className="ticks" aria-hidden="true" preserveAspectRatio="none">
          {bins ? bins.map((b, i) => (
            <rect key={i} x={`${(i / bins.length) * 100}%`} width={`${100 / bins.length * 0.8}%`} y={24 - b.h} height={b.h}
                  fill={b.t <= v ? 'var(--ink-2)' : 'var(--rule-2)'} />
          )) : times.map((t, i) => (
            <line key={i} x1={pct(t)} x2={pct(t)} y1={t <= v ? 4 : 10} y2={24}
                  stroke={t <= v ? 'var(--ink)' : 'var(--rule-2)'} strokeWidth={2} />
          ))}
        </svg>
        <input type="range" min={lo} max={hi} step={60} value={v} onChange={(e) => onChange(Number(e.target.value))}
               aria-label={label} aria-valuetext={`${fromEpoch(v)}${t0 !== undefined ? `, ${tPlus(v - t0)} after the theft` : ''}, ${shown} of ${times.length} transfers`} />
      </div>
      <div className="row gap">
        <div className="clock" aria-live={playing ? 'off' : 'polite'}>
          <b>{t0 !== undefined ? tPlus(v - t0) : fromEpoch(v).slice(11, 16)}</b>
          {fromEpoch(v)} · {shown}/{times.length}
        </div>
        <button className="btn ghost sm" onClick={() => onChange(hi)}>Show all</button>
        {fullRange && <label className="check small"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> 15 days</label>}
      </div>
    </div>
  )
}
