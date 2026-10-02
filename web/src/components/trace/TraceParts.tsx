import { Bank, Clock, Globe, Lightning, ShieldCheck, Snowflake, TreeStructure, User, Users, Wallet } from '@phosphor-icons/react'
import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { inr, inrShort, toEpoch } from '../../format'
import { prefersReducedMotion } from '../../look'
import type { TraceResult, TxnRow } from '../../types'
import { RoleBadge } from '../Page'
import { after, plainWarning, when, type Signs, type TraceView } from './model'

const roleVar = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()})` : 'var(--victim)')
const ROLE_PLURAL: Record<string, [string, string]> = { L1: ['collector', 'collectors'], L2: ['distributor', 'distributors'], L3: ['cash-out account', 'cash-out accounts'] }

/** 12 min · 3 h 20 min · 7 days 2 h */
function minutesText(m: number): string {
  if (m < 60) return `${m} min`
  if (m < 48 * 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return `${d} days${h ? ` ${h} h` : ''}`
}

/** A figure that counts up once when a trace opens (ease-out, 700 ms); the final text is always the exact value.
 *  Reduced motion shows the value at once. */
export function CountUp({ value, format, ms = 700 }: { value: number; format: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(value); return }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 3)
      setShown(k >= 1 ? value : value * e)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <span aria-label={format(value)}>{format(shown === value ? value : Math.round(shown))}</span>
}

const delay = (i: number, step = 90): CSSProperties => ({ ['--d' as string]: `${i * step}ms` })

/** The money's journey as stations (victim, each layer, what can still be frozen), then where the money is now. */
export function JourneyStrip({ t, v }: { t: TraceResult; v: TraceView }) {
  type St = { k: string; icon: ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>; big: ReactNode; label: string; sub: string
    gap?: string; share: number }
  const st: St[] = [{ k: 'VICTIM', icon: User, big: <CountUp value={t.loss_paise} format={inrShort} />, label: 'taken from victim',
                      sub: v.victim.account, share: 100 }]
  for (const k of ['L1', 'L2', 'L3'] as const) {
    if (!v.counts[k]) continue
    st.push({ k, icon: k === 'L1' ? Wallet : k === 'L2' ? Users : Bank, big: <CountUp value={v.counts[k]} format={(n) => String(Math.round(n))} />,
              label: ROLE_PLURAL[k][v.counts[k] === 1 ? 0 : 1], sub: `${inrShort(v.received[k])} received`,
              gap: v.firstAt[k] !== undefined ? after(v.firstAt[k]! - v.t0) : '', share: Math.round((100 * v.received[k]) / Math.max(1, t.loss_paise)) })
  }
  st.push({ k: 'OK', icon: Snowflake, big: <CountUp value={v.freezeTotal} format={inrShort} />, label: 'can still be frozen',
            sub: `${v.freeze.length} account${v.freeze.length === 1 ? '' : 's'} · ${v.freezeBanks} bank${v.freezeBanks === 1 ? '' : 's'}`,
            gap: after(v.spanS), share: v.recPct })
  return (
    <>
      <ol className="jstrip" aria-label="Where the victim's money went">
        {st.map((s, i) => (
          <li key={s.k} className="j-wrap">
            {i > 0 && (
              <div className="j-gap" aria-hidden="true" style={delay(i)}>
                <span className="j-pill"><Clock size={12} weight="fill" /> {s.gap}</span>
                <svg width="100%" height="14" preserveAspectRatio="none" viewBox="0 0 100 14">
                  <path className="j-line" pathLength={100} d="M0,7 H93" style={{ stroke: s.k === 'OK' ? 'var(--ok)' : roleVar(s.k) }} />
                  <path className="j-flow" d="M0,7 H93" style={{ stroke: s.k === 'OK' ? 'var(--ok)' : roleVar(s.k) }} />
                  <path d="M87,2 L95,7 L87,12" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke"
                        style={{ stroke: s.k === 'OK' ? 'var(--ok)' : roleVar(s.k) }} />
                </svg>
              </div>
            )}
            <div className={`j-st j-${s.k}`} style={delay(i)}>
              <span className="j-ic"><s.icon size={20} weight="fill" /></span>
              <b className="j-big">{s.big}</b>
              <span className="j-lbl">{s.label}</span>
              <span className="j-sub">{s.sub}</span>
              <span className="j-share" title={`${s.share}% of the money taken`}><i style={{ transform: `scaleX(${Math.min(1, s.share / 100)})` }} /></span>
            </div>
          </li>
        ))}
      </ol>
      <MoneyNow t={t} v={v} />
    </>
  )
}

/** Where the victim's money sits right now, by layer, and how much has already left the trail. */
function MoneyNow({ t, v }: { t: TraceResult; v: TraceView }) {
  const held = { L1: 0, L2: 0, L3: 0 }
  for (const n of v.mules) if (n.role === 'L1' || n.role === 'L2' || n.role === 'L3') held[n.role] += n.held_paise
  const gone = Math.max(0, t.loss_paise - v.freezeTotal)
  const parts = [
    { k: 'L1', label: 'with collectors', value: held.L1, color: 'var(--l1)' },
    { k: 'L2', label: 'with distributors', value: held.L2, color: 'var(--l2)' },
    { k: 'L3', label: 'in cash-out accounts', value: held.L3, color: 'var(--l3)' },
    { k: 'GONE', label: 'already withdrawn or moved on', value: gone, color: 'var(--bar-off)' },
  ].filter((p) => p.value > 0)
  const total = Math.max(1, t.loss_paise)
  return (
    <div className="moneynow">
      <div className="mn-head"><b>Where the money is now</b><span className="muted">of {inr(t.loss_paise)} taken</span></div>
      <div className="mn-bar" role="img" aria-label={parts.map((p) => `${inr(p.value)} ${p.label}`).join(', ')}>
        {parts.map((p, i) => (
          <i key={p.k} style={{ flexGrow: p.value / total, background: p.color, ...delay(i, 120) }} title={`${p.label}: ${inr(p.value)}`} />
        ))}
      </div>
      <ul className="mn-legend">
        {parts.map((p) => (
          <li key={p.k}><b style={{ background: p.color }} /><span className="mn-amt">{inr(p.value)}</span>
            <span className="muted">{p.label} · {Math.round((100 * p.value) / total)}%</span></li>
        ))}
      </ul>
    </div>
  )
}

export function Donut({ pct, color, center, sub, size = 96 }: { pct: number; color: string; center: string; sub: string; size?: number }) {
  const stroke = 11, r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-ring" role="img" aria-label={`${center} ${sub}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'var(--grid)' }} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" className="donut-arc"
              strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ stroke: color, strokeDashoffset: c * (1 - p / 100), ['--c' as string]: c }} />
      <text x="50%" y="49%" textAnchor="middle" className="donut-c" style={{ fill: color }}>{center}</text>
      <text x="50%" y="67%" textAnchor="middle" className="donut-s">{sub}</text>
    </svg>
  )
}

/** Victim, then 1 → n → m dots per layer. */
function FanMini({ counts }: { counts: Record<'L1' | 'L2' | 'L3', number> }) {
  const cols = ([['VICTIM', 1], ['L1', counts.L1], ['L2', counts.L2], ['L3', counts.L3]] as [string, number][]).filter(([, n]) => n > 0)
  const W = 150, H = 92, show = (n: number) => Math.min(n, 8)
  const pts = cols.map(([k, n], ci) => Array.from({ length: show(n) }, (_, i) => ({
    k, x: 12 + (ci * (W - 24)) / Math.max(1, cols.length - 1), y: H / 2 + (i - (show(n) - 1) / 2) * 10,
  })))
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="fan">
      {pts.slice(1).map((col, ci) => col.map((p, i) => {
        const prev = pts[ci], q = prev[Math.min(prev.length - 1, Math.floor((i * prev.length) / col.length))]
        return <path key={`${ci}-${i}`} className="fan-l" pathLength={1} style={{ stroke: roleVar(p.k), ...delay(ci, 160) }}
                     d={`M${q.x},${q.y} C${(q.x + p.x) / 2},${q.y} ${(q.x + p.x) / 2},${p.y} ${p.x},${p.y}`} fill="none" strokeWidth="1.4" />
      }))}
      {pts.flat().map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" style={{ fill: roleVar(p.k) }} />)}
    </svg>
  )
}

function Card({ icon: Icon, color, title, children, foot, i }: {
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>; color: string; title: string; children: ReactNode; foot?: ReactNode; i: number
}) {
  return (
    <section className="gpanel ig" aria-label={title} style={delay(i, 70)}>
      <header className="ig-h"><span className="ig-ic" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}><Icon size={17} weight="fill" /></span>
        <h3>{title}</h3></header>
      <div className="ig-main">{children}</div>
      {foot && <p className="ig-foot">{foot}</p>}
    </section>
  )
}

function Meter({ label, n, of, color, i }: { label: string; n: number; of: number; color: string; i: number }) {
  return (
    <div className="mtr">
      <div className="mt-row"><span>{label}</span><b style={{ color }}>{n}<small> of {of}</small></b></div>
      <span className="mt-track"><i style={{ transform: `scaleX(${of ? n / of : 0})`, background: color, ...delay(i, 110) }} /></span>
    </div>
  )
}

/** Four plain answers, each with a picture: how fast, how wide, how organised, how much can be recovered. */
export function Insights({ t, v, signs }: { t: TraceResult; v: TraceView; signs: Signs | null }) {
  const pm = v.passMin
  // The ruler only needs to read around the 3-15 minute mule pattern; anything past an hour sits at its far end.
  const scale = Math.min(60, Math.max(20, Math.ceil(((pm ?? 0) + 2) / 5) * 5))
  const off = pm !== null && pm > scale
  const at = (m: number) => `${(100 * Math.min(m, scale)) / scale}%`
  const byBank = new Map<string, number>()
  for (const n of v.freeze) byBank.set(n.bank_name, (byBank.get(n.bank_name) ?? 0) + n.held_paise)
  const banks = [...byBank.entries()].sort((a, b) => b[1] - a[1])
  const topBank = Math.max(1, banks[0]?.[1] ?? 1)
  const moved = Math.max(0, t.loss_paise - v.freezeTotal)
  return (
    <div className="insights">
      <Card i={0} icon={Lightning} color="var(--l1)" title="How fast the money moved"
            foot={pm !== null && pm <= 15 ? 'Genuine accounts rarely pass money on this fast.' : pm !== null ? 'Slower than the usual 3 to 15 minute mule pattern.' : undefined}>
        {v.collector && pm !== null ? <>
          <p className="ig-big" style={{ color: 'var(--l1)' }}><CountUp value={Math.round(pm)} format={(n) => minutesText(Math.round(n))} />
            <small>for the collector to pass on {v.passPct}% of the victim's money</small></p>
          <div className="ruler" role="img" aria-label={`${minutesText(Math.round(pm))}; the mule pattern is 3 to 15 minutes`}>
            <span className="r-band" style={{ left: at(3), width: `calc(${at(15)} - ${at(3)})` }}><em>mule pattern 3-15 min</em></span>
            <span className="r-mark" style={{ left: at(pm) }}><i /></span>
            <span className="r-tick" style={{ left: '0%' }}>0</span>
            <span className="r-tick" style={{ left: at(15) }}>15</span>
            <span className="r-tick end">{off ? `${scale} min +` : `${scale} min`}</span>
          </div>
        </> : <p className="muted">No collector account passed money on.</p>}
      </Card>
      <Card i={1} icon={TreeStructure} color="var(--l2)" title="How widely it was spread"
            foot={<span className="bchips">{v.banks.map((b) => <span key={b}>{b}</span>)}</span>}>
        <div className="ig-row">
          <FanMini counts={v.counts} />
          <div>
            <p className="ig-big" style={{ color: 'var(--l2)' }}><CountUp value={v.mules.length} format={(n) => `${Math.round(n)}`} /> accounts
              <small>in {v.banks.length} bank{v.banks.length === 1 ? '' : 's'}</small></p>
            <ul className="ig-layers">
              {(['L1', 'L2', 'L3'] as const).filter((k) => v.counts[k]).map((k) => (
                <li key={k}><b style={{ background: roleVar(k) }} />{v.counts[k]} {ROLE_PLURAL[k][v.counts[k] === 1 ? 0 : 1]}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
      <Card i={2} icon={Globe} color="var(--held)" title="Signs of an organised operation"
            foot={signs?.ranges.length ? `Foreign proxy IP ranges seen: ${signs.ranges.join(', ')}` : undefined}>
        {signs ? (
          <div className="ig-row">
            <Donut pct={signs.automatedPct} color="var(--held)" center={`${signs.automatedPct}%`} sub="automated" />
            <div className="meters">
              <Meter i={0} label="From foreign proxy IPs" n={signs.proxy} of={signs.total} color="var(--held)" />
              <Meter i={1} label="By scripts or emulators" n={signs.script} of={signs.total} color="var(--l2)" />
              <Meter i={2} label="Cashed out to wallets or crypto" n={signs.cashout} of={signs.total} color="var(--l3)" />
            </div>
          </div>
        ) : <p className="muted">Reading the transfers…</p>}
      </Card>
      <Card i={3} icon={ShieldCheck} color="var(--ok)" title="Amount that can be recovered"
            foot={<>Already withdrawn or moved on: <b>{inr(moved)}</b></>}>
        <div className="ig-row">
          <Donut pct={v.recPct} color="var(--ok)" center={`${v.recPct}%`} sub="recoverable" />
          <p className="ig-big" style={{ color: 'var(--ok)' }}><CountUp value={v.freezeTotal} format={inrShort} />
            <small>held in {v.freeze.length} account{v.freeze.length === 1 ? '' : 's'} at {v.freezeBanks} bank{v.freezeBanks === 1 ? '' : 's'}</small></p>
        </div>
        {banks.length > 0 && (
          <ul className="bank-bars" aria-label="Largest amounts to freeze, by bank">
            {banks.slice(0, 3).map(([b, amt], i) => (
              <li key={b}><span className="bb-name">{b}</span>
                <span className="bb-track"><i style={{ transform: `scaleX(${amt / topBank})`, ...delay(i, 110) }} /></span>
                <b>{inrShort(amt)}</b></li>
            ))}
            {banks.length > 3 && <li className="muted bb-more">and {banks.length - 3} more bank{banks.length - 3 === 1 ? '' : 's'}</li>}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** The collector's own ledger right after the victim's money arrived: the facts as four figures, then a plain chart
 *  (money in above the line, each payment out below it, the balance stepping down). */
export function PassWindow({ t, v }: { t: TraceResult; v: TraceView }) {
  const c = v.collector
  if (!c) return <p className="muted">There is no collector account on this trail.</p>
  const credit = t.edges.filter((e) => e.dst === c.account && e.rule === 'seed').sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))[0]
    ?? t.edges.filter((e) => e.dst === c.account).sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))[0]
  const debits = t.edges.filter((e) => e.src === c.account).sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))
  if (!credit || !debits.length) return <p className="muted">The collector has not passed any money on.</p>
  const ct = toEpoch(credit.ts), amount = credit.attributed_paise
  const off = (ts: string) => (toEpoch(ts) - ct) / 60
  const lastM = off(debits[debits.length - 1].ts)
  const win = lastM <= 15 ? 15 : Math.min(60, Math.ceil(lastM / 5) * 5)
  const inWin = debits.filter((e) => off(e.ts) <= win)
  const later = debits.length - inWin.length
  const outSum = inWin.reduce((s, e) => s + e.attributed_paise, 0)
  const left = Math.max(0, amount - outSum)
  const pct = (n: number) => Math.round((100 * n) / amount)
  const receivers = new Set(inWin.map((e) => e.dst)).size
  const first = Math.max(0, (toEpoch(debits[0].ts) - ct))
  const firstText = first < 60 ? `${first} s` : `${Math.floor(first / 60)} min ${String(first % 60).padStart(2, '0')} s`

  const W = 720, H = 190, AX = 92, L = 44, R = 16, UP = 70, DOWN = 70
  const x = (m: number) => L + (Math.min(Math.max(m, 0), win) / win) * (W - L - R)
  const yb = (val: number) => AX - (UP * val) / amount
  let bal = amount, path = `M${x(0)},${yb(bal)}`
  for (const e of inWin) { path += ` H${x(off(e.ts))}`; bal = Math.max(0, bal - e.attributed_paise); path += ` V${yb(bal)}` }
  path += ` H${x(win)}`
  const step = win <= 15 ? 5 : win <= 30 ? 5 : 10

  return (
    <div className="pw">
      <dl className="pw-figs">
        <div><dt>Received from the victim</dt><dd>{inr(amount)}</dd><span>at {credit.ts.slice(11, 16)}</span></div>
        <div><dt>First money out</dt><dd>{firstText}</dd><span>after it arrived</span></div>
        <div><dt>Passed on</dt><dd>{inr(outSum)}</dd>
          <span>{pct(outSum)}% · {inWin.length} payment{inWin.length === 1 ? '' : 's'} to {receivers} account{receivers === 1 ? '' : 's'}</span></div>
        <div><dt>Left in the account</dt><dd className="ok-fig">{inr(left)}</dd><span>{pct(left)}% of what arrived</span></div>
      </dl>
      <svg className="win" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`${inr(amount)} arrived; ${inWin.length} payments out to ${receivers} accounts within ${win} minutes; ${pct(outSum)}% passed on`}>
        {Array.from({ length: win / step + 1 }, (_, i) => (
          <g key={i}>
            <line x1={x(i * step)} x2={x(i * step)} y1={AX - UP - 4} y2={AX + DOWN} className="w-grid" />
            <text x={x(i * step)} y={H - 4} textAnchor={i === win / step ? 'end' : i === 0 ? 'start' : 'middle'} className="w-tick">{i * step}{i === win / step ? ' min' : ''}</text>
          </g>
        ))}
        <text x={L - 8} y={AX - UP / 2} textAnchor="end" className="w-side">in</text>
        <text x={L - 8} y={AX + DOWN / 2} textAnchor="end" className="w-side">out</text>
        <path d={`${path} V${AX} H${x(0)} Z`} style={{ fill: 'var(--victim)', opacity: 0.08 }} />
        <path d={path} fill="none" strokeWidth="1.6" style={{ stroke: 'var(--victim)', opacity: 0.55 }} />
        <rect x={x(0) - 5} y={AX - UP} width={10} height={UP} rx="2" style={{ fill: 'var(--victim)' }}>
          <title>{`${credit.ts.slice(11)} · ${inr(amount)} from the victim`}</title></rect>
        {inWin.map((e, i) => (
          <rect key={i} x={x(off(e.ts)) - 5} y={AX + 1} width={10} height={Math.max(4, (e.attributed_paise / amount) * DOWN)} rx="2"
                style={{ fill: 'var(--l1)' }}><title>{`${e.ts.slice(11)} · ${inr(e.attributed_paise)} to ${e.dst}`}</title></rect>
        ))}
        <line x1={L} x2={W - R} y1={AX} y2={AX} className="w-axis" />
      </svg>
      <p className="pw-key"><span><b style={{ background: 'var(--victim)' }} />money in</span>
        <span><b style={{ background: 'var(--l1)' }} />money out</span>
        <span><i />balance</span>{later > 0 && <span className="muted">{later} later payment{later === 1 ? '' : 's'} not shown</span>}</p>
    </div>
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
