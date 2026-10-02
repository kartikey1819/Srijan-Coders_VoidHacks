import { Bank, Desktop, Globe, Snowflake, User, Users, Wallet } from '@phosphor-icons/react'
import type { ComponentType, ReactNode } from 'react'
import { inr, inrShort, toEpoch } from '../../format'
import type { TraceResult, TxnRow } from '../../types'
import { RoleBadge } from '../Page'
import { after, duration, plainWarning, when, type Signs, type TraceView } from './model'

const roleVar = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()})` : 'var(--victim)')

/** The money's journey as stations: victim, collectors, distributors, cash-out, and what can still be frozen. */
export function JourneyStrip({ t, v }: { t: TraceResult; v: TraceView }) {
  type St = { k: string; icon: ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>; big: string; label: string; sub: string; gap?: string }
  const st: St[] = [{ k: 'VICTIM', icon: User, big: inrShort(t.loss_paise), label: 'taken from victim', sub: v.victim.account }]
  const add = (k: 'L1' | 'L2' | 'L3', one: string, many: string, verb: string) => {
    if (!v.counts[k]) return
    st.push({ k, icon: k === 'L1' ? Wallet : k === 'L2' ? Users : Bank, big: String(v.counts[k]), label: v.counts[k] === 1 ? one : many,
              sub: `${inrShort(v.received[k])} ${verb}`, gap: v.firstAt[k] !== undefined ? after(v.firstAt[k]! - v.t0) : '' })
  }
  add('L1', 'collector', 'collectors', 'received')
  add('L2', 'distributor', 'distributors', 'passed on')
  add('L3', 'cash-out account', 'cash-out accounts', 'landed')
  st.push({ k: 'OK', icon: Snowflake, big: inrShort(v.freezeTotal), label: 'can still be frozen',
            sub: `${v.freeze.length} account${v.freeze.length === 1 ? '' : 's'} · ${v.freezeBanks} bank${v.freezeBanks === 1 ? '' : 's'}`,
            gap: after(v.spanS) })
  return (
    <ol className="jstrip" aria-label="Where the victim's money went">
      {st.map((s, i) => (
        <li key={s.k} className="j-wrap">
          {i > 0 && (
            <div className="j-gap" aria-hidden="true"><span>{s.gap}</span>
              <svg width="100%" height="12" preserveAspectRatio="none" viewBox="0 0 100 12">
                <path d="M0,6 H92 M86,1 L94,6 L86,11" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke"
                      style={{ stroke: s.k === 'OK' ? 'var(--ok)' : roleVar(s.k) }} /></svg>
            </div>
          )}
          <div className={`j-st j-${s.k}`}>
            <span className="j-ic"><s.icon size={20} weight="fill" /></span>
            <b className="j-big">{s.big}</b>
            <span className="j-lbl">{s.label}</span>
            <span className="j-sub">{s.sub}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Donut({ pct, color, center, sub, size = 96 }: { pct: number; color: string; center: string; sub: string; size?: number }) {
  const stroke = 11, r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-ring" role="img" aria-label={`${center} ${sub}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'var(--grid)' }} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="donut-arc"
              strokeDasharray={`${(c * p) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ stroke: color }} />
      <text x="50%" y="49%" textAnchor="middle" className="donut-c" style={{ fill: color }}>{center}</text>
      <text x="50%" y="67%" textAnchor="middle" className="donut-s">{sub}</text>
    </svg>
  )
}

/** Victim, then 1 → n → m dots per layer. */
function FanMini({ counts }: { counts: Record<'L1' | 'L2' | 'L3', number> }) {
  const cols = ([['VICTIM', 1], ['L1', counts.L1], ['L2', counts.L2], ['L3', counts.L3]] as [string, number][]).filter(([, n]) => n > 0)
  const W = 150, H = 96, show = (n: number) => Math.min(n, 8)
  const pts = cols.map(([k, n], ci) => Array.from({ length: show(n) }, (_, i) => ({
    k, x: 12 + (ci * (W - 24)) / Math.max(1, cols.length - 1), y: H / 2 - 6 + (i - (show(n) - 1) / 2) * 10,
  })))
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="fan">
      {pts.slice(1).map((col, ci) => col.map((p, i) => {
        const prev = pts[ci], q = prev[Math.min(prev.length - 1, Math.floor((i * prev.length) / col.length))]
        return <path key={`${ci}-${i}`} d={`M${q.x},${q.y} C${(q.x + p.x) / 2},${q.y} ${(q.x + p.x) / 2},${p.y} ${p.x},${p.y}`}
                     fill="none" strokeWidth="1.4" style={{ stroke: roleVar(p.k), opacity: 0.55 }} />
      }))}
      {pts.flat().map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" style={{ fill: roleVar(p.k) }} />)}
      {cols.map(([k, n], ci) => <text key={k} x={pts[ci][0].x} y={H - 2} textAnchor="middle" className="fan-t" style={{ fill: roleVar(k) }}>{k === 'VICTIM' ? 'V' : n}</text>)}
    </svg>
  )
}

function IconStat({ icon: Icon, color, value, label }: { icon: ComponentType<{ size?: number }>; color: string; value: ReactNode; label: string }) {
  return (
    <div className="istat">
      <span className="istat-ic" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}><Icon size={16} /></span>
      <div><b style={{ color }}>{value}</b><span>{label}</span></div>
    </div>
  )
}

/** Four plain answers: how fast, how wide, how organised, how much can be recovered. */
export function Insights({ t, v, signs }: { t: TraceResult; v: TraceView; signs: Signs | null }) {
  const moved = t.loss_paise - v.freezeTotal
  return (
    <div className="insights">
      <section className="gpanel ig" aria-label="How fast the money moved">
        <h3>How fast the money moved</h3>
        {v.collector && v.passMin !== null ? (
          <div className="ig-row">
            <Donut pct={v.passPct} color="var(--l1)" center={`${v.passPct}%`} sub="moved out" />
            <p className="ig-fig" style={{ color: 'var(--l1)' }}>{duration(v.passMin * 60)}
              <small>for the collector account to pass on the victim's money. Genuine accounts rarely do this.</small></p>
          </div>
        ) : <p className="muted">No collector account passed money on.</p>}
      </section>
      <section className="gpanel ig" aria-label="How widely it was spread">
        <h3>How widely it was spread</h3>
        <div className="ig-row">
          <FanMini counts={v.counts} />
          <p className="ig-fig" style={{ color: 'var(--l2)' }}>{v.mules.length} accounts<small>in {v.banks.length} bank{v.banks.length === 1 ? '' : 's'}</small></p>
        </div>
        <div className="bchips">{v.banks.map((b) => <span key={b}>{b}</span>)}</div>
      </section>
      <section className="gpanel ig" aria-label="Signs of an organised operation">
        <h3>Signs of an organised operation</h3>
        {signs ? (
          <div className="ig-row">
            <Donut pct={signs.automatedPct} color="var(--l3)" center={`${signs.automatedPct}%`} sub="automated" />
            <div className="istats">
              <IconStat icon={Globe} color="var(--held)" value={signs.proxy}
                        label={`transfers from foreign proxy IPs${signs.ranges.length ? ` (${signs.ranges.join(', ')})` : ''}`} />
              <IconStat icon={Desktop} color="var(--l2)" value={signs.script} label="transfers by scripts or emulators" />
              <IconStat icon={Wallet} color="var(--l3)" value={signs.cashout} label="cash-outs to wallets or crypto" />
            </div>
          </div>
        ) : <p className="muted">Reading the transfers…</p>}
      </section>
      <section className="gpanel ig" aria-label="Amount that can be recovered">
        <h3>Amount that can be recovered</h3>
        <div className="ig-row">
          <Donut pct={v.recPct} color="var(--ok)" center={`${v.recPct}%`} sub="recoverable" />
          <p className="ig-fig" style={{ color: 'var(--ok)' }}>{inrShort(v.freezeTotal)}
            <small>held in {v.freeze.length} account{v.freeze.length === 1 ? '' : 's'} at {v.freezeBanks} bank{v.freezeBanks === 1 ? '' : 's'}</small></p>
        </div>
        <div className="split" role="img" aria-label={`${inr(v.freezeTotal)} can be frozen, ${inr(moved)} already withdrawn or moved on`}>
          <i style={{ width: `${(100 * v.freezeTotal) / Math.max(1, t.loss_paise)}%`, background: 'var(--ok)' }} />
          <i style={{ width: `${(100 * moved) / Math.max(1, t.loss_paise)}%`, background: 'var(--bar-off)' }} />
        </div>
        <div className="split-lg"><span><b style={{ background: 'var(--ok)' }} />Can be frozen <em>{inrShort(v.freezeTotal)}</em></span>
          <span><b style={{ background: 'var(--bar-off)' }} />Already withdrawn or moved on <em>{inrShort(moved)}</em></span></div>
      </section>
    </div>
  )
}

/** The collector's own ledger right after the victim's credit: the credit up, its debits down, the balance draining. */
export function PassWindow({ t, v }: { t: TraceResult; v: TraceView }) {
  const c = v.collector
  if (!c) return <p className="muted">There is no collector account on this trail.</p>
  const credit = t.edges.filter((e) => e.dst === c.account && e.rule === 'seed').sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))[0]
    ?? t.edges.filter((e) => e.dst === c.account).sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))[0]
  const debits = t.edges.filter((e) => e.src === c.account).sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))
  if (!credit || !debits.length) return <p className="muted">The collector has not passed any money on.</p>
  const W = 760, H = 270, AX = 150, L = 40, R = 30
  const ct = toEpoch(credit.ts), amount = credit.attributed_paise
  const off = (ts: string) => (toEpoch(ts) - ct) / 60
  const lastM = off(debits[debits.length - 1].ts)
  const win = lastM <= 15 ? 15 : Math.min(60, Math.ceil(lastM / 5) * 5)
  const inWin = debits.filter((e) => off(e.ts) <= win)
  const x = (m: number) => L + (Math.min(Math.max(m, 0), win) / win) * (W - L - R)
  const outSum = inWin.reduce((s, e) => s + e.attributed_paise, 0)
  const pct = Math.round((100 * outSum) / amount)
  const receivers = new Set(inWin.map((e) => e.dst)).size
  const first = Math.max(0, off(debits[0].ts)), fm = Math.floor(first), fs = Math.round((first - fm) * 60)
  const yb = (val: number) => AX - (96 * val) / amount
  let bal = amount, path = `M${x(0) + 6},${yb(bal)}`
  for (const e of inWin) { path += ` H${x(off(e.ts))}`; bal = Math.max(0, bal - e.attributed_paise); path += ` V${yb(bal)}` }
  path += ` H${x(win)}`
  const leftPct = Math.round((100 * bal) / amount)
  return (
    <svg className="win" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`${inr(amount)} arrives at ${c.account}; ${inWin.length} debits to ${receivers} accounts within ${win} minutes, ${pct}% passed on`}>
      <text x={(x(0) + x(win)) / 2} y={18} textAnchor="middle" className="w-cap">First {win} minutes after the credit</text>
      {Array.from({ length: win / 5 + 1 }, (_, i) => (
        <g key={i}>
          <line x1={x(i * 5)} x2={x(i * 5)} y1={40} y2={H - 30} className="w-grid" />
          <text x={x(i * 5)} y={H - 10} textAnchor="middle" className="w-tick">{i * 5}{i === 0 || i === win / 5 ? ' min' : ''}</text>
        </g>
      ))}
      <line x1={L - 30} x2={W - R + 20} y1={AX} y2={AX} className="w-axis" />
      <path d={`${path} V${AX} H${x(0) + 6} Z`} style={{ fill: 'var(--victim)', opacity: 0.09 }} />
      <path d={path} fill="none" strokeWidth="1.6" style={{ stroke: 'var(--victim)', opacity: 0.6 }} />
      <text x={x(win) - 4} y={yb(bal) - 8} textAnchor="end" className="w-bal">balance left: {inr(bal)} ({leftPct}%)</text>
      <rect x={x(0) - 5} y={AX - 96} width={10} height={96} rx="2" style={{ fill: 'var(--victim)' }} />
      <text x={x(0) + 14} y={AX - 80} className="w-big">{inr(amount)} arrives</text>
      <text x={x(0) + 14} y={AX - 62} className="w-note">from the victim · {credit.ts.slice(11, 16)}</text>
      {inWin.map((e, i) => (
        <rect key={i} x={x(off(e.ts)) - 5} y={AX + 1} width={10} height={Math.max(4, (e.attributed_paise / amount) * 96)} rx="2"
              style={{ fill: 'var(--l1)' }}><title>{`${e.ts.slice(11)} · ${inr(e.attributed_paise)} → ${e.dst}`}</title></rect>
      ))}
      <line x1={x(first)} x2={x(first)} y1={AX - 34} y2={AX - 6} className="w-axis" />
      <text x={x(first)} y={AX - 40} textAnchor={first < win * 0.15 ? 'start' : 'middle'} className="w-note">first debit after {fm} min {fs} s</text>
      <text x={W - R} y={AX - 50} textAnchor="end" className="w-big">{inWin.length} debit{inWin.length === 1 ? '' : 's'} to {receivers} different account{receivers === 1 ? '' : 's'}</text>
      <text x={W - R} y={AX - 30} textAnchor="end" className="w-note">{inr(outSum)} out = {pct}% of the credit</text>
    </svg>
  )
}

/** How this result was produced, in plain words, with the engine's own warnings. */
export function TraceRecord({ t, v, hops, wallMs, signs, chosen }: {
  t: TraceResult; v: TraceView; hops: number; wallMs: number; signs: Signs | null; chosen: boolean
}) {
  const of = (r: string) => v.mules.filter((n) => n.role === r).map((n) => n.account)
  const list = (a: string[]) => (a.length ? (a.length > 6 ? `${a.slice(0, 6).join(', ')} and ${a.length - 6} more` : a.join(', ')) : 'None found')
  const seedTotal = v.seeds.reduce((s, e) => s + e.attributed_paise, 0)
  const rows: [string, ReactNode][] = [
    ['Victim account', `${v.victim.account}, ${v.victim.bank_name} (${v.victim.ifsc})`],
    ['Payments followed', `${v.seeds.length} payment${v.seeds.length === 1 ? '' : 's'}${chosen ? ' chosen by the officer' : ''}, total ${inr(seedTotal)}, first on ${when(v.seeds[0]?.ts ?? '')}`],
    ['How far', `Up to ${hops} transfer${hops === 1 ? '' : 's'} away from the victim`],
    ['Method', 'Each account is replayed as a ledger in time order. A payment out is matched first to money that arrived 3 to 15 minutes earlier, then to a credit it passes on at 90% or more; otherwise the account holder\'s own money is treated as spent first. Every rupee is accounted for.'],
    ['Layer 1 · Collector', list(of('L1'))],
    ['Layer 2 · Distributor', list(of('L2'))],
    ['Layer 3 · Cash-out', list(of('L3'))],
    ['Warning signs', signs ? `${signs.proxy} foreign proxy session${signs.proxy === 1 ? '' : 's'}, ${signs.script} automated session${signs.script === 1 ? '' : 's'}, ${signs.cashout} wallet or crypto cash-out${signs.cashout === 1 ? '' : 's'}` : '…'],
    ['Points to check', t.warnings.length ? <ul>{t.warnings.map((w) => <li key={w}>{plainWarning(w)}</li>)}</ul> : 'None'],
    ['Time taken', `${t.elapsed_ms} ms on this computer, ${Math.round(wallMs)} ms to show (limit: 2 seconds)`],
  ]
  return (
    <dl className="record">
      {rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
    </dl>
  )
}

export function FreezeTable({ v, onOpen }: { v: TraceView; onOpen: (a: string) => void }) {
  if (!v.freeze.length) return <p className="gpanel-b muted">No account on this trail still holds the victim's money.</p>
  return (
    <div className="tscroll">
      <table className="gtbl">
        <thead><tr><th>Account</th><th>Bank and IFSC</th><th>Role</th><th className="num">Amount held</th></tr></thead>
        <tbody>{v.freeze.map((n) => (
          <tr key={n.account} className="click" tabIndex={0} onClick={() => onOpen(n.account)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(n.account) }}>
            <td className="mono strong">{n.account}</td>
            <td>{n.bank_name}<div className="mono sub">{n.ifsc}</div></td>
            <td><RoleBadge role={n.role} /></td>
            <td className="num strong">{inr(n.held_paise)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}

const human = (d: string) => d.replaceAll('_', ' ').toLowerCase()
export function TxnTable({ t, rows }: { t: TraceResult; rows: Map<number, TxnRow> }) {
  const edges = [...t.edges].sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts) || a.txn_idx - b.txn_idx)
  return (
    <div className="tscroll">
      <table className="gtbl">
        <thead><tr><th>Time</th><th>From</th><th>To</th><th>Mode and device</th><th className="num">Victim's money</th></tr></thead>
        <tbody>{edges.map((e) => {
          const r = rows.get(e.txn_idx)
          return (
            <tr key={e.txn_idx}>
              <td className="nw">{e.ts.slice(11)}<div className="mono sub">{e.transaction_id}</div></td>
              <td className="mono">{e.src}</td>
              <td className="mono">{e.dst}</td>
              <td>{e.mode}{r ? ` · ${human(r.device)}` : ''}
                {r?.ip_class === 'foreign_proxy' && <div className="bad-note">foreign proxy {r.ip}</div>}
                {e.terminal && <div className="sub">cash-out to wallet or crypto</div>}</td>
              <td className="num strong">{inr(e.attributed_paise)}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}
