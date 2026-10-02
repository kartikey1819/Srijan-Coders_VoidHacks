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
    <div className="picker">
      <div className="picker-row">
        <span><b>Which payments did the victim report?</b>{' '}
          {seeds ? <>Following the <b>{seeds.length}</b> payment(s) you chose.</>
                 : auto ? <>Following the <b>{auto}</b> payment(s) that went to suspicious accounts.</>
                 : <>Following <b>all</b> of the victim's payments.</>}
        </span>
        <button className="btn" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Choose the reported payments'}</button>
      </div>
      {open && (
        <>
          {err && <p className="error">{err}</p>}
          {!rows && !err && <p className="muted small">Loading the victim's outgoing transfers…</p>}
          {rows && (
            <table className="gtbl">
              <thead><tr><th>Reported</th><th>Time</th><th>Paid to</th><th className="num">Amount</th><th>Bank remark</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.txn_idx} className="click" onClick={() => toggle(t.txn_idx)}>
                    <td><input type="checkbox" checked={pick.has(t.txn_idx)} onChange={() => toggle(t.txn_idx)}
                               aria-label={`Disputed: ${t.transaction_id}`} /></td>
                    <td className="mono nw">{t.ts}</td><td className="mono">{t.receiver}</td>
                    <td className="num">{inr(t.amount_paise)}</td><td className="narr">{t.narration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="picker-row">
            <button className="btn primary" disabled={pick.size === 0} onClick={() => onApply([...pick].sort((a, b) => a - b))}>
              Follow the selected payments ({pick.size})</button>
            <button className="btn" onClick={() => onApply(null)}>Let the system choose</button>
          </div>
        </>
      )}
    </div>
  )
}
