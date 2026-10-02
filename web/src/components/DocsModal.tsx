import { DownloadSimple, FileText, FileZip, LockSimple, Printer, ShieldCheck, ShieldWarning, Sparkle, SpinnerGap, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { inr } from '../format'
import type { CaseInfo, CaseOutput, LlmStatus } from '../types'
import { BankIcon } from './BankIcon'

const FIELDS: [keyof CaseInfo, string, string][] = [
  ['fir_no', 'FIR / Case No.', 'e.g. 0412/2026'],
  ['ncrp_ack', 'NCRP / 1930 Complaint No.', 'e.g. 31609260012345'],
  ['io_name', 'Investigating Officer', 'Name of the IO'],
  ['io_rank', 'Rank', 'Sub-Inspector'],
  ['police_station', 'Police Station', 'Cyber Crime Police Station, Indore'],
  ['sections', 'Sections of law', 'Sections 318(4), 319(2), 61(2) BNS r/w 66C, 66D IT Act'],
]

/** Case particulars on the left; the FIR draft, the case diary and one freeze notice per bank on the right, ready to
 *  print, and the complete case file as one ZIP.
 *  Every account, IFSC, transaction ID and amount in them is checked against the evidence before they are shown. */
export function DocsModal({ victim, seeds, onClose, onDone }: { victim: string; seeds: number[] | null; onClose: () => void; onDone?: () => void }) {
  const [form, setForm] = useState<CaseInfo>({ use_llm: true, io_rank: 'Sub-Inspector' })
  const [out, setOut] = useState<CaseOutput | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState('diary')
  const [llm, setLlm] = useState<LlmStatus | null>(null)
  const [allHtml, setAllHtml] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)

  const prepare = () => {
    setBusy(true); setErr(null)
    api.docs(victim, { ...form, seed_txns: seeds ?? [] })
      .then((o) => { setOut(o); setAllHtml(null); onDone?.() })
      .catch((e) => setErr(String((e as Error).message)))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    api.llm().then((s) => { setLlm(s); if (!s.available) setForm((f) => ({ ...f, use_llm: false })) })
      .catch(() => { setLlm({ available: false, model: '' }); setForm((f) => ({ ...f, use_llm: false })) })
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const first = useRef(true)
  useEffect(() => { if (llm && first.current) { first.current = false; prepare() } }, [llm]) // eslint-disable-line react-hooks/exhaustive-deps

  // "All freeze notices" is one printable page: the bank notices one after another
  useEffect(() => {
    if (view !== 'all' || !out || allHtml !== null) return
    Promise.all(out.notices.map((n) => fetch(n.url).then((r) => r.text()))).then((pages) => {
      const body = pages.map((p) => p.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, ''))
      const head = (pages[0] ?? '').match(/<head[\s\S]*?<\/head>/i)?.[0] ?? ''
      setAllHtml(`<!doctype html><html>${head}<body>${body.join('<div style="page-break-after:always"></div>')}</body></html>`)
    }).catch(() => setAllHtml('<p>Could not load the notices.</p>'))
  }, [view, out, allHtml])

  const url = !out ? null : view === 'diary' ? out.diary_url : view === 'fir' ? out.files.fir ?? null
    : out.notices.find((n) => n.bank_prefix === view)?.url ?? null
  const fit = () => {
    const d = frame.current?.contentDocument
    if (d?.body && frame.current) frame.current.style.height = `${d.documentElement.scrollHeight + 8}px`
  }
  const print = () => frame.current?.contentWindow?.print()
  const save = async () => {
    const html = view === 'all' ? allHtml : url ? await fetch(url).then((r) => r.text()) : null
    if (!html) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    a.download = `${view === 'diary' ? 'case_diary' : view === 'fir' ? 'fir_draft' : view === 'all' ? 'freeze_notices' : `freeze_notice_${view}`}_${victim}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const g = out?.verification
  const set = (k: keyof CaseInfo, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="docs" role="dialog" aria-label="Case documents" aria-modal="true" tabIndex={-1} ref={box}>
        <aside className="docs-side">
          <div className="docs-title"><FileText size={20} /><b>Case documents</b>
            <button className="btn ghost sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
          <p className="muted small">Victim <span className="mono strong">{victim}</span>. Fill in the case particulars, then prepare the
            FIR draft, the case diary and a freeze notice for each bank. All are drafts for your verification.</p>
          {FIELDS.map(([k, label, ph]) => (
            <label key={k} className="gfield"><span>{label}</span>
              <input value={(form[k] as string | undefined) ?? ''} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></label>
          ))}
          <label className="gcheck">
            <input type="checkbox" checked={form.use_llm} onChange={(e) => setForm((f) => ({ ...f, use_llm: e.target.checked }))} />
            <span><Sparkle size={14} /> Draft the narrative with the local language model
              <small>{!llm ? 'checking…' : llm.available ? `${llm.model} is installed` : 'not installed: standard wording will be used'}</small></span>
          </label>
          <button className="btn cta big" onClick={prepare} disabled={busy}>
            {busy ? <SpinnerGap size={16} className="spin" /> : <FileText size={16} />} {out ? 'Prepare again' : 'Prepare documents'}</button>
          {g && (
            <div className={`verify${g.ok ? '' : ' bad'}`} role="status">
              <h3>{g.ok ? <ShieldCheck size={18} weight="fill" /> : <ShieldWarning size={18} weight="fill" />}
                Verification {g.ok ? 'passed' : 'failed: documents withheld'}</h3>
              <p><b>{g.total}</b> figures checked against the transaction data: {g.accounts} accounts, {g.ifscs} IFSCs, {g.txn_ids} transaction
                IDs, {g.amounts} amounts. <b>{g.unverified}</b> could not be verified.</p>
              <p className="small muted"><LockSimple size={12} /> Bank narrations are never given to the language model, and any figure it writes on its
                own is rejected.</p>
              <p className="small muted fp">Evidence fingerprint (SHA-256): <span className="mono">{g.fingerprint}</span></p>
            </div>
          )}
          {out && <p className="small muted">Narrative: {out.narrative_source}</p>}
          {err && <div className="verify bad" role="alert"><h3><ShieldWarning size={18} weight="fill" /> Documents not prepared</h3><p>{err}</p></div>}
        </aside>
        <div className="docs-main">
          <div className="docs-tabs" role="tablist" aria-label="Documents">
            <button role="tab" aria-selected={view === 'diary'} className="chip" onClick={() => setView('diary')}>Case diary</button>
            {out?.files.fir && <button role="tab" aria-selected={view === 'fir'} className="chip" onClick={() => setView('fir')}>FIR draft</button>}
            {out && out.notices.length > 0 && (
              <button role="tab" aria-selected={view === 'all'} className="chip" onClick={() => setView('all')}>All freeze notices ({out.notices.length})</button>
            )}
            {out?.notices.map((n) => (
              <button key={n.bank_prefix} role="tab" aria-selected={view === n.bank_prefix} className="chip" onClick={() => setView(n.bank_prefix)}
                      title={`${n.accounts} account${n.accounts === 1 ? '' : 's'} to hold`}>
                <BankIcon bank={n.bank_prefix} size="sm" /> {n.bank_name} <span className="muted">{inr(n.hold_paise)}</span></button>
            ))}
            <span className="sp" />
            {out && <a className="btn" href={`/api/docs/${out.case_id}/case_file.zip`} download><FileZip size={15} /> Complete case file (ZIP)</a>}
            <button className="btn" onClick={save} disabled={!out}><DownloadSimple size={15} /> Save HTML</button>
            <button className="btn primary" onClick={print} disabled={!out}><Printer size={15} /> Print / PDF</button>
          </div>
          <div className="paper">
            {busy && !out ? <p className="paper-msg"><SpinnerGap size={18} className="spin" /> Preparing the documents…</p>
              : !out ? <p className="paper-msg">{err ? 'Fix the problem on the left, then prepare again.' : 'Preparing…'}</p>
              : view === 'all' ? (allHtml ? <iframe ref={frame} title="All freeze notices" srcDoc={allHtml} onLoad={fit} scrolling="no" />
                                          : <p className="paper-msg"><SpinnerGap size={18} className="spin" /> Loading the notices…</p>)
              : url && <iframe key={url} ref={frame} title={view === 'diary' ? 'Case diary' : view === 'fir' ? 'FIR draft' : `Freeze notice ${view}`} src={url} onLoad={fit} scrolling="no" />}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
