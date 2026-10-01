import { useEffect, useState } from 'react'
import { api } from '../api'
import { inr } from '../format'
import type { AccountSummary, TxnRow } from '../types'

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

export function AccountPanel({ account, reasons, onTrace, onRing, onSelect }: Props) {
  const [s, setS] = useState<AccountSummary | null>(null)
  const [txns, setTxns] = useState<TxnRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setS(null); setTxns([]); setErr(null)
    Promise.all([api.account(account), api.txns(account, 50)])
      .then(([a, t]) => { if (live) { setS(a); setTxns(t) } })
      .catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [account])

  const more = () => api.txns(account, 50, txns.length).then((t) => setTxns((x) => [...x, ...t]))

  if (err) return <div className="card"><p className="error">{err}</p></div>
  if (!s) return <div className="card"><p className="muted">Loading {account}…</p></div>
  const r = s.risk
  return (
    <div className="card">
      <div className="row between">
        <h3 className="mono">{s.account}</h3>
        {r && <span className={`badge ${r.band}`}>Risk {r.score} · {r.band}{r.role_hint ? ` · ${r.role_hint}` : ''}</span>}
      </div>
      <p className="small">{s.bank_name} · IFSC <span className="mono">{s.ifsc}</span> · active {s.first_ts?.slice(0, 10)} to {s.last_ts?.slice(0, 10)}</p>
      <div className="stats">
        <div><b>{inr(s.sum_in_paise)}</b><span>in · {s.n_in} transfers</span></div>
        <div><b>{inr(s.sum_out_paise)}</b><span>out · {s.n_out} transfers</span></div>
      </div>
      {r && r.reasons.length > 0 && (
        <ul className="reasons">{r.reasons.map((x) => <li key={x}>{reasonText(x, reasons)}</li>)}</ul>
      )}
      <p className="small">
        Sent from: {Object.entries(s.devices).map(([k, v]) => `${k} ${v}`).join(', ') || '–'} ·
        IP: {Object.entries(s.ip_classes).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(', ') || '–'}
        {Object.keys(s.dq_flags).length > 0 && <> · data flags: {Object.entries(s.dq_flags).map(([k, v]) => `${k} ${v}`).join(', ')}</>}
      </p>
      <div className="row gap">
        <button className="btn" onClick={() => onTrace(s.account)}>Trace as victim</button>
        <button className="btn" onClick={() => onRing(s.account)}>Isolate ring</button>
      </div>
      <details>
        <summary>Top counterparties</summary>
        <table className="tbl">
          <tbody>
            {s.top_counterparties.map((c) => (
              <tr key={c.direction + c.account} onClick={() => onSelect(c.account)}>
                <td>{c.direction === 'in' ? '← from' : '→ to'}</td><td className="mono">{c.account}</td>
                <td className="num">{c.n_txn}×</td><td className="num">{inr(c.total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details open>
        <summary>Transactions ({s.n_in + s.n_out})</summary>
        <table className="tbl small">
          <thead><tr><th>Time</th><th></th><th>Counterparty · narration</th><th className="num">Amount · mode</th></tr></thead>
          <tbody>
            {txns.map((t) => {
              const out = t.sender === s.account
              return (
                <tr key={t.txn_idx} title={`${t.transaction_id} · ${t.device} · ${t.ip}`}
                    onClick={() => onSelect(out ? t.receiver : t.sender)}>
                  <td className="mono nw">{t.ts}</td><td>{out ? '→' : '←'}</td>
                  <td><span className="mono">{out ? t.receiver : t.sender}</span><div className="narr">{t.narration}</div></td>
                  <td className="num">{inr(t.amount_paise)}<div className="muted">{t.mode}</div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {txns.length < s.n_in + s.n_out && <button className="btn ghost" onClick={more}>Load more</button>}
      </details>
    </div>
  )
}
