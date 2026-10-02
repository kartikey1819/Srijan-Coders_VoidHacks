import { DownloadSimple, Graph } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { REASON_SHORT } from '../format'
import { go } from '../route'
import type { RiskRow } from '../types'
import { AccountPanel } from './AccountPanel'
import { Drawer } from './Drawer'

interface Props { reasons: Record<string, string>; role: string | null; bank: string | null; reason: string | null }
type SortKey = 'score' | 'account' | 'role'

/** Every account the risk index flags (score >= 70), with its reasons. Filters come from the URL. */
export function FlaggedTable({ reasons, role, bank, reason }: Props) {
  const [rows, setRows] = useState<RiskRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'score', desc: true })
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => { api.top('HIGH').then(setRows).catch((e) => setErr(String(e.message ?? e))) }, [])
  useEffect(() => setLimit(200), [role, bank, reason, q])

  const setFilter = (k: 'role' | 'bank' | 'reason', v: string | null) =>
    go({ name: 'flagged', role, bank, reason, [k]: v || null })

  const shown = useMemo(() => {
    const s = q.trim().toUpperCase()
    const out = (rows ?? []).filter((r) => (!role || r.role_hint === role) && (!bank || r.account.startsWith(bank))
      && (!reason || r.reasons.some((x) => x.split(':')[0] === reason)) && (!s || r.account.includes(s)))
    const dir = sort.desc ? -1 : 1
    return out.sort((a, b) => sort.k === 'score' ? dir * (a.score - b.score) || a.account.localeCompare(b.account)
      : sort.k === 'role' ? dir * (a.role_hint ?? '').localeCompare(b.role_hint ?? '') || b.score - a.score
      : dir * a.account.localeCompare(b.account))
  }, [rows, role, bank, reason, q, sort])
  const banks = useMemo(() => [...new Set((rows ?? []).map((r) => r.account.slice(0, 4)))].sort(), [rows])
  const codes = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.reasons.map((x) => x.split(':')[0])))].sort(), [rows])
  const by = (k: string) => (rows ?? []).filter((r) => r.role_hint === k).length
  const close = useCallback(() => setOpen(null), [])
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button className="th-sort" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k === 'score' }))}>
        {label}{sort.k === k ? (sort.desc ? ' ▾' : ' ▴') : ''}</button></th>
  )

  if (err) return <div className="page"><div className="banner bad"><b>{err}</b></div></div>
  if (!rows) return <div className="page"><p className="muted">Loading flagged accounts…</p></div>
  return (
    <div className="page">
      <div className="row between wrap gap">
        <h1>Flagged mule accounts: {rows.length.toLocaleString('en-IN')}</h1>
        <div className="row gap">
          <a className="btn" href="/api/export/flagged.csv"><DownloadSimple /> flagged.csv</a>
          <a className="btn ghost" href="/api/export/ranked.csv"><DownloadSimple /> All accounts ranked</a>
        </div>
      </div>
      <p className="lede small">Accounts scoring 70 or more on the 0-100 Mule Risk Index. The reasons are the signals that raised each score.</p>
      <div className="row gap wrap">
        <select value={role ?? ''} onChange={(e) => setFilter('role', e.target.value)} aria-label="Layer">
          <option value="">All layers</option>
          <option value="L1">L1 collectors ({by('L1')})</option>
          <option value="L2">L2 distributors ({by('L2')})</option>
          <option value="L3">L3 cash-out ({by('L3')})</option>
        </select>
        <select value={bank ?? ''} onChange={(e) => setFilter('bank', e.target.value)} aria-label="Bank">
          <option value="">All banks</option>{banks.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={reason ?? ''} onChange={(e) => setFilter('reason', e.target.value)} aria-label="Reason">
          <option value="">Any reason</option>{codes.map((c) => <option key={c} value={c}>{REASON_SHORT[c] ?? c}</option>)}
        </select>
        <input type="search" placeholder="Filter by account" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter by account" />
        <span className="small muted">{shown.length.toLocaleString('en-IN')} shown</span>
        {(role || bank || reason) && <button className="btn ghost sm" onClick={() => go({ name: 'flagged', role: null, bank: null, reason: null })}>Clear filters</button>}
      </div>
      <div className="sheet">
        <table className="tbl">
          <thead><tr>{th('account', 'Account')}{th('score', 'Score', 'num')}{th('role', 'Layer')}<th>Why</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.account} aria-selected={open === r.account}>
                <td className="acct"><a href={`#account-${r.account}`} onClick={(e) => { e.preventDefault(); setOpen(r.account) }}>{r.account}</a></td>
                <td className="num"><span className={`badge ${r.band}`}>{r.score}</span></td>
                <td>{r.role_hint ?? '-'}</td>
                <td>{r.reasons.slice(0, 4).map((x) => {
                  const [code, value] = x.split(':')
                  return <span key={x} className="chip" title={`${reasons[code] ?? code}${value ? `: ${value}` : ''}`}>{REASON_SHORT[code] ?? code}{value ? ` ${value}` : ''}</span>
                })}</td>
                <td className="row-acts"><button className="btn ghost sm" aria-label={`Isolate ring around ${r.account}`}
                  onClick={() => go({ name: 'ring', account: r.account })}><Graph /> Ring</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit && <button className="btn" onClick={() => setLimit(limit + 500)}>Show 500 more ({(shown.length - limit).toLocaleString('en-IN')} left)</button>}
      {open && <Drawer title="Flagged account" onClose={close}>
        <AccountPanel account={open} reasons={reasons} onSelect={setOpen}
          onTrace={(a) => go({ name: 'investigate', account: a, seeds: null })} onRing={(a) => go({ name: 'ring', account: a })} /></Drawer>}
    </div>
  )
}
