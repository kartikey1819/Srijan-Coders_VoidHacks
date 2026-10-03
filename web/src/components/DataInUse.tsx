import { CheckCircle, Database, FileArrowUp, Trash, UploadSimple, Warning, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import type { DatasetInfo, DatasetProgress, DQSummary } from '../types'
import { Count } from './Count'

const STAGES: [string, string][] = [
  ['hash', 'Fingerprint the file (SHA-256)'], ['load_csv', 'Read every row'], ['verify_order', 'Check nothing was skipped'],
  ['account_map', 'Number the accounts'], ['derive+validate', 'Clean values and flag rule breaks'], ['dq_summary', 'Count the flags'],
  ['account_table', 'Summarise each account'], ['graph_arrays', 'Build the money graph'], ['detect', 'Score every account for mule risk'],
]
const fmtN = (n: number) => Math.round(n).toLocaleString('en-IN')

/** Dashboard corner: the file every report on screen comes from, a switch between saved cases, and the upload dialog. */
export function DataInUse({ stats }: { stats: DQSummary | null }) {
  const [sets, setSets] = useState<DatasetInfo[]>([])
  const [open, setOpen] = useState(false)
  const [demo, setDemo] = useState(false)          // the public online demo hides uploading
  useEffect(() => { api.health().then((h) => setDemo(!!h.demo)).catch(() => undefined) }, [])
  useEffect(() => {
    const load = () => api.datasets().then(setSets).catch(() => undefined)
    load()
    window.addEventListener('abhedya:datasets', load)
    return () => window.removeEventListener('abhedya:datasets', load)
  }, [])
  const active = sets.find((d) => d.active)
  const ready = sets.filter((d) => d.status === 'done')
  const switchTo = (id: string) => api.activate(id).then(() => { window.location.hash = '#overview'; window.location.reload() })
  return (
    <div className="diu" aria-label="Data in use">
      <div className="diu-head"><Database size={16} weight="fill" /><span>Data in use for every report</span></div>
      {ready.length > 1 ? (
        <select value={active?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="Dataset for every report" title={active?.name}>
          {ready.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      ) : <b className="diu-name" title={active?.name}>{active?.name ?? '…'}</b>}
      <div className="diu-meta">{stats ? <>{fmtN(stats.rows)} transactions · {fmtN(stats.accounts)} accounts</> : 'Loading…'}</div>
      {!demo && <button className="btn primary" onClick={() => setOpen(true)}><UploadSimple size={16} /> Upload new file</button>}
      {open && createPortal(
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="upload-dlg" role="dialog" aria-label="Upload a transaction file" aria-modal="true">
            <div className="docs-title"><FileArrowUp size={20} /><b>Upload a transaction file</b>
              <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></div>
            <Analyse sets={sets} onSets={setSets} />
          </div>
        </>, document.body)}
    </div>
  )
}

function Analyse({ sets, onSets }: { sets: DatasetInfo[]; onSets: (s: DatasetInfo[]) => void }) {
  const [over, setOver] = useState(false)
  const [sent, setSent] = useState(0)          // upload fraction 0..1
  const [file, setFile] = useState<File | null>(null)
  const [prog, setProg] = useState<DatasetProgress | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [started, setStarted] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [asking, setAsking] = useState<string | null>(null)      // case awaiting "remove?" confirmation
  const [removing, setRemoving] = useState<string | null>(null)
  const [setErrMsg, setSetErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!prog || prog.status === 'done' || prog.status === 'error') return
    const id = window.setInterval(() => {
      api.progress(prog.id).then((p) => { setProg(p); if (p.status === 'done') api.datasets().then(onSets) }).catch(() => undefined)
      setElapsed((performance.now() - started) / 1000)
    }, 300)
    return () => window.clearInterval(id)
  }, [prog, started, onSets])

  const send = (f: File) => {
    setFile(f); setErr(null); setProg(null); setSent(0); setStarted(performance.now()); setElapsed(0)
    if (!/\.csv$/i.test(f.name)) { setErr('Please choose a .csv file (a bank transaction export).'); return }
    const x = new XMLHttpRequest()
    x.open('POST', `/api/datasets?name=${encodeURIComponent(f.name)}`)
    x.setRequestHeader('Content-Type', 'application/octet-stream')
    x.upload.onprogress = (e) => { if (e.lengthComputable) setSent(e.loaded / e.total) }
    x.onload = () => {
      setSent(1)
      try {
        const body = JSON.parse(x.responseText)
        if (x.status >= 400) setErr(body.detail ?? `Upload failed (${x.status})`)
        else setProg(body as DatasetProgress)
      } catch { setErr(`Upload failed (${x.status})`) }
    }
    x.onerror = () => setErr('Upload failed: the engine is not reachable.')
    x.send(f)
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) send(f) }
  const open = (id: string) => api.activate(id).then(() => { window.location.hash = '#overview'; window.location.reload() })
    .catch((e) => setErr(String((e as Error).message)))
  const remove = (d: DatasetInfo) => {
    setRemoving(d.id); setSetErr(null)
    api.removeDataset(d.id).then((left) => {
      setAsking(null); setRemoving(null)
      if (d.active) { window.location.hash = '#overview'; window.location.reload(); return }   // another case was opened
      onSets(left)
      window.dispatchEvent(new Event('abhedya:datasets'))
    }).catch((e) => { setRemoving(null); setSetErr(String((e as Error).message)) })
  }
  const total = prog ? Object.values(prog.stages_done).reduce((a, b) => a + b, 0) : 0

  return (
    <section className="bay" aria-label="Analyse a file and saved cases">
      <div className="sheet sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={`drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }}
             onDragLeave={() => setOver(false)} onDrop={drop}>
          <FileArrowUp size={40} weight="duotone" aria-hidden="true" />
          <h2>Analyse a new transaction file</h2>
          <p className="small muted" style={{ maxWidth: '52ch', margin: 0 }}>Drop a bank transaction CSV here, or choose a file. It is stored exactly as received and analysed on this computer.</p>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = '' }} />
          <button className="btn primary" onClick={() => input.current?.click()}>Choose a CSV file</button>
          <span className="small muted">Needs the 11 standard columns (Transaction_ID … Device_Type). Up to 1 GB.</span>
        </div>
        {file && (
          <div aria-live="polite">
            <div className="row between small"><span className="acct">{file.name}</span>
              <span className="muted">{(file.size / 2 ** 20).toFixed(1)} MB · {sent < 1 ? `uploading ${Math.round(sent * 100)}%` : prog ? `${prog.status} · ${elapsed.toFixed(1)} s` : 'checking…'}</span></div>
            <div className="progress" style={{ marginTop: 6 }}><div style={{ transform: `scaleX(${sent})` }} /></div>
          </div>
        )}
        {err && <div className="banner bad" role="alert"><Warning size={20} /><div><b>That file could not be analysed.</b><div className="small">{err}</div></div></div>}
        {prog && (
          <ol className="stages">
            {STAGES.map(([k, label]) => {
              const done = k in prog.stages_done, run = prog.status === 'running' && prog.stage === k
              return (
                <li key={k} className={done ? 'done' : run ? 'run' : ''}>
                  <span className="dot" aria-hidden="true" /><span>{label}</span>
                  <span className="mono small">{done ? `${prog.stages_done[k].toFixed(2)} s` : run ? 'running' : ''}</span>
                </li>
              )
            })}
          </ol>
        )}
        {prog?.status === 'error' && <div className="banner bad" role="alert"><b>{prog.error}</b></div>}
        {prog?.status === 'done' && (
          <div className="sheet sheet-body fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row gap"><CheckCircle size={22} weight="fill" style={{ color: 'var(--accent)' }} /><b>Analysis complete</b></div>
            <div className="result">
              <div><b><Count value={prog.rows} format={fmtN} /></b><span>rows kept</span></div>
              <div><b><Count value={prog.accounts} format={fmtN} /></b><span>accounts</span></div>
              <div><b className="held"><Count value={prog.flagged} format={fmtN} /></b><span>flagged as likely mules</span></div>
              <div><b>{total.toFixed(1)} s</b><span>to load, check, graph and score</span></div>
            </div>
            <div><button className="btn primary" onClick={() => open(prog.id)}>Open this case</button></div>
          </div>
        )}
      </div>
      <div className="sheet">
        <div className="sheet-head"><h2>Saved cases</h2><span className="small muted">Each file stays exactly as received; remove a case to delete it from this workstation</span></div>
        {setErrMsg && <div className="banner bad small" role="alert" style={{ margin: '0 14px 10px' }}>{setErrMsg}</div>}
        <table className="tbl">
          <thead><tr><th>File</th><th className="num">Rows</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>
            {sets.map((d) => (
              <tr key={d.id} aria-selected={d.active}>
                <td><div>{d.id === 'official' ? 'Official dataset' : d.name}</div><div className="small muted mono">{d.sha256.slice(0, 12)}</div></td>
                <td className="num">{d.rows.toLocaleString('en-IN')}</td>
                <td>{d.active ? <b>Open now</b> : d.status === 'done' ? 'Ready' : d.status}</td>
                <td className="row-acts">
                  {asking === d.id ? (
                    <span className="confirm" role="group" aria-label={`Remove ${d.id === 'official' ? 'the official dataset' : d.name}?`}>
                      <span className="small">{d.id === 'official' ? 'Delete its database? The CSV stays on disk.' : 'Delete this case and its copy?'}</span>
                      <button className="btn sm danger" disabled={removing === d.id} onClick={() => remove(d)}>{removing === d.id ? 'Removing…' : 'Remove'}</button>
                      <button className="btn sm ghost" disabled={removing === d.id} onClick={() => setAsking(null)}>Cancel</button>
                    </span>
                  ) : (
                    <>
                      {!d.active && d.status === 'done' && <button className="btn sm" onClick={() => open(d.id)}>Open</button>}
                      {d.status !== 'queued' && d.status !== 'running' && sets.length > 1 &&
                        <button className="btn sm ghost danger-text" onClick={() => { setAsking(d.id); setSetErr(null) }}
                                aria-label={`Remove ${d.id === 'official' ? 'the official dataset' : d.name}`} title="Remove this case"><Trash /> Remove</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
