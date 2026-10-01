import type { DQSummary } from '../types'

const RULES: Record<string, string> = {
  DUP_TXN_ID: 'Transaction ID shared with a different transaction (all rows kept)',
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
  if (!stats) return <p className="muted page-pad">Loading…</p>
  const total = Object.values(stats.ingest_seconds).reduce((a, b) => a + b, 0)
  return (
    <div className="page-pad narrow">
      <h2>Data quality</h2>
      <p>The bank export is treated as evidence. It was loaded exactly as received
        ({stats.rows.toLocaleString('en-IN')} rows, {stats.accounts.toLocaleString('en-IN')} accounts). Rule breaks are
        flagged and reported here; no row was edited or dropped, and flags never change a risk score.</p>
      <p className="small">Source file SHA-256: <span className="mono">{stats.input_sha256}</span></p>
      <table className="tbl">
        <thead><tr><th>Check</th><th>Rule</th><th className="num">Rows flagged</th></tr></thead>
        <tbody>
          {Object.entries(stats.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <tr key={k}><td className="mono">{k}</td><td>{RULES[k] ?? ''}</td><td className="num">{v.toLocaleString('en-IN')}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>Load and index time</h3>
      <table className="tbl">
        <tbody>
          {Object.entries(stats.ingest_seconds).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.toFixed(2)} s</td></tr>)}
          <tr><th>Total</th><th className="num">{total.toFixed(2)} s</th></tr>
        </tbody>
      </table>
    </div>
  )
}
