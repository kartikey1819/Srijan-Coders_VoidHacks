import { useState, type ChangeEvent } from 'react'
import { api } from '../api'
import type { CaseOutput } from '../types'

interface Props { victim: string; onClose: () => void }

const LABEL = (k: string) => (k === 'diary' ? 'Police case diary' : k.startsWith('notice_') ? `Freeze notice: ${k.slice(7)}` : k)

/** Case diary + one Section 94 BNSS (91 CrPC) notice per bank. */
export function DocsPanel({ victim, onClose }: Props) {
  const [form, setForm] = useState({ fir_no: '', ncrp_ack: '', police_station: '', io_name: '' })
  const [useLlm, setUseLlm] = useState(true)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<CaseOutput | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const go = async () => {
    setBusy(true); setErr(null); setOut(null)
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))
      setOut(await api.docs(victim, { ...body, use_llm: useLlm }))
    } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(false) }
  }

  const docs = out ? Object.entries(out.files).filter(([k]) => k === 'diary' || k.startsWith('notice_')) : []
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Generate documents">
      <div className="modal-body">
        <div className="row between"><h3>Documents for {victim}</h3><button className="btn ghost" onClick={onClose}>Close</button></div>
        <div className="form">
          <label>FIR No.<input value={form.fir_no} onChange={set('fir_no')} placeholder="e.g. 0123/2026" /></label>
          <label>NCRP acknowledgement<input value={form.ncrp_ack} onChange={set('ncrp_ack')} /></label>
          <label>Police station<input value={form.police_station} onChange={set('police_station')} /></label>
          <label>Investigating Officer<input value={form.io_name} onChange={set('io_name')} placeholder="Name, rank" /></label>
          <label className="check"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
            Draft the narrative with the local AI model (facts are always inserted from the evidence)</label>
        </div>
        <button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Generating…' : 'Generate documents'}</button>
        {err && <p className="error">{err}</p>}
        {out && (
          <div className="docs">
            <p className="small">
              {out.used_llm ? 'Narrative drafted by the local AI model and checked by the validator.'
                            : `Narrative from fixed templates (${out.llm_fallback_reason}).`}
              <br />Facts fingerprint <span className="mono">{out.facts_sha256.slice(0, 16)}…</span> (the same with the AI on or off).
            </p>
            <ul>{docs.map(([k, url]) => <li key={k}><a href={url} target="_blank" rel="noreferrer">{LABEL(k)}</a></li>)}</ul>
            <p className="small muted">Open a document and use “Print / Save as PDF”. All documents are drafts for the IO to verify and sign.</p>
          </div>
        )}
      </div>
    </div>
  )
}
