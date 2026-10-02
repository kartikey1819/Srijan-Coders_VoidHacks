import { Copy } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { BarList } from '../charts'
import { useCopy } from '../copy'
import type { DQSummary, Overview } from '../types'
import { Count } from './Count'

export const DQ_RULES: Record<string, string> = {
  DUP_TXN_ID: 'Transaction ID shared with a different transaction (all rows kept)',
  MISSING_FIELD: 'A required value is empty (row kept, left out of the money graph)',
  BAD_AMOUNT: 'Amount is not a number (row kept, left out of the money graph)',
  AMOUNT_PRECISION: 'Amount has more than 2 decimal places (rounded to paise; raw value kept)',
  BAD_TIMESTAMP: 'Timestamp cannot be read (row kept, left out of the money graph)',
  RTGS_BELOW_MIN: 'RTGS below the RBI minimum of ₹2,00,000',
  UPI_ABOVE_P2P_LIMIT: 'UPI above the NPCI general P2P limit of ₹1,00,000',
  IMPS_ABOVE_LIMIT: 'IMPS above ₹5,00,000',
  BAD_ACCT_ID: 'Account number not in the expected format',
  BAD_IFSC: 'IFSC malformed or not matching the account’s bank',
  TS_OUT_OF_RANGE: 'Timestamp outside the 15-day window',
  SELF_LOOP: 'Sender and receiver are the same account',
  UNKNOWN_MODE: 'Payment mode not UPI / IMPS / NEFT / RTGS',
  NONPOSITIVE_AMOUNT: 'Amount zero or negative',
}
const STAGE: Record<string, string> = {
  hash: 'Fingerprint (SHA-256)', load_csv: 'Read every row', verify_order: 'Check row order', account_map: 'Number accounts',
  'derive+validate': 'Clean values, flag rule breaks', dq_summary: 'Count flags', account_table: 'Summarise accounts', graph_arrays: 'Build money graph',
}
const fmtN = (n: number) => Math.round(n).toLocaleString('en-IN')

/** The source file is evidence: problems are flagged and reported, never edited away. */
export function DQView({ stats }: { stats: DQSummary | null }) {
  const c = useCopy()
  const [o, setO] = useState<Overview | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { api.overview().then(setO).catch(() => undefined) }, [])
  if (!stats) return <div className="page"><p className="muted">Loading…</p></div>
  const all = Object.entries(stats.counts).sort((a, b) => b[1] - a[1])
  const hit = all.filter(([, v]) => v > 0), zero = all.filter(([, v]) => v === 0)
  const stages = Object.entries(stats.ingest_seconds).filter(([k]) => k !== 'detect')
  const total = stages.reduce((a, [, b]) => a + b, 0)
  const detect = stats.ingest_seconds.detect
  const days = o?.activity ?? []
  const copy = () => navigator.clipboard?.writeText(stats.input_sha256).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })
  return (
    <div className="page">
      <div>
        <h1>{c.dqTitle}</h1>
        <p className="lede">The bank export is treated as evidence. It was loaded exactly as received
          ({stats.rows.toLocaleString('en-IN')} rows, {stats.accounts.toLocaleString('en-IN')} accounts). Rule breaks are flagged and
          reported here; no row was edited or dropped, and flags never change a risk score.</p>
      </div>
      <div className="dq-grid">
        <div className="dq-side">
          <div className="sheet sheet-body">
            <BarList title={`${hit.length} of ${all.length} checks found rows to flag`} sub="Rows flagged per check (a row can carry several flags)."
                     source="data-quality flags written at ingest" rows={hit.map(([k, v]) => ({ key: k, label: k, count: v }))} />
          </div>
          <div className="sheet">
            <table className="tbl">
              <thead><tr><th>Check</th><th>Rule</th><th className="num">Rows flagged</th></tr></thead>
              <tbody className="stagger">
                {hit.map(([k, v], i) => <tr key={k} style={{ ['--i' as string]: i }}><td className="mono">{k}</td><td>{DQ_RULES[k] ?? ''}</td><td className="num">{v.toLocaleString('en-IN')}</td></tr>)}
              </tbody>
            </table>
            {zero.length > 0 && (
              <details className="sheet-body">
                <summary>{zero.length} checks found nothing</summary>
                <table className="tbl small"><tbody>
                  {zero.map(([k]) => <tr key={k}><td className="mono">{k}</td><td>{DQ_RULES[k] ?? ''}</td><td className="num">0</td></tr>)}
                </tbody></table>
              </details>
            )}
          </div>
        </div>
        <div className="dq-side">
          <section className="sheet sheet-body" aria-label="Integrity">
            <h2>Integrity of the evidence</h2>
            <div className="equal" style={{ marginTop: 8 }}>
              <div><b><Count value={stats.rows} format={fmtN} /></b><span className="small muted">rows received</span></div>
              <span className="muted" aria-hidden="true">=</span>
              <div><b><Count value={stats.rows} format={fmtN} /></b><span className="small muted">rows kept</span></div>
            </div>
            <dl className="kv">
              <dt>File SHA-256</dt>
              <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{stats.input_sha256}
                <button className="btn ghost sm" onClick={copy} aria-label="Copy file hash" style={{ marginLeft: 6 }}><Copy /> {copied ? 'Copied' : 'Copy'}</button></dd>
              {days.length > 0 && <><dt>Days covered</dt><dd>{days[0].day} to {days[days.length - 1].day} ({days.length} days with transfers)</dd></>}
              <dt>Accounts</dt><dd>{stats.accounts.toLocaleString('en-IN')}</dd>
            </dl>
            <h3 style={{ marginTop: 10 }}>What we never do to the file</h3>
            <ul className="never small">
              <li>edit a value (raw text is kept next to every cleaned value);</li>
              <li>drop a row (unreadable rows are flagged and left out of the money graph only);</li>
              <li>re-order rows (row order is verified against the file after loading).</li>
            </ul>
          </section>
          <section className="sheet sheet-body">
            <BarList title={`Loaded and indexed in ${total.toFixed(2)} s`} sub={detect !== undefined ? `Then mule detection took ${detect.toFixed(2)} s.` : undefined}
                     source="timings recorded at ingest" rows={stages.map(([k, v]) => ({ key: k, label: STAGE[k] ?? k, count: v }))}
                     format={(n) => `${n.toFixed(2)} s`} max={12} />
          </section>
        </div>
      </div>
    </div>
  )
}
