import { ArrowSquareOut, DownloadSimple, FileText, Path as PathIcon, SpinnerGap, UsersThree } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { inr, inrShort, toEpoch } from '../format'
import { go } from '../route'
import type { TraceNode, TraceResult } from '../types'
import { DocsModal } from './DocsModal'
import { Page, Panel } from './Page'

const ACCT = /[A-Z]{4}\d{8}/g
const MAX = 20
const LAYERS = [['L1', 'Collectors'], ['L2', 'Distributors'], ['L3', 'Cash-out']] as const
const ROLE_NAME: Record<string, string> = { L1: 'Collector', L2: 'Distributor', L3: 'Cash-out' }
const SHOW = 6

interface Result { account: string; trace: TraceResult | null; err: string | null }
interface Shared { account: string; bank: string; roles: Set<string>; victims: string[]; received: number; held: number }

/** Account numbers found in pasted text (any separator), upper-cased, without repeats, at most MAX. */
export const parseAccounts = (text: string) => [...new Set(text.toUpperCase().match(ACCT) ?? [])].slice(0, MAX)
const heldOf = (t: TraceResult) => t.nodes.filter((n) => t.freeze_candidates.includes(n.account)).reduce((s, n) => s + n.held_paise, 0)

/** Several complainants at once: every victim traced in one go, their trails side by side (collectors, distributors,
 *  cash-out), the totals, and the mule accounts their complaints share, so the cases can be clubbed. */
export function MultiTrace({ accounts }: { accounts: string[] }) {
  const [text, setText] = useState(accounts.join('\n'))
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [wallMs, setWallMs] = useState(0)
  const [docsFor, setDocsFor] = useState<string | null>(null)
  const key = accounts.join(',')

  useEffect(() => {
    setText(accounts.join('\n'))
    if (!accounts.length) { setResults(null); return }
    let live = true
    setBusy(true)
    const t0 = performance.now()
    Promise.all(accounts.map((a) => api.trace(a)
      .then((trace): Result => ({ account: a, trace: trace.edges.length ? trace : null, err: trace.edges.length ? null : 'No money moved on from this account.' }))
      .catch((e): Result => ({ account: a, trace: null, err: String(e.message ?? e) }))))
      .then((r) => { if (live) { setResults(r); setWallMs(performance.now() - t0); setBusy(false) } })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseAccounts(text)
  const run = () => { if (parsed.length) go(`#traceall=${parsed.join(',')}`) }
  const useTop = () => api.victims(5).then((v) => go(`#traceall=${v.map((x) => x.account).join(',')}`)).catch(() => {})

  const ok = useMemo(() => (results ?? []).filter((r): r is Result & { trace: TraceResult } => !!r.trace), [results])
  const { shared, groups, mules } = useMemo(() => clubbing(ok.map((r) => r.trace)), [ok])
  const sharedSet = useMemo(() => new Set(shared.map((s) => s.account)), [shared])
  const taken = ok.reduce((s, r) => s + r.trace.loss_paise, 0)
  const frozen = ok.reduce((s, r) => s + heldOf(r.trace), 0)
  const each = ok.map((r) => r.trace.elapsed_ms)

  const csv = () => {
    const head = 'victim,time,transaction_id,from,from_role,to,to_role,mode,victim_money_inr,transfer_amount_inr'
    const lines = ok.flatMap(({ trace: t }) => {
      const role = new Map(t.nodes.map((n) => [n.account, n.role]))
      return [...t.edges].sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts)).map((e) => [t.victim, e.ts, e.transaction_id, e.src, role.get(e.src) ?? '',
        e.dst, role.get(e.dst) ?? '', e.mode, (e.attributed_paise / 100).toFixed(2), (e.amount_paise / 100).toFixed(2)].join(','))
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([[head, ...lines].join('\n') + '\n'], { type: 'text/csv' }))
    a.download = `money_trails_${ok.length}_victims.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Page title="Trace several victims" hi="कई पीड़ितों का पता लगाएँ"
          desc="Paste the complainants' account numbers. Every victim is traced at once, side by side, with the mule accounts their complaints share."
          actions={<>
            <a className="btn" href="#investigate"><PathIcon size={15} /> One victim</a>
            {ok.length > 0 && <button className="btn primary" onClick={csv}><DownloadSimple size={15} /> Combined trails (CSV)</button>}
          </>}>
      <Panel className="pick-panel">
        <form className="multi-pick" onSubmit={(e) => { e.preventDefault(); run() }}>
          <label className="gfield"><span>Victim account numbers (one per line, or separated by commas or spaces)</span>
            <textarea className="mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
                      placeholder={'e.g.\nSBIN10000294\nKKBK10000131'} aria-label="Victim account numbers" /></label>
          <div className="multi-go">
            <span className="small muted">{parsed.length} account number{parsed.length === 1 ? '' : 's'} found{parsed.length === MAX ? ` (at most ${MAX})` : ''}</span>
            <button className="btn primary big" disabled={!parsed.length || busy}>
              {busy ? <SpinnerGap size={16} className="spin" /> : <UsersThree size={16} />} Trace all</button>
            <button type="button" className="btn ghost sm" onClick={useTop}>Use the 5 largest-loss victims</button>
          </div>
        </form>
      </Panel>

      {busy && <div className="gpanel empty-state"><SpinnerGap size={22} className="spin" /><p>Tracing {accounts.length} victims…</p></div>}
      {!busy && results && (
        <>
          <section className="gpanel multi-sum" aria-label="All victims together">
            <div><span>Victims traced</span><b>{ok.length}<small> of {results.length}</small></b>
              <em>{each.length ? `each traced in ${Math.min(...each)}${Math.max(...each) > Math.min(...each) ? `–${Math.max(...each)}` : ''} ms · all back in ${Math.round(wallMs)} ms` : ''}</em></div>
            <div><span>Total taken</span><b>{inrShort(taken)}</b><em>{inr(taken)}</em></div>
            <div className="ok"><span>Can still be frozen</span><b>{inrShort(frozen)}</b><em>{taken ? Math.round((100 * frozen) / taken) : 0}% of the money taken</em></div>
            <div><span>Mule accounts</span><b>{mules}</b><em>across all the trails</em></div>
            <div className={shared.length ? 'warn' : ''}><span>Shared by 2+ victims</span><b>{shared.length}</b>
              <em>{groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'} of complaints to club` : 'no complaints to club'}</em></div>
          </section>

          {shared.length > 0 && (
            <Panel title="These complaints may be clubbed" note="The same mule accounts received money from more than one complainant">
              <ul className="club-groups">
                {groups.map((g, i) => (
                  <li key={i}><b>Group {i + 1}</b>: {g.victims.map((v) => <span key={v} className="vchip mono">{v}</span>)}
                    <span className="muted small">share {g.accounts} account{g.accounts === 1 ? '' : 's'}</span></li>
                ))}
              </ul>
              <table className="tbl small">
                <thead><tr><th>Shared account</th><th>Bank</th><th>Role</th><th>Complainants</th><th className="num">Their money received</th><th className="num">Still held</th></tr></thead>
                <tbody>{shared.map((s) => (
                  <tr key={s.account}>
                    <td className="acct"><a href={`#ring=${s.account}`}>{s.account}</a></td><td>{s.bank}</td>
                    <td>{[...s.roles].map((r) => ROLE_NAME[r] ?? r).join(', ')}</td>
                    <td>{s.victims.map((v) => <span key={v} className="vchip mono">{v}</span>)}</td>
                    <td className="num">{inr(s.received)}</td><td className="num ok">{inr(s.held)}</td>
                  </tr>))}</tbody>
              </table>
            </Panel>
          )}

          <div className="multi-cols" style={{ gridTemplateColumns: `repeat(${results.length}, minmax(228px, 1fr))` }}>
            {results.map((r) => r.trace ? (
              <VictimColumn key={r.account} t={r.trace} shared={sharedSet} onDocs={() => setDocsFor(r.account)} />
            ) : (
              <section key={r.account} className="gpanel vcol bad"><header><b className="mono">{r.account}</b></header>
                <p className="small">{r.err}</p></section>
            ))}
          </div>
        </>
      )}
      {docsFor && <DocsModal victim={docsFor} seeds={null} onClose={() => setDocsFor(null)} />}
    </Page>
  )
}

function VictimColumn({ t, shared, onDocs }: { t: TraceResult; shared: Set<string>; onDocs: () => void }) {
  const v = t.nodes.find((n) => n.role === 'VICTIM')
  const held = heldOf(t)
  return (
    <section className="gpanel vcol" aria-label={`Trail of ${t.victim}`}>
      <header>
        <b className="mono">{t.victim}</b><span className="muted small">{v?.bank_name}</span>
        <span className="vc-loss">{inr(t.loss_paise)} <small>taken</small></span>
        <span className="muted small">traced in {t.elapsed_ms} ms</span>
      </header>
      {LAYERS.map(([k, title]) => {
        const list = t.nodes.filter((n) => n.role === k).sort((a, b) => b.received_paise - a.received_paise)
        return (
          <div key={k} className={`vc-layer ${k.toLowerCase()}`}>
            <h3>{title} <span>{list.length}</span></h3>
            <ul>
              {list.slice(0, SHOW).map((n) => <Row key={n.account} n={n} shared={shared.has(n.account)} />)}
              {list.length > SHOW && <li className="muted small">and {list.length - SHOW} more</li>}
              {!list.length && <li className="muted small">none</li>}
            </ul>
          </div>
        )
      })}
      <footer>
        <span className="ok">{inr(held)} <small>can be frozen in {t.freeze_candidates.length} account{t.freeze_candidates.length === 1 ? '' : 's'}</small></span>
        <div className="row gap">
          <a className="btn sm" href={`#trace=${t.victim}`}><ArrowSquareOut size={14} /> Open trace</a>
          <button className="btn sm" onClick={onDocs}><FileText size={14} /> Documents</button>
        </div>
      </footer>
    </section>
  )
}

function Row({ n, shared }: { n: TraceNode; shared: boolean }) {
  return (
    <li className={shared ? 'shared' : ''} title={shared ? 'Also received money from another complainant on this page' : undefined}>
      <span className="mono">{n.account}</span>{shared && <em>shared</em>}
      <b>{inrShort(n.received_paise)}</b>
    </li>
  )
}

/** Mule accounts reached by two or more victims, and the groups of victims they join (complaints to club). */
function clubbing(traces: TraceResult[]) {
  const by = new Map<string, Shared>()
  for (const t of traces) for (const n of t.nodes) {
    if (n.role === 'VICTIM') continue
    const s = by.get(n.account) ?? { account: n.account, bank: n.bank_name, roles: new Set<string>(), victims: [], received: 0, held: 0 }
    s.roles.add(n.role); s.victims.push(t.victim); s.received += n.received_paise; s.held += n.held_paise
    by.set(n.account, s)
  }
  const shared = [...by.values()].filter((s) => s.victims.length > 1)
    .sort((a, b) => b.victims.length - a.victims.length || b.received - a.received || a.account.localeCompare(b.account))
  const parent = new Map(traces.map((t) => [t.victim, t.victim]))
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x }
  for (const s of shared) for (const v of s.victims.slice(1)) parent.set(find(v), find(s.victims[0]))
  const groupOf = new Map<string, { victims: string[]; accounts: number }>()
  for (const t of traces) {
    const r = find(t.victim)
    const g = groupOf.get(r) ?? { victims: [], accounts: 0 }
    g.victims.push(t.victim)
    groupOf.set(r, g)
  }
  for (const s of shared) groupOf.get(find(s.victims[0]))!.accounts++
  const groups = [...groupOf.values()].filter((g) => g.victims.length > 1).sort((a, b) => b.victims.length - a.victims.length)
  return { shared, groups, mules: by.size }
}
