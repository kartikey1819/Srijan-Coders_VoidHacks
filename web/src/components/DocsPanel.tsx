import { X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { api } from '../api'
import { inr } from '../format'
import type { CaseOutput, TraceResult } from '../types'

interface Props { trace: TraceResult; seeds?: number[] | null; onClose: () => void }

/** Case diary + one Section 94 BNSS (old 91 CrPC) notice per bank. Shows what will be produced before producing it. */
export function DocsPanel({ trace, seeds, onClose }: Props) {
  const [form, setForm] = useState({ fir_no: '', ncrp_ack: '', police_station: '', io_name: '' })
  const [useLlm, setUseLlm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<CaseOutput | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); back?.focus?.() }
  }, [onClose])

  const perBank = useMemo(() => {
    const m = new Map<string, { name: string; n: number; held: number }>()
    for (const n of trace.nodes) {
      if (!trace.freeze_candidates.includes(n.account)) continue
      const b = m.get(n.bank_prefix) ?? { name: n.bank_name, n: 0, held: 0 }
      b.n += 1; b.held += n.held_paise
      m.set(n.bank_prefix, b)
    }
    return m
  }, [trace])

  const go = async () => {
    setBusy(true); setErr(null); setOut(null)
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))
      setOut(await api.docs(trace.victim, { ...body, use_llm: useLlm, seed_txns: seeds ?? [] }))
    } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(false) }
  }

  const label = (k: string) => {
    if (k === 'diary') return 'Police case diary'
    const p = k.slice(7), b = perBank.get(p)
    return b ? `Freeze notice: ${b.name} · ${b.n} account${b.n === 1 ? '' : 's'} · ${inr(b.held)}` : `Freeze notice: ${p}`
  }
  const docs = out ? Object.entries(out.files).filter(([k]) => k === 'diary' || k.startsWith('notice_')) : []
  const total = [...perBank.values()].reduce((s, b) => s + b.held, 0)

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-body" role="dialog" aria-modal="true" aria-label="Generate documents">
        <header><h2>Case diary and freeze notices for <span className="acct">{trace.victim}</span></h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close"><X /> Close</button></header>
        <div className="content">
          <div>
            <h3>What will be produced</h3>
            <p className="small" style={{ margin: '4px 0' }}>One police case diary, and one freeze notice for each of {perBank.size} bank{perBank.size === 1 ? '' : 's'},
              covering {trace.freeze_candidates.length} accounts that still hold <span className="held">{inr(total)}</span>.</p>
            <table className="tbl small">
              <thead><tr><th>Bank</th><th className="num">Accounts</th><th className="num">Still held</th></tr></thead>
              <tbody>{[...perBank.entries()].map(([p, b]) => <tr key={p}><td>{b.name}</td><td className="num">{b.n}</td><td className="num">{inr(b.held)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="form">
            <label>FIR No.<input ref={first} type="text" value={form.fir_no} onChange={set('fir_no')} placeholder="e.g. 0123/2026" /><span>optional; left blank in the draft</span></label>
            <label>NCRP acknowledgement<input type="text" value={form.ncrp_ack} onChange={set('ncrp_ack')} /><span>optional</span></label>
            <label>Police station<input type="text" value={form.police_station} onChange={set('police_station')} /><span>optional</span></label>
            <label>Investigating Officer<input type="text" value={form.io_name} onChange={set('io_name')} placeholder="Name, rank" /><span>optional</span></label>
            <label className="check full"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
              Draft the narrative with the local AI model (facts are always inserted from the evidence)</label>
          </div>
          <div className="row gap">
            <button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Generating…' : 'Generate documents'}</button>
            {useLlm && <span className="small muted">The local model takes about 15 s; if it is unavailable, templates are used.</span>}
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          {out && (
            <div className="docs" role="status">
              <p style={{ fontWeight: 650, margin: 0 }}>Drafts for the Investigating Officer to verify and sign.</p>
              <ul>{docs.map(([k, url]) => <li key={k}><a href={url} target="_blank" rel="noreferrer">{label(k)}</a></li>)}</ul>
              <p className="small">
                {out.used_llm ? 'Narrative drafted by the local AI model and checked by the validator.'
                              : `Narrative from fixed templates (${out.llm_fallback_reason}).`}
                {' '}Facts fingerprint <span className="mono">{out.facts_sha256.slice(0, 16)}…</span> (identical with the AI on or off).
                Open a document and use Print / Save as PDF.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
