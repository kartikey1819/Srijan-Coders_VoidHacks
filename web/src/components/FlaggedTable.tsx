import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { REASON_SHORT } from '../format'
import type { RiskRow } from '../types'

interface Props { reasons: Record<string, string>; onOpen: (a: string) => void; onRing: (a: string) => void }

/** Every account the risk index flags (score >= 70), with its reasons. */
export function FlaggedTable({ reasons, onOpen, onRing }: Props) {
  const [rows, setRows] = useState<RiskRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState('all')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)

  useEffect(() => { api.top('HIGH').then(setRows).catch((e) => setErr(String(e.message ?? e))) }, [])

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (role === 'all' || r.role_hint === role) && (!q || r.account.includes(q.trim().toUpperCase()))), [rows, role, q])
  const by = (k: string) => (rows ?? []).filter((r) => r.role_hint === k).length

  if (err) return <p className="error">{err}</p>
  if (!rows) return <p className="muted">Loading…</p>
  return (
    <div className="page-pad">
      <div className="row between">
        <h2>Flagged mule accounts: {rows.length.toLocaleString('en-IN')}</h2>
        <div className="row gap">
          <a className="btn" href="/api/export/flagged.csv">Download flagged.csv</a>
          <a className="btn ghost" href="/api/export/ranked.csv">All accounts ranked</a>
        </div>
      </div>
      <div className="row gap">
        <select value={role} onChange={(e) => { setRole(e.target.value); setLimit(200) }} aria-label="Layer">
          <option value="all">All layers</option>
          <option value="L1">L1 collectors ({by('L1')})</option>
          <option value="L2">L2 distributors ({by('L2')})</option>
          <option value="L3">L3 cash-out ({by('L3')})</option>
        </select>
        <input placeholder="Filter by account" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter by account" />
        <span className="muted small">{shown.length.toLocaleString('en-IN')} shown</span>
      </div>
      <table className="tbl">
        <thead><tr><th>Account</th><th className="num">Score</th><th>Layer</th><th>Why</th><th></th></tr></thead>
        <tbody>
          {shown.slice(0, limit).map((r) => (
            <tr key={r.account}>
              <td className="mono"><a href="#" onClick={(e) => { e.preventDefault(); onOpen(r.account) }}>{r.account}</a></td>
              <td className="num"><span className={`badge ${r.band}`}>{r.score}</span></td>
              <td>{r.role_hint ?? '–'}</td>
              <td>{r.reasons.slice(0, 4).map((x) => {
                const [code, value] = x.split(':')
                return <span key={x} className="chip" title={`${reasons[code] ?? code}${value ? `: ${value}` : ''}`}>
                  {REASON_SHORT[code] ?? code}{value ? ` ${value}` : ''}</span>
              })}</td>
              <td><button className="btn ghost" onClick={() => onRing(r.account)}>Ring</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length > limit && <button className="btn ghost" onClick={() => setLimit(limit + 500)}>Show more</button>}
    </div>
  )
}
