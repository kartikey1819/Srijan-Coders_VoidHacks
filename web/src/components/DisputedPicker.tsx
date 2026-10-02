import { useEffect, useState } from 'react'
import { api } from '../api'
import { inr } from '../format'
import type { TxnRow } from '../types'

interface Props { victim: string; seeds: number[] | null; auto?: number | null; onApply: (seeds: number[] | null) => void }

/** When the victim also has ordinary spending, trace only the transfer(s) the complainant disputes. */
/** auto: how many transfers the engine chose by itself (the victim's transfers to suspicious accounts), if it did. */
export function DisputedPicker({ victim, seeds, auto = null, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<TxnRow[] | null>(null)
  const [pick, setPick] = useState<Set<number>>(new Set(seeds ?? []))
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { setPick(new Set(seeds ?? [])) }, [seeds])
  useEffect(() => {
    if (!open || rows) return
    api.txns(victim, 1000).then((t) => setRows(t.filter((x) => x.sender === victim)))
      .catch((e) => setErr(String((e as Error).message)))
  }, [open, rows, victim])

  const toggle = (i: number) => setPick((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n })

  return (
    <div className="sheet sheet-body picker">
      <div className="row between">
        <span className="small">
          {seeds ? <>Tracing <b>{seeds.length}</b> disputed transfer(s) only.</>
                 : auto ? <>Tracing the <b>{auto}</b> transfer(s) that went to suspicious accounts (score 40 or more).</>
                 : <>Tracing <b>all</b> of the victim's outgoing transfers.</>}
        </span>
        <button className="btn ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Choose disputed transfer(s)'}</button>
      </div>
      {open && (
        <>
          {err && <p className="error">{err}</p>}
          {!rows && !err && <p className="muted small">Loading the victim's outgoing transfers…</p>}
          {rows && (
            <table className="tbl small">
              <thead><tr><th></th><th>Time</th><th>To</th><th className="num">Amount</th><th>Narration</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.txn_idx} className="click" onClick={() => toggle(t.txn_idx)}>
                    <td><input type="checkbox" checked={pick.has(t.txn_idx)} onChange={() => toggle(t.txn_idx)}
                               aria-label={`Disputed: ${t.transaction_id}`} /></td>
                    <td className="mono nw">{t.ts}</td><td className="acct">{t.receiver}</td>
                    <td className="num">{inr(t.amount_paise)}</td><td className="narr">{t.narration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row gap">
            <button className="btn primary" disabled={pick.size === 0} onClick={() => onApply([...pick].sort((a, b) => a - b))}>
              Trace selected ({pick.size})</button>
            <button className="btn" onClick={() => onApply(null)}>Use all outgoing transfers</button>
          </div>
        </>
      )}
    </div>
  )
}
