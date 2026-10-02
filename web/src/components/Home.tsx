import { CheckCircle, FileArrowUp, Trash, Warning } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api } from '../api'
import { useCopy } from '../copy'
import { inr } from '../format'
import { go } from '../route'
import type { DatasetInfo, DatasetProgress, DQSummary, Overview } from '../types'
import { Count } from './Count'

const STAGES: [string, string][] = [
  ['hash', 'Fingerprint the file (SHA-256)'], ['load_csv', 'Read every row'], ['verify_order', 'Check nothing was skipped'],
  ['account_map', 'Number the accounts'], ['derive+validate', 'Clean values and flag rule breaks'], ['dq_summary', 'Count the flags'],
  ['account_table', 'Summarise each account'], ['graph_arrays', 'Build the money graph'], ['detect', 'Score every account for mule risk'],
]
const fmtN = (n: number) => Math.round(n).toLocaleString('en-IN')

interface Live { victim: string | null; traceMs: number | null; l1: string | null; ringSize: number | null; loss: number | null }

/** First page: how the work flows (with live figures from the loaded data), and a bay to analyse any file live. */
export function Home({ stats }: { stats: DQSummary | null }) {
  const c = useCopy()
  const [o, setO] = useState<Overview | null>(null)
  const [live, setLive] = useState<Live>({ victim: null, traceMs: null, l1: null, ringSize: null, loss: null })
  const [sets, setSets] = useState<DatasetInfo[]>([])

  useEffect(() => {
    api.overview().then(setO).catch(() => undefined)
    api.datasets().then(setSets).catch(() => undefined)
    api.victims(1).then(async ([v]) => {
      if (!v) return
      const t = await api.trace(v.account)
      const l1 = t.nodes.find((n) => n.role === 'L1')?.account ?? null
      setLive({ victim: v.account, traceMs: t.elapsed_ms, l1, ringSize: null, loss: t.loss_paise })
      if (l1) api.ring(l1).then((r) => setLive((x) => ({ ...x, ringSize: r.nodes.length }))).catch(() => undefined)
    }).catch(() => undefined)
  }, [])

  const flagged = o?.bands.HIGH ?? null
  const steps = [
    { t: 'Load and check every row', p: 'The file is read as evidence: nothing edited or dropped, rule breaks flagged.', art: 'rows',
      fig: stats ? <><Count value={stats.rows} format={fmtN} /><small>rows kept, none edited</small></> : null, to: '#evidence' },
    { t: 'Build the money graph', p: 'Every account becomes a point, every transfer a link, ordered in time.', art: 'net',
      fig: stats ? <><Count value={stats.accounts} format={fmtN} /><small>accounts linked</small></> : null, to: '#overview' },
    { t: 'Score every account 0-100', p: 'Speed of pass-through, fan-in / fan-out, repeated rings, cash-out channels.', art: 'score',
      fig: flagged !== null ? <><Count value={flagged} format={fmtN} /><small>flagged as likely mules</small></> : null, to: '#flagged' },
    { t: 'Trace a victim\'s money', p: 'Up to four hops, minute by minute, every paisa accounted for.', art: 'trace',
      fig: live.traceMs !== null ? <><Count value={live.traceMs} format={(n) => `${Math.round(n)} ms`} /><small>to trace {live.victim}</small></> : null,
      to: live.victim ? `#trace=${live.victim}` : '#investigate' },
    { t: 'Isolate the whole ring', p: 'One click pulls out the full syndicate around any account, with export.', art: 'ring',
      fig: live.ringSize !== null ? <><Count value={live.ringSize} format={fmtN} /><small>accounts in that victim's ring</small></> : null,
      to: live.l1 ? `#ring=${live.l1}` : '#flagged' },
    { t: 'Draft diary and freeze notices', p: 'A case diary and one notice per bank, every figure checked against the evidence.', art: 'doc',
      fig: o ? <><Count value={o.flagged_by_bank.length} format={fmtN} /><small>banks receive notices</small></> : null,
      to: live.victim ? `#trace=${live.victim}` : '#investigate' },
  ]

  return (
    <div className="home">
      <section className="hero">
        <h1>{c.homeTitle}</h1>
        <p>{c.homeLede}</p>
      </section>
      <section aria-label="How it works">
        <ol className="flow stagger" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {steps.map((s, i) => (
            <li key={s.t} style={{ ['--i' as string]: i, display: 'flex' }}>
              <button className="step" onClick={() => go(s.to)} style={{ width: '100%' }}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <div className={`art art-${s.art === 'trace' ? 'net' : s.art}`} aria-hidden="true">
                  {s.art === 'rows' && <><i /><i /><i /><i /></>}
                  {(s.art === 'net' || s.art === 'trace') && <><b /><b /><b /><b />{s.art === 'trace' && <span className="runner" />}</>}
                  {s.art === 'score' && [22, 30, 18, 40, 26, 84, 92].map((h, k) => <i key={k} className={h > 70 ? 'hot' : ''} style={{ height: `${h}%`, animationDelay: `${k * 0.08}s` }} />)}
                  {s.art === 'ring' && Array.from({ length: 21 }, (_, k) => <i key={k} />)}
                  {s.art === 'doc' && <><i /><i /><i /></>}
                </div>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
                <div className="fig">{s.fig ?? <span className="muted small">…</span>}</div>
              </button>
            </li>
          ))}
        </ol>
        {live.loss !== null && <p className="small muted" style={{ marginTop: 10 }}>Figures above come from the loaded file
          {stats ? ` (${stats.input_sha256.slice(0, 8)})` : ''}; the sample trace is victim {live.victim}, who lost {inr(live.loss)}.</p>}
      </section>
      <Analyse sets={sets} onSets={setSets} />
    </div>
  )
}

function Analyse({ sets, onSets }: { sets: DatasetInfo[]; onSets: (s: DatasetInfo[]) => void }) {
  const c = useCopy()
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
      if (d.active) { window.location.hash = '#home'; window.location.reload(); return }   // another case was opened
      onSets(left)
      window.dispatchEvent(new Event('abhedya:datasets'))
    }).catch((e) => { setRemoving(null); setSetErr(String((e as Error).message)) })
  }
  const total = prog ? Object.values(prog.stages_done).reduce((a, b) => a + b, 0) : 0

  return (
    <section className="bay" aria-label="Analyse a file">
      <div className="sheet sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={`drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }}
             onDragLeave={() => setOver(false)} onDrop={drop}>
          <FileArrowUp size={40} weight="duotone" aria-hidden="true" />
          <h2>{c.dropTitle}</h2>
          <p className="small muted" style={{ maxWidth: '52ch', margin: 0 }}>{c.dropHint}</p>
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
