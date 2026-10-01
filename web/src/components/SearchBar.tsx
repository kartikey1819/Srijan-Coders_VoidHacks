import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { inr } from '../format'
import type { VictimCandidate } from '../types'

interface Props { onTrace: (account: string) => void; busy: boolean; current?: string }

export function SearchBar({ onTrace, busy, current }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<string[]>([])
  const [victims, setVictims] = useState<VictimCandidate[]>([])

  useEffect(() => { if (current) setQ(current) }, [current])
  useEffect(() => { api.victims(300).then(setVictims).catch(() => setVictims([])) }, [])
  useEffect(() => {
    const s = q.trim()
    if (s.length < 3) { setHits([]); return }
    const id = window.setTimeout(() => api.search(s).then(setHits).catch(() => setHits([])), 150)
    return () => window.clearTimeout(id)
  }, [q])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (q.trim()) onTrace(q.trim().toUpperCase())
  }

  return (
    <form className="search" onSubmit={submit}>
      <input list="acct-hits" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
             placeholder="Victim account ID, e.g. KKBK10000000" aria-label="Victim account ID" spellCheck={false} />
      <datalist id="acct-hits">{hits.map((h) => <option key={h} value={h} />)}</datalist>
      <button className="btn primary" disabled={busy || !q.trim()}>{busy ? 'Tracing…' : 'Trace money trail'}</button>
      {victims.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) { setQ(e.target.value); onTrace(e.target.value) } }}
                aria-label="Suggested victims">
          <option value="">Suggested victims ({victims.length})…</option>
          {victims.map((v) => <option key={v.account} value={v.account}>{v.account} · {inr(v.out_paise_to_flagged)} · {v.first_ts.slice(0, 16)}</option>)}
        </select>
      )}
    </form>
  )
}
