import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { BarList, DailyColumns, LayerDonut, ScoreSpread } from '../charts'
import { inr, REASON_SHORT, ROLE_TEXT } from '../format'
import { go } from '../route'
import type { DQSummary, Overview as OverviewData, VictimCandidate } from '../types'
import { DataInUse } from './DataInUse'
import { Page } from './Page'

/** Plain names for the reason codes on the Overview (the full sentence is the row's detail). */
const REASON_NAME: Record<string, string> = {
  LINKED_TO_FLAGGED: 'Linked to other suspects', FOREIGN_PROXY_IP_OUT: 'Foreign proxy IP', SCRIPT_DEVICE_OUT: 'Script / emulator device',
  TERM_OUT: 'Sent to wallet or crypto', SINK: 'Keeps the money', TERM_IN: 'Received from wallet or crypto',
  TERM_IN_FROM_SCRIPT_OR_FOREIGN: 'Cash-out from script or proxy', PT_STRICT: 'Passed on in 3-15 min', PT_LENIENT: 'Passed on within 15 min',
  FANOUT_EPISODES: 'Split to 3-7 accounts', FANIN_BURST: 'Many senders at once', FANIN_DRAIN: 'Collected then drained', CYCLE: 'Repeated ring',
}

/** The case-load picture: what the engine found in this file, every chart a way into the evidence. */
export function Overview({ stats }: { stats: DQSummary | null }) {
  const [o, setO] = useState<OverviewData | null>(null)
  const [victims, setVictims] = useState<VictimCandidate[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.overview().then(setO).catch((e) => setErr(String(e.message ?? e)))
    api.victims(300).then(setVictims).catch(() => setVictims([]))
  }, [])
  const head = (body: ReactNode) => (
    <Page title="Dashboard" hi="डैशबोर्ड" desc="What this transaction file contains: suspect mule accounts, victims and where the money went."
          actions={<DataInUse stats={stats} />}>{body}</Page>)
  if (err) return head(<div className="banner bad"><b>{err}</b></div>)
  if (!o) return head(<p className="muted">Loading the summary…</p>)
  const flagged = o.bands.HIGH ?? 0
  const totalToFlagged = victims.reduce((s, v) => s + v.out_paise_to_flagged, 0)
  return (
    <Page title="Dashboard" hi="डैशबोर्ड" desc="What this transaction file contains: suspect mule accounts, victims and where the money went."
          actions={<DataInUse stats={stats} />}>
      <section className="gpanel gpanel-b">
        <p className="headline">
          {stats ? <>{stats.rows.toLocaleString('en-IN')} transactions between {o.accounts.toLocaleString('en-IN')} accounts were checked. </> : null}
          <b>{flagged.toLocaleString('en-IN')}</b> accounts behave like money mules, and <b>{victims.length.toLocaleString('en-IN')}</b> victims
          sent <b>{inr(totalToFlagged)}</b> straight to them. Click any chart to see the accounts behind it.
        </p>
      </section>
      <div className="overview">
        <section className="sheet sheet-body w8">
          <ScoreSpread hist={o.score_hist} bands={o.bands} onPick={() => go({ name: 'flagged', role: null, bank: null, reason: null })} />
        </section>
        <section className="sheet sheet-body w4">
          <LayerDonut title="Suspect accounts by role" sub="Collectors take the victim's money, distributors split it, cash-out accounts withdraw it. Click a slice for the list."
                      source="risk table" rows={o.flagged_by_role.map((r) => ({ ...r, label: ROLE_TEXT[r.key] ?? r.label }))}
                      onPick={(k) => go({ name: 'flagged', role: k === 'none' ? null : k, bank: null, reason: null })} />
        </section>
        <section className="sheet sheet-body w6">
          <BarList title="Why accounts were flagged" sub="The behaviour behind each flag. One account usually shows several."
                   source="risk reason codes" total={flagged} max={6}
                   rows={o.flagged_reasons.map((r) => ({ key: r.key, label: REASON_NAME[r.key] ?? REASON_SHORT[r.key] ?? r.key, detail: r.label, count: r.count }))}
                   onPick={(k) => go({ name: 'flagged', role: null, bank: null, reason: k })} />
        </section>
        <section className="sheet sheet-body w6">
          <BarList title="Suspect accounts by bank" sub="Each bank receives its own freeze notice." source="account prefix"
                   total={flagged} max={6} pickHint="View this bank's accounts"
                   rows={o.flagged_by_bank.map((r) => ({ key: r.key, label: r.label, detail: `${r.label} (${r.key}), one freeze notice to its nodal officer`, count: r.count }))}
                   onPick={(k) => go({ name: 'flagged', role: null, bank: k, reason: null })} />
        </section>
        <section className="sheet sheet-body w6">
          <DailyColumns title="Transfers touching flagged accounts, per day" sub="Across the 15-day window of the file (day of month)."
                        source="transactions (usable rows)" days={o.activity.map((d) => ({ day: d.day, value: d.n_flagged }))} />
        </section>
        <section className="sheet w6">
          <div className="sheet-head"><h2>Victims found in this file</h2><span className="small muted">{victims.length} accounts, largest loss first. Click one to trace the money.</span></div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Victim account</th><th className="num">Money sent to mule accounts</th><th>First payment</th></tr></thead>
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
    </Page>
  )
}
