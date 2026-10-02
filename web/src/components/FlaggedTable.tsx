import { DownloadSimple, Graph } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { api } from '../api'
import { REASON_SHORT } from '../format'
import { go } from '../route'
import { safeStorage } from '../store'
import type { RiskRow } from '../types'
import { AccountPanel } from './AccountPanel'
import { Page, RoleBadge } from './Page'
import { PanelFrame } from './PanelFrame'
import { BankIcon } from './BankIcon'

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
  const layout = useDefaultLayout({ id: 'flagged-h', storage: safeStorage })
  const th = (k: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button className="th-sort" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k === 'score' }))}>
        {label}{sort.k === k ? (sort.desc ? ' ▾' : ' ▴') : ''}</button></th>
  )

  const desc = 'Accounts that behave like money mules: a Mule Risk Index of 70 or more out of 100. Click an account to see why.'
  const acts = <>
    <a className="btn" href="/api/export/flagged.csv"><DownloadSimple size={16} /> Download suspect list (CSV)</a>
    <a className="btn" href="/api/export/ranked.csv"><DownloadSimple size={16} /> All accounts ranked (CSV)</a>
  </>
  if (err) return <Page title="Suspect Accounts" hi="संदिग्ध खाते" desc={desc}><div className="banner bad"><b>{err}</b></div></Page>
  if (!rows) return <Page title="Suspect Accounts" hi="संदिग्ध खाते" desc={desc}><p className="muted">Loading suspect accounts…</p></Page>
  return (
    <Page title="Suspect Accounts" hi="संदिग्ध खाते" desc={desc} actions={acts}>
      <div className="filters">
        <select value={role ?? ''} onChange={(e) => setFilter('role', e.target.value)} aria-label="Layer">
          <option value="">All roles</option>
          <option value="L1">Collectors, Layer 1 ({by('L1')})</option>
          <option value="L2">Distributors, Layer 2 ({by('L2')})</option>
          <option value="L3">Cash-out, Layer 3 ({by('L3')})</option>
        </select>
        <select value={bank ?? ''} onChange={(e) => setFilter('bank', e.target.value)} aria-label="Bank">
          <option value="">All banks</option>{banks.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={reason ?? ''} onChange={(e) => setFilter('reason', e.target.value)} aria-label="Reason">
          <option value="">Any reason</option>{codes.map((c) => <option key={c} value={c}>{REASON_SHORT[c] ?? c}</option>)}
        </select>
        <input type="search" placeholder="Find an account number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an account number" />
        <span className="small muted">{shown.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} shown</span>
        {(role || bank || reason) && <button className="btn ghost sm" onClick={() => go({ name: 'flagged', role: null, bank: null, reason: null })}>Clear filters</button>}
      </div>
      <div className="split-work">
        <Group orientation="horizontal" id="flagged-h" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <Panel id="flagged-list" defaultSize="62%" minSize="35%">
            <PanelFrame label="Suspect list" title={`${shown.length.toLocaleString('en-IN')} suspect accounts`}>
              <table className="tbl">
                <thead><tr>{th('account', 'Account')}{th('score', 'Risk score', 'num')}{th('role', 'Role')}<th>Why it was flagged</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="stagger">
                  {shown.slice(0, limit).map((r, i) => (
                    <tr key={r.account} aria-selected={open === r.account} style={{ ['--i' as string]: i }}>
                      <td className="acct"><span className="acct-bank"><BankIcon bank={r.account} size="sm" /><a href={`#account-${r.account}`} onClick={(e) => { e.preventDefault(); setOpen(r.account) }}>{r.account}</a></span></td>
                      <td className="num"><span className={`badge ${r.band}`}>{r.score}</span></td>
                      <td>{r.role_hint ? <RoleBadge role={r.role_hint} /> : <span className="muted">-</span>}</td>
                      <td>{r.reasons.slice(0, 4).map((x) => {
                        const [code, value] = x.split(':')
                        return <span key={x} className="chip" title={`${reasons[code] ?? code}${value ? `: ${value}` : ''}`}>{REASON_SHORT[code] ?? code}</span>
                      })}</td>
                      <td className="row-acts"><button className="btn ghost sm" aria-label={`Isolate ring around ${r.account}`}
                        onClick={() => go({ name: 'ring', account: r.account })}><Graph /> Network</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > limit && <div style={{ padding: 10 }}><button className="btn" onClick={() => setLimit(limit + 500)}>Show 500 more ({(shown.length - limit).toLocaleString('en-IN')} left)</button></div>}
            </PanelFrame>
          </Panel>
          <Separator className="sep-v" />
          <Panel id="flagged-side" minSize="25%">
            <PanelFrame label="Account details" title={open ? 'Account' : 'Pick an account'}>
              <div className="sheet-body">
                {open ? <AccountPanel account={open} reasons={reasons} onSelect={setOpen}
                          onTrace={(a) => go({ name: 'investigate', account: a, seeds: null })} onRing={(a) => go({ name: 'ring', account: a })} />
                      : <p className="muted">Click an account on the left to see why it was flagged, its transfers and who it dealt with.</p>}
              </div>
            </PanelFrame>
          </Panel>
        </Group>
      </div>
    </Page>
  )
}
