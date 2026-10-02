import { Graph } from '@phosphor-icons/react'
import type { KeyboardEvent } from 'react'
import { useCopy } from '../copy'
import { inr, ROLE_TEXT, tPlus } from '../format'
import { LAYERS, type Trail } from '../trail'
import type { TraceResult } from '../types'

interface Props {
  trace: TraceResult
  trail: Trail
  cutoff: number
  selected: string | null
  onSelect: (a: string) => void
  onRing: (a: string) => void
}

/** The answer: every account the victim's money reached, by layer, freeze-first (most still held on top). */
export function Register({ trace, trail, cutoff, selected, onSelect, onRing }: Props) {
  const c = useCopy()
  let no = 0
  const key = (a: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a) } }
  return (
    <section className="sheet register" aria-labelledby="reg-h">
      <div className="sheet-head">
        <h2 id="reg-h">{c.register}</h2>
        <span className="small muted">{c.registerNote}</span>
      </div>
      <div className="scroll">
        {LAYERS.map((role) => {
          const rows = trace.nodes.filter((n) => n.role === role)
            .sort((a, b) => b.held_paise - a.held_paise || (a.first_in_ts ?? '').localeCompare(b.first_in_ts ?? ''))
          const rec = rows.reduce((s, n) => s + n.received_paise, 0)
          const held = rows.reduce((s, n) => s + n.held_paise, 0)
          return (
            <section key={role} className="reg-group" data-role={role} aria-label={ROLE_TEXT[role]}>
              <header>
                <h3><span className={`key ${role}`} />{ROLE_TEXT[role]}</h3>
                <span className="small muted">{rows.length} account{rows.length === 1 ? '' : 's'} · received {inr(rec)}
                  {held > 0 && <> · <span className="held">still held {inr(held)}</span></>}</span>
              </header>
              {rows.length === 0 ? <p className="small muted" style={{ padding: '6px 14px' }}>None on this trail.</p> : (
                <table className="tbl">
                  <thead><tr><th className="no">No.</th><th>Account</th><th>Bank</th><th>Money arrived</th>
                    <th className="num">Received</th><th className="num">Still held</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody className="stagger">
                    {rows.map((n, i) => {
                      no += 1
                      const t = trail.arrival.get(n.account)
                      return (
                        <tr key={n.account} className={`click${t !== undefined && t > cutoff ? ' future' : ''}`} tabIndex={0}
                            aria-selected={n.account === selected} onClick={() => onSelect(n.account)} onKeyDown={key(n.account)}
                            style={{ ['--i' as string]: i }}>
                          <td className="no">{no}</td>
                          <td className="acct">{n.account}</td>
                          <td>{n.bank_name}</td>
                          <td className="nw" title={n.first_in_ts ?? ''}>{t !== undefined ? tPlus(t - trail.t0) : '-'}</td>
                          <td className="num">{inr(n.received_paise)}</td>
                          <td className="num">{n.held_paise > 0 ? <span className="held">{inr(n.held_paise)}</span> : <span className="muted">nil</span>}</td>
                          <td className="row-acts">
                            <button className="btn ghost sm" title={`Isolate the ring around ${n.account}`} aria-label={`Isolate ring around ${n.account}`}
                                    onClick={(e) => { e.stopPropagation(); onRing(n.account) }}><Graph /> Ring</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
