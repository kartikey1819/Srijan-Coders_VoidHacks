import { BarList } from '../charts'
import type { DQSummary } from '../types'

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

/** The source file is evidence: problems are flagged and reported, never edited away. */
export function DQView({ stats }: { stats: DQSummary | null }) {
  if (!stats) return <div className="page"><p className="muted">Loading…</p></div>
  const all = Object.entries(stats.counts).sort((a, b) => b[1] - a[1])
  const hit = all.filter(([, v]) => v > 0), zero = all.filter(([, v]) => v === 0)
  const stages = Object.entries(stats.ingest_seconds).filter(([k]) => k !== 'detect')
  const total = stages.reduce((a, [, b]) => a + b, 0)
  const detect = stats.ingest_seconds.detect
  return (
    <div className="page narrow">
      <h1>Data quality</h1>
      <p className="lede">The bank export is treated as evidence. It was loaded exactly as received
        ({stats.rows.toLocaleString('en-IN')} rows, {stats.accounts.toLocaleString('en-IN')} accounts). Rule breaks are flagged and
        reported here; no row was edited or dropped, and flags never change a risk score.</p>
      <p className="small">Source file SHA-256: <span className="mono">{stats.input_sha256}</span></p>
      <div className="sheet sheet-body">
        <BarList title={`${hit.length} of ${all.length} checks found rows to flag`} sub="Rows flagged per check (a row can carry several flags)."
                 source="data-quality flags written at ingest" rows={hit.map(([k, v]) => ({ key: k, label: k, count: v }))} />
      </div>
      <div className="sheet">
        <table className="tbl">
          <thead><tr><th>Check</th><th>Rule</th><th className="num">Rows flagged</th></tr></thead>
          <tbody>
            {hit.map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{DQ_RULES[k] ?? ''}</td><td className="num">{v.toLocaleString('en-IN')}</td></tr>)}
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
      <div className="sheet">
        <div className="sheet-head"><h2>Load and index time: {total.toFixed(2)} s</h2>
          {detect !== undefined && <span className="small muted">then mule detection {detect.toFixed(2)} s</span>}</div>
        <table className="tbl"><tbody>
          {stages.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.toFixed(2)} s</td></tr>)}
        </tbody></table>
      </div>
    </div>
  )
}
