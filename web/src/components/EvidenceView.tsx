import { CaretRight, CheckCircle, Copy, DownloadSimple, FileText, Question, ShieldCheck, ShieldWarning } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { inr } from '../format'
import { go } from '../route'
import type { EvidenceCheck, EvidenceRecord as Evidence, TxnRow, VerifyResult } from '../types'
import { Count } from './Count'

const fmtN = (n: number) => Math.round(n).toLocaleString('en-IN')
const bytes = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`)
const local = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
const PAGE = 50

/** The bank export is the evidence: prove it is still the file that was loaded, show every row a check flagged
 *  (and whether it touches a flagged account), keep the custody log, and hand over an integrity statement. */
export function EvidenceView() {
  const [ev, setEv] = useState<Evidence | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [check, setCheck] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = () => api.evidence().then(setEv).catch((e) => setErr(String((e as Error).message)))
  useEffect(() => { load() }, [])

  if (err) return <div className="page"><div className="banner bad" role="alert">{err}</div></div>
  if (!ev) return <div className="page"><p className="muted">Loading the evidence record…</p></div>

  const verify = () => {
    setBusy(true)
    api.verify().then((r) => { setCheck(r); load() }).catch((e) => setErr(String((e as Error).message))).finally(() => setBusy(false))
  }
  const copy = () => navigator.clipboard?.writeText(ev.sha256).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })
  const hit = ev.checks.filter((c) => c.rows > 0), clean = ev.checks.filter((c) => c.rows === 0)
  const top = Math.max(1, ...hit.map((c) => c.rows))
  const lastVerify = ev.custody.find((e) => e.action === 'Re-verified')
  const left = ev.rows - ev.rows_in_graph

  return (
    <div className="page ev">
      <div>
        <h1>Evidence</h1>
        <p className="lede">The bank export is the evidence. Check that it is still the exact file that was loaded, open every row the
          checks flagged, and take an integrity statement for the case file. Nothing here edits the file.</p>
      </div>

      <section className="sheet ev-seal" aria-label="The evidence file">
        <div className="ev-file">
          <div className="ev-name"><FileText size={22} aria-hidden="true" /><div>
            <b>{ev.file_name}</b>
            <span className="small muted">{ev.size_bytes !== null ? `${bytes(ev.size_bytes)} · ` : ''}{ev.loaded_at ? `loaded ${local(ev.loaded_at)}` : 'loaded at ingest'}
              {ev.first_ts ? ` · transfers ${ev.first_ts.slice(0, 10)} to ${ev.last_ts?.slice(0, 10)}` : ''}</span>
          </div></div>
          <div className="ev-hash">
            <span className="small muted">SHA-256 fingerprint taken when the file was loaded</span>
            <div className="ev-hash-row">
              <code aria-label={`SHA-256 ${ev.sha256}`}>{ev.sha256.match(/.{1,8}/g)?.map((g, i) => <span key={i}>{g}</span>)}</code>
              <button className="btn ghost sm" onClick={copy} aria-label="Copy the SHA-256"><Copy /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
          <div className="ev-counts">
            <div><b><Count value={ev.rows} format={fmtN} /></b><span>rows received</span></div>
            <span className="eq" aria-hidden="true">=</span>
            <div><b><Count value={ev.rows} format={fmtN} /></b><span>rows kept</span></div>
            <div className="ev-graph"><b><Count value={ev.rows_in_graph} format={fmtN} /></b>
              <span>{left > 0 ? `in the money graph; ${fmtN(left)} unreadable row${left === 1 ? '' : 's'} kept but left out` : 'all in the money graph'}</span></div>
          </div>
        </div>

        <div className="ev-verify" aria-live="polite">
          <Status check={check} busy={busy} ev={ev} lastVerify={lastVerify?.ts ?? null} lastDetail={lastVerify?.detail ?? null} />
          <div className="ev-actions">
            <button className="btn primary" onClick={verify} disabled={busy}>
              <ShieldCheck /> {busy ? 'Checking…' : check ? 'Re-verify again' : 'Re-verify the file now'}</button>
            <a className="btn" href="/api/evidence/statement.txt" download onClick={() => window.setTimeout(load, 800)}>
              <DownloadSimple /> Integrity statement</a>
          </div>
          <p className="small muted">The statement lists the file, its fingerprint, how it was handled, every check and this custody log:
            supporting details for the Section 63 (Bharatiya Sakshya Adhiniyam, 2023) certificate. The officer checks, completes and signs it.</p>
        </div>
      </section>

      <section className="sheet ev-checks" aria-label="Data-quality checks">
        <div className="sheet-head"><h2>{hit.length} of {ev.checks.length} checks flagged rows</h2>
          <span className="small muted">Every flagged row is kept. Click a check to see its rows.</span></div>
        <div className="ev-check-head small muted" aria-hidden="true">
          <span>Check</span><span>Rows flagged</span><span className="num">Left out of the graph</span><span className="num">Touch a flagged account</span>
        </div>
        <ul className="ev-list">
          {hit.map((c, i) => (
            <CheckRow key={c.flag} c={c} top={top} i={i} open={open === c.flag} onToggle={() => setOpen(open === c.flag ? null : c.flag)} />
          ))}
        </ul>
        {clean.length > 0 && (
          <div className="ev-clean">
            <span className="small"><CheckCircle weight="fill" aria-hidden="true" /> {clean.length} checks found nothing:</span>
            {clean.map((c) => <span key={c.flag} className="chip" title={c.rule.replace(/Rs /g, "₹")}>{c.flag}</span>)}
          </div>
        )}
      </section>

      <div className="ev-bottom">
        <section className="sheet sheet-body" aria-label="Custody log">
          <h2>Custody log</h2>
          <p className="small muted">Every load, re-verification and statement for this file, newest first. Written to an append-only log.</p>
          {ev.custody.length === 0 ? <p className="small muted">No entries yet.</p> : (
            <ol className="ev-log">
              {ev.custody.slice(0, 30).map((e, i) => (
                <li key={i} className={e.detail.startsWith('FILE CHANGED') ? 'bad' : e.action === 'Re-verified' && e.detail === 'file unchanged' ? 'ok' : ''}>
                  <span className="mono small">{local(e.ts)}</span><b>{e.action}</b><span className="small">{e.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="sheet sheet-body" aria-label="Handling">
          <h2>How the file was handled</h2>
          <ul className="never small">
            <li>Read as received and fingerprinted before any analysis.</li>
            <li>No value edited: the raw text is kept next to every cleaned value.</li>
            <li>No row dropped: unreadable rows are kept, only left out of the money graph.</li>
            <li>Row order verified against the file after loading.</li>
            <li>Flags are reported only; they never change a risk score.</li>
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>Loaded and indexed in {ev.load_seconds.toFixed(2)} s
            {ev.detect_seconds !== null ? `; mule detection ${ev.detect_seconds.toFixed(2)} s` : ''}.</p>
        </section>
      </div>
    </div>
  )
}

function Status({ check, busy, ev, lastVerify, lastDetail }: {
  check: VerifyResult | null; busy: boolean; ev: Evidence; lastVerify: string | null; lastDetail: string | null
}) {
  if (busy) return (
    <div className="ev-status run"><ShieldCheck size={30} aria-hidden="true" /><div>
      <b>Hashing the file again…</b><span className="small">{ev.size_bytes !== null ? `${bytes(ev.size_bytes)} from ` : ''}{ev.file_path}</span>
      <div className="ev-run" aria-hidden="true"><i /></div></div></div>
  )
  if (check?.status === 'match') return (
    <div className="ev-status ok fade-in"><ShieldCheck size={30} weight="fill" aria-hidden="true" /><div>
      <b>Unchanged</b><span className="small">The file on disk matches the fingerprint taken at loading.
        Checked {local(check.checked_at)} in {check.seconds.toFixed(2)} s.</span></div></div>
  )
  if (check?.status === 'mismatch') return (
    <div className="ev-status bad fade-in" role="alert"><ShieldWarning size={30} weight="fill" aria-hidden="true" /><div>
      <b>Changed since loading</b><span className="small">The file at {ev.file_path} no longer matches. Do not rely on it; use the
        original export. Now: <code>{check.sha256_now?.slice(0, 16)}…</code> expected <code>{check.expected.slice(0, 16)}…</code></span></div></div>
  )
  if (check?.status === 'missing') return (
    <div className="ev-status warn fade-in"><Question size={30} weight="fill" aria-hidden="true" /><div>
      <b>Original file not on this workstation</b><span className="small">Nothing at {ev.file_path}. The analysis is intact, but the file
        cannot be re-checked here; verify the copy you hold against the SHA-256 above.</span></div></div>
  )
  return (
    <div className="ev-status"><ShieldCheck size={30} aria-hidden="true" /><div>
      <b>{lastVerify ? `Last re-verified ${local(lastVerify)}` : 'Not re-verified since loading'}</b>
      <span className="small">{lastVerify ? `Result: ${lastDetail}. ` : ''}Hash the file on disk again and compare it with the fingerprint
        recorded at loading.{ev.file_present ? '' : ' The original file is not at its recorded path.'}</span></div></div>
  )
}

function CheckRow({ c, top, i, open, onToggle }: { c: EvidenceCheck; top: number; i: number; open: boolean; onToggle: () => void }) {
  const [rows, setRows] = useState<TxnRow[] | null>(null)
  const [more, setMore] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open || rows) return
    api.flaggedRows(c.flag, 0, PAGE).then(setRows).catch((e) => setErr(String((e as Error).message)))
  }, [open, rows, c.flag])
  const loadMore = () => {
    if (!rows) return
    setMore(true)
    api.flaggedRows(c.flag, rows.length, PAGE).then((r) => setRows([...rows, ...r])).catch((e) => setErr(String((e as Error).message))).finally(() => setMore(false))
  }
  const acct = (a: string) => a ? <button className="link mono" onClick={() => go({ name: 'ring', account: a })} title={`Isolate the ring around ${a}`}>{a}</button> : <span className="muted">(empty)</span>
  return (
    <li className={open ? 'open' : ''} style={{ ['--i' as string]: i }}>
      <button className="ev-check" onClick={onToggle} aria-expanded={open}>
        <span className="ev-c-name"><CaretRight className="caret" aria-hidden="true" /><span><span className="mono">{c.flag}</span><span className="small muted">{c.rule.replace(/Rs /g, "₹")}</span></span></span>
        <span className="ev-c-bar"><span className="b-track"><span className="b-bar grow-x" style={{ width: `${(100 * c.rows) / top}%` }} /></span><b>{fmtN(c.rows)}</b></span>
        <span className="num">{c.outside_graph ? fmtN(c.outside_graph) : <span className="muted">none</span>}</span>
        <span className="num">{c.touching_flagged ? <span className="chip hot">{fmtN(c.touching_flagged)}</span> : <span className="muted">none</span>}</span>
      </button>
      {open && (
        <div className="ev-rows fade-in">
          {err && <p className="error small">{err}</p>}
          {!rows && !err && <p className="small muted">Reading the flagged rows…</p>}
          {rows && (
            <>
              <div className="ev-table">
                <table className="tbl small">
                  <thead><tr><th className="num">Row</th><th>Transaction</th><th>Time</th><th>From → To</th><th className="num">Amount</th><th>Mode</th><th>Other flags</th></tr></thead>
                  <tbody>{rows.map((t) => (
                    <tr key={t.txn_idx}>
                      <td className="num mono">{fmtN(t.txn_idx + 1)}</td>
                      <td className="mono">{t.transaction_id || <span className="muted">(empty)</span>}</td>
                      <td className="mono nw">{t.ts}</td>
                      <td className="nw">{acct(t.sender)} → {acct(t.receiver)}</td>
                      <td className="num">{inr(t.amount_paise)}</td>
                      <td>{t.mode || <span className="muted">(empty)</span>}</td>
                      <td className="small">{t.dq_flags.filter((f) => f !== c.flag).join(', ') || <span className="muted">none</span>}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <div className="ev-rows-foot small muted">
                Showing {fmtN(rows.length)} of {fmtN(c.rows)} rows in file order. Row = line number in the file after the header; click an account to isolate its ring.
                {rows.length < c.rows && <button className="btn sm" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show ${Math.min(PAGE, c.rows - rows.length)} more`}</button>}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}
