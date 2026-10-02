import { Bank, ShareNetwork, ShieldCheck, Users, Wallet } from '@phosphor-icons/react'
import { arc, pie } from 'd3-shape'
import { useState, type ComponentType, type CSSProperties } from 'react'
import { inr, inrShort } from '../format'
import { go } from '../route'
import type { CountRow, DQSummary, FlowLayer, FlowSummary } from '../types'
import { after } from './trace/model'
import { CountUp } from './trace/TraceParts'
import { BankIcon } from './BankIcon'

type Icon = ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>
const delay = (i: number, step = 90): CSSProperties => ({ ['--d' as string]: `${i * step}ms` })
const pct = (x: number | null) => (x === null ? '-' : `${Math.round(100 * x)}%`)
const n = (x: number) => x.toLocaleString('en-IN')
const each = (x: number | null) => (x === null ? '-' : x.toFixed(1))
const STATION: Record<FlowLayer['role'], { title: string; icon: Icon; color: string }> = {
  VICTIM: { title: 'Victims', icon: Users, color: 'victim' },
  L1: { title: 'Collectors', icon: Wallet, color: 'l1' },
  L2: { title: 'Distributors', icon: ShareNetwork, color: 'l2' },
  L3: { title: 'Cash-out', icon: Bank, color: 'l3' },
}

/** The Dashboard's first view: the victims' money through the three mule layers, case-wide, with what can still be
 *  frozen beside it and the accounts behind it underneath. Every figure comes from tracing each victim once. */
export function CaseFlow({ f, stats, days, banks }: { f: FlowSummary; stats: DQSummary | null; days: string[]; banks: CountRow[] }) {
  const [V, L1, L2, L3] = (['VICTIM', 'L1', 'L2', 'L3'] as const).map((r) => f.layers.find((l) => l.role === r)!)
  const secs = stats ? Object.values(stats.ingest_seconds).reduce((s, x) => s + x, 0) : null
  const open = (role: string) => go({ name: 'flagged', role, bank: null, reason: null })
  const stations = [
    { l: V, big: f.victims, unit: 'victims', money: <><b>{inrShort(f.loss_paise)}</b> lost</>,
      notes: [`Avg loss ${inrShort(f.avg_loss_paise)}`, `Max loss ${inrShort(f.max_loss_paise)}`],
      onOpen: () => go({ name: 'investigate', account: null, seeds: null }), hint: 'Choose a victim to trace' },
    { l: L1, big: L1.accounts, unit: 'accounts', money: <><b>{inrShort(L1.received_paise)}</b> received</>,
      notes: [`${pct(L1.fast_share)} out in 15 min`, `${each(L1.per_account)} victims each`], onOpen: () => open('L1'), hint: 'Open the collector accounts' },
    { l: L2, big: L2.accounts, unit: 'accounts', money: <><b>{inrShort(L2.passed_on_paise)}</b> passed on</>,
      notes: [`${pct(L2.fast_share)} out in 1 hour`, `${each(L2.per_account)} cash-outs each`], onOpen: () => open('L2'), hint: 'Open the distributor accounts' },
    { l: L3, big: L3.accounts, unit: 'accounts', money: <><b>{inrShort(L3.received_paise)}</b> landed</>,
      notes: [`${pct(L3.wallet_share)} crypto / wallet`, 'Money stops here'], onOpen: () => open('L3'), hint: 'Open the cash-out accounts' },
  ]
  const arrows = [
    { amt: L1.received_paise, when: 'at once' },
    { amt: L1.passed_on_paise, when: f.to_l2_s === null ? '' : after(f.to_l2_s) },
    { amt: L3.received_paise, when: f.to_l3_s === null ? '' : after(f.to_l3_s) },
  ]
  return (
    <section className="gpanel cflow" aria-label="Where the victims' money went">
      <div className="cf-main">
        <header className="cf-head">
          <h2>Where the victims' money went</h2>
          <p className="muted small">
            {stats && <>{n(stats.rows)} transactions · </>}
            {days.length > 0 && <>{days[0]} to {days[days.length - 1]} · </>}
            {secs !== null && <>analysed in {secs.toFixed(1)} s {secs <= 60 ? '(within the 60 s target)' : '(above the 60 s target)'}</>}
          </p>
        </header>
        <div className="cf-chain">
          {stations.map((s, i) => {
            const st = STATION[s.l.role]
            return (
              <div key={s.l.role} className="cf-step">
                {i > 0 && <Arrow i={i} from={STATION[stations[i - 1].l.role].color} to={st.color} {...arrows[i - 1]} />}
                <button className={`cf-st ${st.color}`} style={delay(i, 110)} onClick={s.onOpen} title={s.hint}>
                  <span className="cf-st-h"><st.icon size={15} weight="fill" />{st.title}</span>
                  <span className="cf-big"><CountUp value={s.big} format={(x) => n(Math.round(x))} /><small>{s.unit}</small></span>
                  <span className="cf-money">{s.money}</span>
                  <ul>{s.notes.map((t) => <li key={t}>{t}</li>)}</ul>
                </button>
              </div>
            )
          })}
        </div>
        <div className="cf-lower">
          <AccountsDonut accounts={stats?.accounts ?? 0} f={f} onOpen={open} />
          <dl className="cf-notes">
            <dt>Banks to notify</dt>
            <dd>{banks.length ? <>{banks.length} bank{banks.length === 1 ? '' : 's'} hold suspect accounts; most are with {banks[0].label}.
              {f.banks.length > 0 && <> Each gets a debit-hold notice for the victims' money it holds:</>}</> : 'No suspect accounts.'}
              {f.banks.length > 0 && (
                <ul className="cf-bklist">
                  {f.banks.map((b) => (
                    <li key={b.bank}><a href={`#flagged?bank=${b.bank}`} title={`${b.bank_name}: ${inr(b.held_paise)} in ${n(b.accounts)} accounts`}>
                      <BankIcon bank={b.bank} label /><span>{n(b.accounts)} a/c</span><b>{inrShort(b.held_paise)}</b></a></li>
                  ))}
                </ul>
              )}</dd>
            <dt>Linked network</dt>
            <dd>{f.linked_groups <= 1 ? <>All {n(f.suspects)} suspect accounts are connected to one another.</>
              : <>{n(f.linked_groups)} separate groups; the largest holds {n(f.linked_largest)} of the {n(f.suspects)} suspect accounts.</>}</dd>
            <dt>Circular routing</dt>
            <dd>{f.sent_back === 0 ? 'None. No money was sent back to an earlier account.' : <>{n(f.sent_back)} transfer{f.sent_back === 1 ? '' : 's'} sent money back to an earlier account.</>}</dd>
          </dl>
        </div>
      </div>
      <Freeze f={f} layers={[L3, L2, L1]} banks={banks} onOpen={open} />
    </section>
  )
}

/** Amount on top, a continuously flowing arrow from one layer's colour to the next, time since the victim paid below. */
function Arrow({ amt, when, from, to, i }: { amt: number; when: string; from: string; to: string; i: number }) {
  const id = `cfa-${i}`
  return (
    <div className="cf-arrow" style={delay(i, 110)} aria-label={`${inr(amt)} moved, ${when}`}>
      <b>{inrShort(amt)}</b>
      <svg viewBox="0 0 60 14" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="60" y2="0"><stop offset="0" stopColor={`var(--${from})`} /><stop offset="1" stopColor={`var(--${to})`} /></linearGradient></defs>
        <path d="M0,7 H50" stroke={`url(#${id})`} strokeWidth="5" />
        <path className="cf-flow" d="M0,7 H50" />
        <path d="M48,1 L60,7 L48,13 Z" fill={`var(--${to})`} />
      </svg>
      <span>{when}</span>
    </div>
  )
}

function Freeze({ f, layers, banks, onOpen }: { f: FlowSummary; layers: FlowLayer[]; banks: CountRow[]; onOpen: (role: string) => void }) {
  const share = f.loss_paise ? f.freezable_paise / f.loss_paise : 0
  const top = Math.max(1, ...layers.map((l) => l.held_paise))
  const NAME: Record<string, string> = { L1: 'Collector accounts', L2: 'Distributor accounts', L3: 'Cash-out accounts' }
  return (
    <aside className="cf-freeze" aria-label="Money that can still be frozen">
      <div className="cf-fz-top">
        <span className="cf-fz-ic"><ShieldCheck size={20} weight="fill" /></span>
        <div><span className="cf-fz-l">Can still be frozen</span>
          <b className="cf-fz-amt"><CountUp value={f.freezable_paise} format={inrShort} /></b></div>
        <b className="cf-fz-pct">{(100 * share).toFixed(1)}%</b>
      </div>
      <span className="cf-fz-bar"><i style={{ transform: `scaleX(${Math.min(1, share)})` }} /></span>
      <p className="small">of {inr(f.loss_paise)} taken from {n(f.victims)} victims is still in mule accounts.
        All victims were traced in {f.traced_ms < 1000 ? `${f.traced_ms} ms` : `${(f.traced_ms / 1000).toFixed(1)} s`}.</p>
      <h3>Where the recoverable money is held</h3>
      <ul className="cf-held">
        {layers.map((l, i) => (
          <li key={l.role}><span>{NAME[l.role]}</span>
            <span className="cf-held-t"><i style={{ transform: `scaleX(${l.held_paise / top})`, background: `var(--${l.role.toLowerCase()})`, ...delay(i, 110) }} /></span>
            <b>{inrShort(l.held_paise)}</b></li>
        ))}
      </ul>
      <Actions f={f} layers={layers} banks={banks} onOpen={onOpen} />
    </aside>
  )
}

/** Every account in the file, by what the trails found it to be; a slice or row opens the accounts behind it. */
function AccountsDonut({ accounts, f, onOpen }: { accounts: number; f: FlowSummary; onOpen: (role: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const lay = (r: string) => f.layers.find((l) => l.role === r)?.accounts ?? 0
  const mules = lay('L1') + lay('L2') + lay('L3')
  const other = Math.max(0, f.suspects - mules)
  const rows = [
    { k: 'REG', label: 'Regular', count: Math.max(0, accounts - f.victims - mules - other), color: 'var(--bar-off)' },
    { k: 'VICTIM', label: 'Victims', count: f.victims, color: 'var(--victim)' },
    { k: 'L1', label: 'Collectors', count: lay('L1'), color: 'var(--l1)' },
    { k: 'L2', label: 'Distributors', count: lay('L2'), color: 'var(--l2)' },
    { k: 'L3', label: 'Cash-out', count: lay('L3'), color: 'var(--l3)' },
    { k: 'OTHER', label: 'Other suspects', count: other, color: 'var(--unknown)' },
  ].filter((r) => r.count > 0)
  const total = Math.max(1, rows.reduce((s, r) => s + r.count, 0))
  const S = 172, R = S / 2
  const slices = pie<typeof rows[number]>().value((r) => r.count).sort(null).padAngle(0.012)(rows)
  const a = arc<(typeof slices)[number]>().innerRadius(R - 20).outerRadius(R - 2).cornerRadius(2)
  const pickable = (k: string) => k === 'L1' || k === 'L2' || k === 'L3'
  const shown = rows.find((r) => r.k === hover)
  return (
    <div className="cf-accts">
      <svg width={S} height={S} viewBox={`${-R} ${-R} ${S} ${S}`} role="img"
           aria-label={rows.map((r) => `${r.label} ${n(r.count)}`).join(', ')}>
        {slices.map((s) => (
          <path key={s.data.k} d={a(s) ?? ''} fill={s.data.color} className={pickable(s.data.k) ? 'click' : ''}
                opacity={hover && hover !== s.data.k ? 0.35 : 1}
                onMouseEnter={() => setHover(s.data.k)} onMouseLeave={() => setHover(null)}
                onClick={() => pickable(s.data.k) && onOpen(s.data.k)} />
        ))}
        <text y={-2} textAnchor="middle" className="cf-dn-c">{shown ? `${((100 * shown.count) / total).toFixed(1)}%` : `${((100 * (mules + other)) / total).toFixed(1)}%`}</text>
        <text y={15} textAnchor="middle" className="cf-dn-s">{shown ? shown.label.toLowerCase() : 'mule accounts'}</text>
      </svg>
      <div className="cf-legend">
        <h3>{n(accounts)} accounts checked</h3>
        <ul>
          {rows.map((r) => (
            <li key={r.k} className={hover === r.k ? 'on' : ''} onMouseEnter={() => setHover(r.k)} onMouseLeave={() => setHover(null)}>
              {pickable(r.k)
                ? <button onClick={() => onOpen(r.k)}><i style={{ background: r.color }} />{r.label}</button>
                : <span><i style={{ background: r.color }} />{r.label}</span>}
              <small>{((100 * r.count) / total).toFixed(1)}%</small><b>{n(r.count)}</b>
            </li>
          ))}
        </ul>
        <p className="small muted">Point at a slice for details; click a mule layer to open its accounts.</p>
      </div>
    </div>
  )
}

/** Three things to do today, worked out from the figures above: freeze the biggest pool, notify the banks, and club the
 *  complaints that share a collector (traced together in one click). */
function Actions({ f, layers, banks, onOpen }: { f: FlowSummary; layers: FlowLayer[]; banks: CountRow[]; onOpen: (role: string) => void }) {
  const NAME: Record<string, string> = { L1: 'collector', L2: 'distributor', L3: 'cash-out' }
  const top = [...layers].sort((a, b) => b.held_paise - a.held_paise)[0]
  const group = f.club_top_victims
  return (
    <>
      <h3 className="cf-acts-h">Recommended actions</h3>
      <ol className="cf-acts">
        {top && top.held_paise > 0 && (
          <li><b>Freeze {inrShort(top.held_paise)} in {n(top.accounts)} {NAME[top.role]} accounts first</b>
            <span><button className="btn ghost sm" onClick={() => onOpen(top.role)}>Open these accounts</button> · largest amount in place</span></li>
        )}
        {banks.length > 0 && (
          <li><b>Send debit-hold notices to {banks.length} bank{banks.length === 1 ? '' : 's'}</b>
            <span><a className="btn ghost sm" href={`#flagged?bank=${banks[0].key}`}>Open {banks[0].key} accounts</a> · most suspects ({n(banks[0].count)})</span></li>
        )}
        {f.club_victims > 0 && (
          <li><b>Club {n(f.club_victims)} complaints that share a collector</b>
            <span>{group.length > 1
              ? <><a className="btn ghost sm" href={`#traceall=${group.join(',')}`}>Trace these {group.length} together</a> · paid {f.club_top_collector}</>
              : <>{n(f.club_collectors)} collectors paid by 2+ victims</>}</span></li>
        )}
      </ol>
    </>
  )
}
