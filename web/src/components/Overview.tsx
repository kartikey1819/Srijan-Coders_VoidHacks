import { useEffect, useState } from 'react'
import { api } from '../api'
import { BarList, DailyColumns, LayerDonut, ScoreSpread } from '../charts'
import { useCopy } from '../copy'
import { inr } from '../format'
import { go } from '../route'
import type { DQSummary, Overview as OverviewData, VictimCandidate } from '../types'

/** The case-load picture: what the engine found in this file, every chart a way into the evidence. */
export function Overview({ stats }: { stats: DQSummary | null }) {
  const c = useCopy()
  const [o, setO] = useState<OverviewData | null>(null)
  const [victims, setVictims] = useState<VictimCandidate[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.overview().then(setO).catch((e) => setErr(String(e.message ?? e)))
    api.victims(300).then(setVictims).catch(() => setVictims([]))
  }, [])
  if (err) return <div className="page"><div className="banner bad"><b>{err}</b></div></div>
  if (!o) return <div className="page"><p className="muted">Loading the case-load summary…</p></div>
  const flagged = o.bands.HIGH ?? 0
  const totalToFlagged = victims.reduce((s, v) => s + v.out_paise_to_flagged, 0)
  return (
    <div className="page">
      <div>
        <h1>{c.overviewTitle}</h1>
        <p className="lede">
          {stats ? <>{stats.rows.toLocaleString('en-IN')} transactions between {o.accounts.toLocaleString('en-IN')} accounts. </> : null}
          The engine flags <b>{flagged.toLocaleString('en-IN')}</b> accounts as likely mules and finds <b>{victims.length.toLocaleString('en-IN')}</b> accounts
          whose money went straight to flagged collectors ({inr(totalToFlagged)} in total). Click any bar to see the accounts behind it.
        </p>
      </div>
      <div className="overview">
        <section className="sheet sheet-body w8">
          <ScoreSpread hist={o.score_hist} bands={o.bands} onPick={() => go({ name: 'flagged', role: null, bank: null, reason: null })} />
        </section>
        <section className="sheet sheet-body w4">
          <LayerDonut title="Flagged accounts by layer" sub="Role each account plays in the chain. Click a slice for the list."
                      source="risk table" rows={o.flagged_by_role}
                      onPick={(k) => go({ name: 'flagged', role: k === 'none' ? null : k, bank: null, reason: null })} />
        </section>
        <section className="sheet sheet-body w6">
          <BarList title="Why accounts were flagged" sub="How many flagged accounts show each signal." source="risk reason codes"
                   rows={o.flagged_reasons} max={8} onPick={(k) => go({ name: 'flagged', role: null, bank: null, reason: k })} />
        </section>
        <section className="sheet sheet-body w6">
          <BarList title="Flagged accounts by bank" sub="Each bank receives its own freeze notice." source="account prefix"
                   rows={o.flagged_by_bank} onPick={(k) => go({ name: 'flagged', role: null, bank: k, reason: null })} />
        </section>
        <section className="sheet sheet-body w6">
          <DailyColumns title="Transfers touching flagged accounts, per day" sub="Across the 15-day window of the file (day of month)."
                        source="transactions (usable rows)" days={o.activity.map((d) => ({ day: d.day, value: d.n_flagged }))} />
        </section>
        <section className="sheet w6">
          <div className="sheet-head"><h2>Victims found in this file</h2><span className="small muted">{victims.length} accounts, largest loss first</span></div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Account</th><th className="num">Sent to flagged collectors</th><th>First transfer</th></tr></thead>
              <tbody>{victims.map((v) => (
                <tr key={v.account} className="click" tabIndex={0} onClick={() => go({ name: 'investigate', account: v.account, seeds: null })}
                    onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'investigate', account: v.account, seeds: null }) }}>
                  <td className="acct"><a href={`#trace=${v.account}`} onClick={(e) => e.stopPropagation()}>{v.account}</a></td>
                  <td className="num">{inr(v.out_paise_to_flagged)}</td><td className="mono nw">{v.first_ts.slice(0, 16)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
