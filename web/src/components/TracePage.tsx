import { ArrowCounterClockwise, DownloadSimple, FileText, Graph, MagnifyingGlass, Path as PathIcon, SpinnerGap } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { HeldOverTime } from '../charts'
import { accountHint, inr, toEpoch } from '../format'
import { go } from '../route'
import { deriveTrail } from '../trail'
import type { TraceResult, TxnRow, VictimCandidate } from '../types'
import { AccountPanel } from './AccountPanel'
import { DisputedPicker } from './DisputedPicker'
import { DocsModal } from './DocsModal'
import { Drawer } from './Drawer'
import { Page, Panel } from './Page'
import { Timeline } from './Timeline'
import { buildView, duration, signsOf, when } from './trace/model'
import { FreezeTable, Insights, JourneyStrip, PassWindow, TraceRecord, TxnTable } from './trace/TraceParts'
import { TrailTree } from './trace/TrailTree'

const WINDOW: [number, number] = [toEpoch('2026-09-15 00:00:00'), toEpoch('2026-09-29 23:59:00')]

interface Props { account: string | null; seeds: number[] | null; reasons: Record<string, string> }

/** Trace Victim Funds: one scrolling report, top to bottom, the way an officer reads a case. */
export function TracePage({ account, seeds, reasons }: Props) {
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [near, setNear] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [wallMs, setWallMs] = useState(0)
  const [hops, setHops] = useState(4)
  const [input, setInput] = useState(account ?? '')
  const [victims, setVictims] = useState<VictimCandidate[]>([])
  const [rows, setRows] = useState<Map<number, TxnRow>>(new Map())
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState(Infinity)
  const [docs, setDocs] = useState(false)
  const [replaying, setReplaying] = useState(false)

  useEffect(() => {
    api.victims(80).then((v) => {
      setVictims(v)
      if (!account && v[0]) window.location.replace(`#trace=${v[0].account}`)   // open on the largest loss
    }).catch(() => setVictims([]))
  }, [account])
  useEffect(() => setInput(account ?? ''), [account])
  useEffect(() => {
    if (!account) { setTrace(null); setErr(null); return }
    let live = true
    setBusy(true); setErr(null); setNear([]); setSelected(null); setRows(new Map())
    const t0 = performance.now()
    api.trace(account, seeds, hops).then((t) => {
      if (!live) return
      setWallMs(performance.now() - t0); setTrace(t); setCursor(Infinity)
      api.byIndexAll(t.edges.map((e) => e.txn_idx)).then((r) => live && setRows(new Map(r.map((x) => [x.txn_idx, x])))).catch(() => undefined)
    }).catch((e) => {
      if (!live) return
      setTrace(null); setErr(String((e as Error).message))
      api.search(account.slice(0, 8)).then((h) => live && setNear(h.slice(0, 6))).catch(() => undefined)
    }).finally(() => live && setBusy(false))
    return () => { live = false }
  }, [account, seeds, hops])

  const view = useMemo(() => (trace && trace.edges.length ? buildView(trace) : null), [trace])
  const trail = useMemo(() => (trace && trace.edges.length ? deriveTrail(trace) : null), [trace])
  const signs = useMemo(() => (trace && rows.size ? signsOf(trace, rows) : null), [trace, rows])
  const cur = trail ? Math.min(cursor, trail.tEnd) : 0

  // Replay: step through every transfer in time order so the tree builds up
  const timer = useRef<number | null>(null)
  const stopReplay = useCallback(() => { if (timer.current) window.clearInterval(timer.current); timer.current = null; setReplaying(false) }, [])
  const replay = () => {
    if (!trail) return
    stopReplay()
    let i = 0
    setCursor(trail.t0); setReplaying(true)
    timer.current = window.setInterval(() => {
      if (i >= trail.times.length) { stopReplay(); setCursor(Infinity); return }
      setCursor(trail.times[i++])
    }, 380)
  }
  useEffect(() => stopReplay, [stopReplay, trace])

  const submit = (a: string) => {
    const s = a.trim().toUpperCase()
    if (!s) return
    go({ name: 'investigate', account: s, seeds: s === account ? seeds : null })
  }
  const downloadCsv = () => {
    if (!trace) return
    const head = 'time,transaction_id,from,to,mode,victim_money_inr,transfer_amount_inr,device,ip'
    const lines = [...trace.edges].sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts)).map((e) => {
      const r = rows.get(e.txn_idx)
      return [e.ts, e.transaction_id, e.src, e.dst, e.mode, (e.attributed_paise / 100).toFixed(2), (e.amount_paise / 100).toFixed(2),
              r?.device ?? '', r?.ip ?? ''].join(',')
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([[head, ...lines].join('\n') + '\n'], { type: 'text/csv' }))
    a.download = `money_trail_${trace.victim}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const collector = view?.collector?.account ?? null
  const actions = trace && view && (
    <>
      <button className="btn" onClick={downloadCsv}><DownloadSimple size={16} /> Download trail (CSV)</button>
      <button className="btn" disabled={!collector} onClick={() => collector && go({ name: 'ring', account: collector })}><Graph size={16} /> View fraud network</button>
      <button className="btn cta" onClick={() => setDocs(true)}><FileText size={16} /> Prepare case diary and freeze notices</button>
    </>
  )
  const nSeeds = trace?.edges.filter((e) => e.rule === 'seed').length ?? 0
  const autoSeeds = !seeds && !!trace?.warnings.some((w) => w.startsWith('Traced the '))

  return (
    <Page title="Trace Victim Funds" hi="पीड़ित राशि का पता लगाएँ" actions={actions}
          desc="Follow a victim's money through mule accounts, up to four transfers deep, and see where it can still be frozen.">
      <Panel title="Select the victim account">
        <form className="pick-row" onSubmit={(e) => { e.preventDefault(); submit(input) }}>
          <label className="gfield acct-field"><span>Victim account number</span>
            <div className="inbox"><MagnifyingGlass size={16} aria-hidden="true" />
              <input className="mono" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="e.g. KKBK10000000"
                     spellCheck={false} autoComplete="off" aria-label="Victim account number" /></div></label>
          <label className="gfield"><span>Follow money up to</span>
            <select value={hops} onChange={(e) => setHops(Number(e.target.value))}>
              {[1, 2, 3, 4].map((h) => <option key={h} value={h}>{h} transfer{h > 1 ? 's' : ''} away</option>)}
            </select></label>
          <button className="btn primary big" disabled={busy}>{busy ? <SpinnerGap size={16} className="spin" /> : <PathIcon size={16} />} Trace funds</button>
          <span className="sp" />
          <label className="gfield victim-pick"><span>Or choose an identified victim</span>
            <select value="" onChange={(e) => e.target.value && submit(e.target.value)}>
              <option value="">Select from {victims.length} victims (largest loss first)</option>
              {victims.map((v) => <option key={v.account} value={v.account}>{v.account} · {inr(v.out_paise_to_flagged)} · {when(v.first_ts)}</option>)}
            </select></label>
        </form>
        {trace && account && (nSeeds > 1 || seeds || autoSeeds) && (
          <DisputedPicker victim={trace.victim} seeds={seeds} auto={autoSeeds ? nSeeds : null}
                          onApply={(s) => go({ name: 'investigate', account: trace.victim, seeds: s })} />
        )}
      </Panel>

      {err && (
        <div className="gpanel empty-state" role="alert">
          <h2>{err}</h2>
          <p>{(account && accountHint(account)) ?? 'Check the account number: 4 letters for the bank, then 8 digits.'} Or choose a victim from the list above.</p>
          {near.length > 0 && <div className="row gap wrap">{near.map((a) => <button key={a} className="btn mono" onClick={() => submit(a)}>{a}</button>)}</div>}
        </div>
      )}
      {!trace && !err && <div className="gpanel empty-state"><SpinnerGap size={22} className="spin" /><p>Tracing the victim's money…</p></div>}
      {trace && !view && (
        <div className="gpanel empty-state"><h2>No money moved on from {trace.victim}.</h2>
          <p>This account sent nothing onward, so there is no trail to follow. It may itself be a cash-out account.</p>
          <div className="row gap"><button className="btn" onClick={() => setSelected(trace.victim)}>Open account</button>
            <button className="btn" onClick={() => go({ name: 'ring', account: trace.victim })}><Graph size={16} /> View fraud network</button></div></div>
      )}

      {trace && view && trail && (
        <div className="trace-body" key={trace.victim}>
          <Panel title="Summary" note={`Victim ${view.victim.account} · ${view.victim.bank_name} · ${when(view.seeds[0]?.ts ?? trace.edges[0].ts)}`}>
            <p className="headline">
              <b>{inr(trace.loss_paise)}</b> taken from the victim passed through <b>{view.mules.length} mule account{view.mules.length === 1 ? '' : 's'}</b> at{' '}
              {view.banks.length} bank{view.banks.length === 1 ? '' : 's'} within <b>{duration(view.spanS)}</b>. Of this,{' '}
              <b className="ok">{inr(view.freezeTotal)} ({view.recPct}%)</b> is still held in accounts that can be frozen.
            </p>
            <JourneyStrip t={trace} v={view} />
          </Panel>

          <Insights t={trace} v={view} signs={signs} />

          <Panel title="How the money moved" className="trail-panel"
                 note="Each box shows the amount received and the time after the victim's payment. Point at a box to follow its path; click it to open the account."
                 actions={<button className="btn sm" onClick={replaying ? stopReplay : replay}><ArrowCounterClockwise size={14} /> {replaying ? 'Stop' : 'Replay'}</button>}>
            <div className="trail-time">
              <Timeline times={trail.times} value={cur} onChange={(t) => { stopReplay(); setCursor(t) }} t0={trail.t0} fullRange={WINDOW}
                        label="Show the money trail up to this minute" />
            </div>
            <TrailTree trace={trace} cursor={cur} onSelect={setSelected} />
            <div className="tree-legend">
              <span><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" style={{ stroke: 'var(--l2)' }} strokeWidth="2" /></svg> moved within one hour</span>
              <span><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" style={{ stroke: 'var(--l2)' }} strokeWidth="2" strokeDasharray="6 5" /></svg> moved later</span>
              <span className="muted">Faded boxes have not received money yet at the time shown.</span>
            </div>
          </Panel>

          <Panel title="Where the money sat, minute by minute" note="Follows the same time as the trail above.">
            <HeldOverTime trail={trail} cursor={cur} onCursor={(t) => { stopReplay(); setCursor(t) }} height={170} />
          </Panel>

          <div className="two-col">
            <Panel title="Collector account: first minutes after the victim's payment" note="Money in above the line, money out below">
              <PassWindow t={trace} v={view} />
            </Panel>
            <Panel title="Trace record" note="How this result was produced" flush>
              <TraceRecord t={trace} v={view} hops={hops} wallMs={wallMs} signs={signs} chosen={!!seeds} />
            </Panel>
          </div>

          <div className="two-col wide-right">
            <Panel title="Accounts to freeze" note={`${view.freeze.length} accounts · ${inr(view.freezeTotal)}`} flush>
              <FreezeTable v={view} onOpen={setSelected} />
            </Panel>
            <Panel title="Transactions in the trail" note={`${trace.edges.length} transactions, in time order`} flush>
              <TxnTable t={trace} rows={rows} />
            </Panel>
          </div>
        </div>
      )}

      {selected && (
        <Drawer title="Account details" onClose={() => setSelected(null)}>
          <AccountPanel account={selected} reasons={reasons} onSelect={setSelected}
                        onTrace={(a) => { setSelected(null); go({ name: 'investigate', account: a, seeds: null }) }}
                        onRing={(a) => go({ name: 'ring', account: a })} />
        </Drawer>
      )}
      {docs && trace && <DocsModal victim={trace.victim} seeds={seeds} onClose={() => setDocs(false)} />}
    </Page>
  )
}
