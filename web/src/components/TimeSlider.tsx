import { useEffect, useRef, useState } from 'react'
import { fromEpoch } from '../format'

interface Props { min: number; max: number; value: number; onChange: (t: number) => void; fullRange?: [number, number] }

const SPEEDS = [1, 5, 30]

/** Minute-by-minute time-lapse of the money's spread. */
export function TimeSlider({ min, max, value, onChange, fullRange }: Props) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [whole, setWhole] = useState(false)
  const lo = whole && fullRange ? fullRange[0] : min
  // the slider moves in whole minutes from `lo`; round the end UP to a whole step so that the last
  // position includes the last transfer (otherwise a transfer in the final minute can never be shown)
  const hi = lo + Math.ceil(((whole && fullRange ? fullRange[1] : max) - lo) / 60) * 60
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

  const play = () => {
    if (value >= hi) onChange(lo)
    setPlaying((p) => !p)
  }

  return (
    <div className="slider">
      <button className="btn" onClick={play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s) => <option key={s} value={s}>{s} min / tick</option>)}
      </select>
      <input type="range" min={lo} max={hi} step={60} value={Math.min(Math.max(value, lo), hi)}
             onChange={(e) => onChange(Number(e.target.value))} aria-label="Show transfers up to this minute" />
      <span className="mono when">{fromEpoch(Math.min(Math.max(value, lo), hi))}</span>
      <button className="btn ghost" onClick={() => onChange(hi)}>Show all</button>
      {fullRange && (
        <label className="check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> full 15 days</label>
      )}
    </div>
  )
}
