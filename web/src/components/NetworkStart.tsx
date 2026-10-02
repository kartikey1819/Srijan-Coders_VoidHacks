import { Graph } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { REASON_SHORT } from '../format'
import { go } from '../route'
import type { RiskRow } from '../types'
import { Page, Panel, RoleBadge } from './Page'

/** Fraud Networks before an account is chosen: what the view shows, and the collector accounts to start from. */
export function NetworkStart() {
  const [rows, setRows] = useState<RiskRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.top('HIGH', 5000).then((r) => setRows(r.filter((x) => x.role_hint === 'L1'))).catch((e) => setErr(String(e.message ?? e))) }, [])
  return (
    <Page title="Fraud Networks" hi="धोखाधड़ी नेटवर्क"
          desc="A fraud network is every suspect account linked by money to the one you choose: its victims, collectors, distributors and cash-out accounts.">
      <Panel title="Start from a collector account" note="Collectors receive victims' money first, so their network shows the whole operation. Click one to open it.">
        {err && <p className="error">{err}</p>}
        {!rows && !err && <p className="muted">Loading suspect accounts…</p>}
        {rows && (
          <div className="tscroll tall">
            <table className="gtbl">
              <thead><tr><th>Account</th><th>Role</th><th className="num">Risk score</th><th>Why it was flagged</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{rows.slice(0, 200).map((r) => (
                <tr key={r.account} className="click" tabIndex={0} onClick={() => go({ name: 'ring', account: r.account })}
                    onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'ring', account: r.account }) }}>
                  <td className="mono strong">{r.account}</td>
                  <td><RoleBadge role="L1" /></td>
                  <td className="num">{r.score}</td>
                  <td>{r.reasons.slice(0, 3).map((x) => REASON_SHORT[x.split(':')[0]] ?? x.split(':')[0]).join(', ')}</td>
                  <td className="num"><span className="btn sm"><Graph size={14} /> Open network</span></td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  )
}
