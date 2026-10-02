import { FileText, Graph } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { api } from '../api'
import { useCopy } from '../copy'
import { markStep, readSteps, safeStorage, type CaseSteps } from '../store'
import { HeldOverTime } from '../charts'
import { inr, spanText, toEpoch } from '../format'
import { go } from '../route'
import { deriveTrail } from '../trail'
import type { TraceResult } from '../types'
import { AccountPanel } from './AccountPanel'
import { Count } from './Count'
import { PanelFrame } from './PanelFrame'
import { DisputedPicker } from './DisputedPicker'
import { DocsPanel } from './DocsPanel'
import { Drawer } from './Drawer'
import { Register } from './Register'
import { Timeline } from './Timeline'
import { TraceGraph } from './TraceGraph'

interface Props {
  account: string | null
  seeds: number[] | null
  reasons: Record<string, string>
  look: string
}

const WINDOW: [number, number] = [toEpoch('2026-09-15 00:00:00'), toEpoch('2026-09-29 23:59:00')]

export function Investigate({ account, seeds, reasons, look }: Props) {
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [near, setNear] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [wallMs, setWallMs] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [cutoff, setCutoff] = useState(Infinity)
  const [docs, setDocs] = useState(false)

  useEffect(() => {
    if (!account) { setTrace(null); setErr(null); return }
    let live = true
    setBusy(true); setErr(null); setNear([]); setSelected(null)
    const t0 = performance.now()
    api.trace(account, seeds).then((t) => {
      if (!live) return
      setWallMs(performance.now() - t0); setTrace(t); setCutoff(Infinity)
    }).catch((e) => {
      if (!live) return
      setErr(String((e as Error).message))
      api.search(account.slice(0, 8)).then((h) => live && setNear(h.slice(0, 6))).catch(() => undefined)
    }).finally(() => live && setBusy(false))
    return () => { live = false }
  }, [account, seeds])

  const trail = useMemo(() => (trace && trace.edges.length ? deriveTrail(trace) : null), [trace])
  const c = useCopy()
  const layoutH = useDefaultLayout({ id: 'inv-h', storage: safeStorage })
  const layoutV = useDefaultLayout({ id: 'inv-v', storage: safeStorage })
  const [steps, setSteps] = useState<CaseSteps>({ reviewed: false, ring: false, notices: false })
  useEffect(() => {
    if (!account) return
    const on = () => setSteps(readSteps(account))
    on()
    window.addEventListener('casestep', on)
    return () => window.removeEventListener('casestep', on)
  }, [account])
  const pick = useCallback((a: string | null) => { setSelected(a); if (a && account) markStep(account, 'reviewed') }, [account])
  const ringFor = useCallback((a: string) => { if (account) markStep(account, 'ring'); go({ name: 'ring', account: a }) }, [account])
  const close = useCallback(() => setSelected(null), [])
  const onTrace = useCallback((a: string) => { setSelected(null); go({ name: 'investigate', account: a, seeds: null }) }, [])
  const onRing = useCallback((a: string) => go({ name: 'ring', account: a }), [])

  if (!account) {
    return (
      <div className="page"><div className="empty">
        <h1>Trace a victim's money</h1>
        <p className="lede">Type the complainant's account ID in the box above (4 letters for the bank, then 8 digits) and press
          Trace. The engine follows the money forward in time, up to four hops, and lists every account it reached:
          Layer 1 collectors, Layer 2 distributors and Layer 3 cash-out accounts, with what each one still holds.</p>
        <p><a href="#overview">Victims found in this file are listed on the Overview.</a></p>
      </div></div>
    )
  }

  const errBox = err && (
    <div className="banner bad" role="alert">
      <div>
        <b>{err}</b>
        <div className="small">Check the ID: 4 letters for the bank, then 8 digits.{near.length > 0 && ' Similar accounts in this file:'}</div>
        {near.length > 0 && <div className="row gap wrap" style={{ marginTop: 6 }}>
          {near.map((a) => <button key={a} className="btn sm acct" onClick={() => onTrace(a)}>{a}</button>)}</div>}
      </div>
    </div>
  )

  if (!trace || !trail) {
    return (
      <div className="page">
        {errBox}
        {busy && <p className="muted">Tracing {account}…</p>}
        {trace && !trail && (
          <div className="banner note">
            <div><b>No outgoing money found for {trace.victim}.</b>
              <div className="small">This account sends nothing onward, so there is no trail to follow from it. It may be a cash-out account.</div>
              <div className="row gap" style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={() => setSelected(trace.victim)}>Open account</button>
                <button className="btn sm" onClick={() => onRing(trace.victim)}><Graph /> Isolate ring</button>
              </div></div>
          </div>
        )}
        {selected && <Drawer title="Account" onClose={close}>
          <AccountPanel account={selected} reasons={reasons} onTrace={onTrace} onRing={onRing} onSelect={setSelected} /></Drawer>}
      </div>
    )
  }

  const count = (r: string) => trace.nodes.filter((n) => n.role === r).length
  const holders = trace.nodes.filter((n) => n.role !== 'VICTIM' && n.held_paise > 0)
  const banks = new Set(trace.nodes.filter((n) => trace.freeze_candidates.includes(n.account)).map((n) => n.bank_prefix))
  const nSeeds = trace.edges.filter((e) => e.rule === 'seed').length
  const victim = trace.nodes.find((n) => n.role === 'VICTIM')
  const sel = selected ? trace.edges.filter((e) => e.src === selected || e.dst === selected) : []
  const pct = trace.loss_paise ? Math.round((100 * trail.heldNow) / trace.loss_paise) : 0

  const done = 1 + (steps.reviewed ? 1 : 0) + (steps.ring ? 1 : 0) + (steps.notices ? 1 : 0)
  return (
    <div className="inv investigate">
      <section className="sheet case" aria-label="Case summary">
        <div className="fig"><span>{c.victim}</span><b className="mono">{trace.victim}</b><small>{victim?.bank_name}</small></div>
        <div className="fig"><span>{c.taken}</span><b><Count value={trace.loss_paise} format={inr} /></b>
          <small>{nSeeds} disputed transfer{nSeeds === 1 ? '' : 's'} · from {new Date(trail.t0 * 1000).toISOString().slice(0, 16).replace('T', ' ')}</small></div>
        <div className="fig"><span>{c.heldIn(holders.length)}</span>
          <b className="held"><Count value={trail.heldNow} format={inr} /></b><small>{c.heldPct(pct)}</small></div>
        <div className="fig"><span>{c.spread}</span><b>{count('L1')} · {count('L2')} · {count('L3')}</b>
          <small>within {spanText(trail.tEnd - trail.t0)} of the theft</small></div>
        <div className="fig"><span>{c.freeze}</span><b><Count value={trace.freeze_candidates.length} format={(n) => String(Math.round(n))} /></b>
          <small>accounts at {banks.size} bank{banks.size === 1 ? '' : 's'}</small></div>
        <div className="fig meter" title="Steps taken on this case in this browser: traced, an account reviewed, the ring isolated, notices drafted.">
          <span>{c.progress}: <b style={{ fontSize: 'inherit' }}>{Math.round((100 * done) / 4)}%</b></span>
          <div className="track"><div className="fill" style={{ transform: `scaleX(${done / 4})` }} /></div>
          <div className="steps"><span className="on">traced</span><span className={steps.reviewed ? 'on' : ''}>reviewed</span>
            <span className={steps.ring ? 'on' : ''}>ring</span><span className={steps.notices ? 'on' : ''}>notices</span></div>
        </div>
        <div className="act">
          <button className="btn primary" onClick={() => setDocs(true)}><FileText /> Case diary &amp; notices</button>
        </div>
      </section>

      {errBox}
      {trace.warnings.map((w) => <div key={w} className="banner note small">{w}</div>)}
      {(seeds || nSeeds > 1) && <DisputedPicker victim={trace.victim} seeds={seeds}
        onApply={(s) => go({ name: 'investigate', account: trace.victim, seeds: s })} />}

      <div className="inv-main">
        <Group orientation="horizontal" id="inv-h" defaultLayout={layoutH.defaultLayout} onLayoutChanged={layoutH.onLayoutChanged}>
          <Panel id="register" defaultSize="52%" minSize="28%">
            <Register trace={trace} trail={trail} cutoff={cutoff} selected={selected} onSelect={pick} onRing={ringFor} />
          </Panel>
          <Separator className="sep-v" />
          <Panel id="annex" minSize="26%">
            <Group orientation="vertical" id="inv-v" defaultLayout={layoutV.defaultLayout} onLayoutChanged={layoutV.onLayoutChanged}>
              <Panel id="graph" defaultSize="60%" minSize="25%">
                <PanelFrame label="Money trail graph" title={c.graph}
                  actions={<div className="legend">
                    <span><span className="key VICTIM" />Victim</span><span><span className="key L1" />L1</span>
                    <span><span className="key L2" />L2</span><span><span className="key L3" />L3</span>
                    <span><span className="ln dash" />after 15 min</span></div>}>
                  <div className="graph-wrap investigate-graph" style={{ flex: 1, minHeight: 0 }}>
                    <TraceGraph trace={trace} cutoff={cutoff} selected={selected} onSelect={pick} look={look} />
                  </div>
                  <div className="statusline">Traced in {trace.elapsed_ms} ms on the engine ({wallMs.toFixed(0)} ms in the browser) ·
                    {' '}{trace.nodes.length} accounts · {trace.edges.length} transfers · hover for details, click to open</div>
                </PanelFrame>
              </Panel>
              <Separator className="sep-h" />
              <Panel id="chart" minSize="20%">
                <PanelFrame label="Money over time" title="Where the money sat">
                  <div style={{ padding: '8px 14px' }}>
                    <HeldOverTime trail={trail} cursor={Math.min(cutoff, trail.tEnd)} onCursor={setCutoff} />
                  </div>
                </PanelFrame>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>

      <Timeline times={trail.times} value={Math.min(cutoff, trail.tEnd)} onChange={setCutoff} t0={trail.t0} fullRange={WINDOW} />

      {selected && (
        <Drawer title="Account on the trail" onClose={close}>
          {sel.length > 0 && (
            <details open style={{ marginBottom: 10 }}>
              <summary>Transfers of this account on the trail ({sel.length})</summary>
              <table className="tbl small">
                <thead><tr><th>Time</th><th>From → To</th><th className="num">Victim money</th><th>Linked by</th></tr></thead>
                <tbody>{sel.map((e) => (
                  <tr key={e.txn_idx} title={e.transaction_id}>
                    <td className="mono nw">{e.ts.slice(5, 16)}</td><td className="acct">{e.src} → {e.dst}</td>
                    <td className="num">{inr(e.attributed_paise)}<div className="muted">of {inr(e.amount_paise)}</div></td>
                    <td>{e.rule === 'seed' ? 'disputed transfer' : `${RULE[e.rule]}${e.delay_s !== null ? `, ${spanText(e.delay_s)} after the money arrived` : ''}`}</td>
                  </tr>))}</tbody>
              </table>
            </details>
          )}
          <AccountPanel account={selected} reasons={reasons} onTrace={onTrace} onRing={ringFor} onSelect={pick} />
        </Drawer>
      )}
      {docs && <DocsPanel trace={trace} seeds={seeds} onClose={() => setDocs(false)} onGenerated={() => markStep(trace.victim, 'notices')} />}
    </div>
  )
}

const RULE: Record<string, string> = {
  window: 'passed on within 3-15 min', amount_match: 'passed on at >= 90% of one credit', oldest: 'balance rule (own money spent first)',
}
