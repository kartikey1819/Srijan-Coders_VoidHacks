import { Copy, Graph, Path } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { inr } from '../format'
import type { AccountSummary, ScoreExplain, TxnRow } from '../types'
import { BankName } from './BankIcon'

interface Props {
  account: string
  reasons: Record<string, string>
  onTrace: (a: string) => void
  onRing: (a: string) => void
  onSelect: (a: string) => void
}

function reasonText(r: string, labels: Record<string, string>) {
  const [code, value] = r.split(':')
  return `${labels[code] ?? code}${value ? `: ${value}` : ''}`
}

const list = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`).join(', ') || 'none'

export function AccountPanel({ account, reasons, onTrace, onRing, onSelect }: Props) {
  const [s, setS] = useState<AccountSummary | null>(null)
  const [txns, setTxns] = useState<TxnRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    setS(null); setTxns([]); setErr(null)
    Promise.all([api.account(account), api.txns(account, 50)])
      .then(([a, t]) => { if (live) { setS(a); setTxns(t) } })
      .catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [account])

  const more = () => api.txns(account, 200, txns.length).then((t) => setTxns((x) => [...x, ...t]))
  const copy = () => navigator.clipboard?.writeText(account).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })

  if (err) return <p className="error">{err}</p>
  if (!s) return <p className="muted">Loading {account}…</p>
  const r = s.risk
  return (
    <div className="acct-panel">
      <div className="row between gap wrap">
        <h2 className="acct">{s.account}</h2>
        {r && <span className={`badge ${r.band}`}>Risk {r.score} · {r.band}{r.role_hint ? ` · ${r.role_hint}` : ''}</span>}
      </div>
      <dl className="kv">
        <dt>Bank</dt><dd><BankName bank={s.account} name={s.bank_name} /></dd>
        <dt>IFSC</dt><dd className="mono">{s.ifsc}</dd>
        <dt>Active</dt><dd>{s.first_ts?.slice(0, 16)} to {s.last_ts?.slice(0, 16)}</dd>
      </dl>
      <div className="stats">
        <div><b>{inr(s.sum_in_paise)}</b><span>received · {s.n_in} transfers</span></div>
        <div><b>{inr(s.sum_out_paise)}</b><span>sent · {s.n_out} transfers</span></div>
      </div>
      <div className="row gap wrap" style={{ margin: '8px 0' }}>
        <button className="btn" onClick={() => onRing(s.account)}><Graph /> Isolate ring</button>
        <button className="btn" onClick={() => onTrace(s.account)} title="Follow this account's outgoing money as if it were the victim"><Path /> Trace money from here</button>
        <button className="btn ghost" onClick={copy} aria-label="Copy account ID"><Copy /> {copied ? 'Copied' : 'Copy ID'}</button>
      </div>
      {r && <ScoreBreakdown account={s.account} />}
      {r && r.reasons.length > 0 && (
        <>
          <h3 style={{ marginTop: 10 }}>Why it is flagged</h3>
          <ul className="reasons">{r.reasons.map((x) => <li key={x}>{reasonText(x, reasons)}</li>)}</ul>
        </>
      )}
      <dl className="kv">
        <dt>Sent from devices</dt><dd>{list(s.devices)}</dd>
        <dt>Sent from IPs</dt><dd>{list(s.ip_classes)}</dd>
        <dt>Payment modes</dt><dd>{list(s.modes)}</dd>
        {Object.keys(s.dq_flags).length > 0 && <><dt>Data-quality flags</dt><dd>{list(s.dq_flags)}</dd></>}
      </dl>
      <details>
        <summary>Top counterparties</summary>
        <table className="tbl small">
          <tbody>
            {s.top_counterparties.map((c) => (
              <tr key={c.direction + c.account} className="click" tabIndex={0} onClick={() => onSelect(c.account)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelect(c.account) }}>
                <td>{c.direction === 'in' ? 'from' : 'to'}</td><td className="acct">{c.account}</td>
                <td className="num">{c.n_txn}×</td><td className="num">{inr(c.total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details open>
        <summary>Transactions ({(s.n_in + s.n_out).toLocaleString('en-IN')})</summary>
        <table className="tbl small">
          <thead><tr><th>Time</th><th></th><th>Counterparty · narration</th><th className="num">Amount · mode</th></tr></thead>
          <tbody>
            {txns.map((t) => {
              const out = t.sender === s.account
              const other = out ? t.receiver : t.sender
              return (
                <tr key={t.txn_idx} className="click" tabIndex={0} title={`${t.transaction_id} · ${t.device} · ${t.ip}`}
                    onClick={() => onSelect(other)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(other) }}>
                  <td className="mono nw">{t.ts}</td><td>{out ? 'out' : 'in'}</td>
                  <td><span className="acct">{other}</span><div className="narr">{t.narration}</div></td>
                  <td className="num">{inr(t.amount_paise)}<div className="muted">{t.mode}</div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {txns.length < s.n_in + s.n_out && <button className="btn ghost" onClick={more}>Load 200 more</button>}
      </details>
    </div>
  )
}

/** How the Mule Risk Index was reached: each of the four checks with its points on its own (out of its maximum) and the
 *  reason in words, then how they combine, or the named pattern that set a minimum. Recomputed by the engine from the
 *  stored features, so it always adds up to the score shown. */
function ScoreBreakdown({ account }: { account: string }) {
  const [x, setX] = useState<ScoreExplain | null>(null)
  useEffect(() => {
    let live = true
    setX(null)
    api.explain(account).then((e) => live && setX(e)).catch(() => {})
    return () => { live = false }
  }, [account])
  if (!x) return null
  return (
    <section className="score-why" aria-label={`How the score of ${x.score} was reached`}>
      <h3>How the score of {x.score} was reached</h3>
      <ul>
        {x.checks.map((c) => (
          <li key={c.key} className={c.points ? '' : 'none'}>
            <span className="sw-l">{c.label}</span>
            <span className="sw-t"><i style={{ transform: `scaleX(${c.max_points ? c.points / c.max_points : 0})` }} /></span>
            <b>{c.points}<small> / {c.max_points}</small></b>
            <span className="sw-d">{c.detail}</span>
          </li>
        ))}
      </ul>
      <p className="small muted">
        {x.floor !== null
          ? <>Combined, the checks give {x.combined}. The score is raised to <b>{x.floor}</b> because the account shows a pattern
              the problem statement names outright: {x.floor_reason}.</>
          : <>Combined, the checks give <b>{x.combined}</b>. Overlapping evidence is not counted twice, so the points do not
              simply add up. Accounts at 70 or more are flagged.</>}
      </p>
    </section>
  )
}
