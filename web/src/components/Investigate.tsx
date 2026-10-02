import { useEffect, useMemo, useState } from 'react'
import { delayText, inr, RULE_TEXT, toEpoch } from '../format'
import type { TraceResult } from '../types'
import { AccountPanel } from './AccountPanel'
import { DisputedPicker } from './DisputedPicker'
import { DocsPanel } from './DocsPanel'
import { LayerTable } from './LayerTable'
import { TimeSlider } from './TimeSlider'
import { TraceGraph } from './TraceGraph'

interface Props {
  trace: TraceResult | null
  error: string | null
  wallMs: number
  selected: string | null
  reasons: Record<string, string>
  onSelect: (a: string) => void
  seeds: number[] | null
  onTrace: (a: string, seeds?: number[] | null) => void
  onRing: (a: string) => void
}

const WINDOW: [number, number] = [toEpoch('2026-09-15 00:00:00'), toEpoch('2026-09-29 23:59:00')]

export function Investigate({ trace, error, wallMs, selected, reasons, seeds, onSelect, onTrace, onRing }: Props) {
  const [cutoff, setCutoff] = useState(Infinity)
  const [docs, setDocs] = useState(false)
  const range = useMemo<[number, number]>(() => {
    if (!trace || trace.edges.length === 0) return [0, 0]
    const ts = trace.edges.map((e) => toEpoch(e.ts))
    return [Math.min(...ts), Math.max(...ts)]
  }, [trace])
  useEffect(() => { setCutoff(range[1]) }, [range])

  if (error) return <div className="page-pad"><p className="error">{error}</p></div>
  if (!trace) {
    return (
      <div className="page-pad narrow empty">
        <h2>Trace a victim's money</h2>
        <p>Enter the victim's account ID above. The engine follows the money forward in time, up to four hops, and shows
          exactly which accounts received it: Layer 1 collectors, Layer 2 distributors and Layer 3 cash-out accounts.</p>
      </div>
    )
  }
  const count = (r: string) => trace.nodes.filter((n) => n.role === r).length
  const held = trace.nodes.reduce((s, n) => s + (n.role === 'VICTIM' ? 0 : n.held_paise), 0)
  const sel = selected ? trace.edges.filter((e) => e.src === selected || e.dst === selected) : []
  return (
    <div className="investigate">
      <section className="left">
        <div className="summary">
          <div><span>Victim</span><b className="mono">{trace.victim}</b></div>
          <div><span>Siphoned</span><b>{inr(trace.loss_paise)}</b></div>
          <div><span>L1 · L2 · L3</span><b>{count('L1')} · {count('L2')} · {count('L3')}</b></div>
          <div><span>Still held</span><b>{inr(held)}</b></div>
          <div><span>Trace time</span><b>{trace.elapsed_ms} ms</b><small>{wallMs.toFixed(0)} ms end to end</small></div>
          <button className="btn primary" onClick={() => setDocs(true)} disabled={trace.edges.length === 0}>Case diary &amp; notices</button>
        </div>
        {trace.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
        {(seeds || trace.edges.filter((e) => e.rule === 'seed').length > 1) && (
          <DisputedPicker victim={trace.victim} seeds={seeds} onApply={(s) => onTrace(trace.victim, s)} />
        )}
        <div className="legend small">
          <span><span className="dot VICTIM" />Victim</span><span><span className="dot L1" />L1 collector</span>
          <span><span className="dot L2" />L2 distributor</span><span><span className="dot L3" />L3 cash-out</span>
          <span>red line = wallet / crypto cash-out · dashed = slower than 15 min · thick border = flagged</span>
        </div>
        <TraceGraph trace={trace} cutoff={cutoff} selected={selected} onSelect={onSelect} />
        {trace.edges.length > 0 && (
          <TimeSlider min={range[0]} max={range[1]} value={Math.min(cutoff, range[1])} onChange={setCutoff} fullRange={WINDOW} />
        )}
        {sel.length > 0 && (
          <div className="card">
            <h3>Transfers of <span className="mono">{selected}</span> on this trail</h3>
            <table className="tbl small">
              <thead><tr><th>Time</th><th>Transaction ID</th><th>From → To</th><th className="num">Amount</th>
                <th className="num">Victim money</th><th>Linked by</th></tr></thead>
              <tbody>{sel.map((e) => (
                <tr key={e.txn_idx}><td className="mono nw">{e.ts}</td><td className="mono">{e.transaction_id}</td>
                  <td className="mono">{e.src} → {e.dst}</td><td className="num">{inr(e.amount_paise)}</td>
                  <td className="num">{inr(e.attributed_paise)}</td><td>{RULE_TEXT[e.rule]} · {delayText(e.delay_s)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="right">
        <LayerTable trace={trace} selected={selected} onSelect={onSelect} />
        {selected && <AccountPanel account={selected} reasons={reasons} onTrace={onTrace} onRing={onRing} onSelect={onSelect} />}
      </aside>
      {docs && <DocsPanel victim={trace.victim} seeds={seeds} onClose={() => setDocs(false)} />}
    </div>
  )
}
