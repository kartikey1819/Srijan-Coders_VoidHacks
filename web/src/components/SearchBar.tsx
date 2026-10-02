import { MagnifyingGlass } from '@phosphor-icons/react'
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { accountHint } from '../format'
import { go } from '../route'

/** No suggestions for a very short entry or for the account already on screen. */
const idle = (v: string, current?: string | null) => { const s = v.trim().toUpperCase(); return s.length < 3 || s === current }

/** One box, one action. Format is checked as you type; near matches come from the file itself. */
export function SearchBar({ current }: { current?: string | null }) {
  const [q, setQ] = useState(current ?? '')
  const [hits, setHits] = useState<string[]>([])
  const [focus, setFocus] = useState(false)
  const [tried, setTried] = useState(false)
  const [currentWas, setCurrentWas] = useState(current)
  if (current !== currentWas) {                       // a newly traced account fills the box
    setCurrentWas(current)
    if (current) { setQ(current); setHits([]) }
  }

  const edit = (v: string) => { setQ(v); if (idle(v, current)) setHits([]) }
  useEffect(() => {
    if (idle(q, current)) return
    const s = q.trim().toUpperCase()
    const id = window.setTimeout(() => api.search(s).then((h) => setHits(h.filter((x) => x !== s).slice(0, 8))).catch(() => setHits([])), 150)
    return () => window.clearTimeout(id)
  }, [q, current])

  const hint = accountHint(q)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    const s = q.trim().toUpperCase()
    if (!s) return
    setHits([])
    go({ name: 'investigate', account: s, seeds: null })
  }
  const pick = (a: string) => { setQ(a); setHits([]); go({ name: 'investigate', account: a, seeds: null }) }

  return (
    <form className="search" onSubmit={submit} role="search">
      <div className="field">
        <input type="text" value={q} onChange={(e) => edit(e.target.value)} onFocus={() => setFocus(true)}
               onBlur={() => window.setTimeout(() => setFocus(false), 150)} autoFocus
               placeholder="Victim account ID, e.g. KKBK10000000" aria-label="Victim account ID" spellCheck={false}
               aria-describedby="acct-hint" autoComplete="off" />
        <span id="acct-hint" className={`hint${hint && (tried || q.trim().length >= 12) ? ' bad' : ''}`}>
          {hint && (tried || q.trim().length >= 12) ? hint : !q.trim() && tried ? 'Type an account ID first.' : ' '}</span>
      </div>
      <button className="btn primary"><MagnifyingGlass weight="bold" /> Trace money trail</button>
      {focus && hits.length > 0 && (
        <ul className="suggest" aria-label="Matching accounts">
          {hits.map((h) => <li key={h}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}>{h}</button></li>)}
        </ul>
      )}
    </form>
  )
}
