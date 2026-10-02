import { ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { inr, ROLE_TEXT, spanText, toEpoch } from '../format'
import type { ringIndex } from '../ringJourney'
import type { GraphEdge, TxnRow } from '../types'

interface Props {
  edge: GraphEdge
  ix: ReturnType<typeof ringIndex>
  onBack: () => void
  onGo: (a: string) => void
}

/** Everything behind one link of the ring: both accounts, the totals and timing, every transaction row, and the
 *  money right before (into the sender) and right after (out of the receiver). */
export function EdgeFlow({ edge, ix, onBack, onGo }: Props) {
  const [rows, setRows] = useState<TxnRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setRows(null); setErr(null)
    api.byIndex(edge.txn_idxs).then((r) => live && setRows(r)).catch((e) => live && setErr(String((e as Error).message)))
    return () => { live = false }
  }, [edge])
  const s = ix.role.get(edge.src), d = ix.role.get(edge.dst)
  const before = (ix.inn.get(edge.src) ?? []).slice().sort((a, b) => b.total_paise - a.total_paise)
  const after = (ix.out.get(edge.dst) ?? []).slice().sort((a, b) => b.total_paise - a.total_paise)
  const span = toEpoch(edge.last_ts) - toEpoch(edge.first_ts)
  const end = (acct: string, role?: string, bank?: string) => (
    <div className="end">
      <button className="btn ghost sm acct" onClick={() => onGo(acct)} title="Follow this account">{acct}</button>
      <span className="small muted">{ROLE_TEXT[role ?? 'UNKNOWN'] ?? role} · {bank}</span>
    </div>
  )
  return (
    <div className="flow">
      <button className="btn ghost sm" onClick={onBack}><ArrowLeft /> Back to the journey</button>
      <h3 style={{ margin: '10px 0 8px', fontSize: 'var(--fs)', color: 'var(--ink)' }}>Transfer flow</h3>
      <div className="flow-head">
        {end(edge.src, s?.role, s?.bank_prefix)}
        <ArrowRight className="arrow" aria-label="sent to" />
        {end(edge.dst, d?.role, d?.bank_prefix)}
      </div>
      <div className="flow-stats">
        <div><b>{inr(edge.total_paise)}</b><span>moved on this link</span></div>
        <div><b>{edge.n_txn}</b><span>transfer{edge.n_txn === 1 ? '' : 's'}</span></div>
        <div><b>{span > 0 ? spanText(span) : 'one time'}</b><span>{edge.first_ts.slice(5, 16)}{span > 0 ? ` to ${edge.last_ts.slice(5, 16)}` : ''}</span></div>
      </div>
      <h3>Transactions</h3>
      {err && <p className="error">{err}</p>}
      {!rows && !err && <p className="muted small">Loading the rows from the file…</p>}
      {rows && (
        <table className="tbl small">
          <thead><tr><th>Time</th><th>Transaction ID</th><th className="num">Amount · mode</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.txn_idx} title={`row ${t.txn_idx} in the file`}>
              <td className="mono nw">{t.ts}</td>
              <td><span className="mono">{t.transaction_id}</span><div className="narr">{t.narration}</div>
                <div className="narr">{t.device} · {t.ip} ({t.ip_class.replace('_', ' ')})</div></td>
              <td className="num">{inr(t.amount_paise)}<div className="muted">{t.mode}</div></td>
            </tr>))}</tbody>
        </table>
      )}
      <h3>Money into {edge.src} ({before.length})</h3>
      {before.slice(0, 6).map((e) => (
        <div key={e.src} className="hop"><span className={`key ${ix.role.get(e.src)?.role ?? 'UNKNOWN'}`} />
          <div><div className="acct">{e.src}</div><div className="small muted">{e.n_txn} transfer{e.n_txn === 1 ? '' : 's'} · first {e.first_ts.slice(5, 16)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="num">{inr(e.total_paise)}</div><button className="btn ghost sm" onClick={() => onGo(e.src)}>Go here</button></div></div>
      ))}
      {before.length === 0 && <p className="small muted">None inside the ring: {edge.src} is where the money enters.</p>}
      <h3>Money out of {edge.dst} ({after.length})</h3>
      {after.slice(0, 6).map((e) => (
        <div key={e.dst} className="hop"><span className={`key ${ix.role.get(e.dst)?.role ?? 'UNKNOWN'}`} />
          <div><div className="acct">{e.dst}</div><div className="small muted">{e.n_txn} transfer{e.n_txn === 1 ? '' : 's'} · first {e.first_ts.slice(5, 16)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="num">{inr(e.total_paise)}</div><button className="btn ghost sm" onClick={() => onGo(e.dst)}>Go here</button></div></div>
      ))}
      {after.length === 0 && <p className="small muted">None inside the ring: {edge.dst} is where this money stops.</p>}
    </div>
  )
}
