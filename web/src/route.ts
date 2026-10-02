import { useEffect, useState } from 'react'

/** Hash routes are the single source of truth, so Back / Forward and pasted links always work.
 *  #overview (Dashboard, default) · #trace=ACCOUNT[&seeds=1,2] · #flagged[?role=L1&bank=SBIN&reason=CODE] ·
 *  #ring[=ACCOUNT] (Fraud Networks) · #data (Data Management; old #home goes there) */
export type Route =
  | { name: 'overview' }
  | { name: 'investigate'; account: string | null; seeds: number[] | null }
  | { name: 'ring'; account: string | null }
  | { name: 'flagged'; role: string | null; bank: string | null; reason: string | null }
  | { name: 'data' }

export function parse(hash: string): Route {
  const h = decodeURIComponent(hash.replace(/^#/, ''))
  const [path, query = ''] = h.split('?')
  const q = new URLSearchParams(query)
  const [k, rest] = path.split('=')
  if (k === 'trace') {
    const [acct, ...params] = (rest ?? '').split('&')
    const seedParam = params.find((p) => p.startsWith('seeds='))
    const seeds = seedParam ? seedParam.slice(6).split(',').map(Number).filter((n) => Number.isInteger(n)) : null
    return { name: 'investigate', account: acct ? acct.toUpperCase() : null, seeds: seeds?.length ? seeds : null }
  }
  if (k === 'investigate') return { name: 'investigate', account: null, seeds: null }
  if (k === 'ring') return { name: 'ring', account: rest ? rest.toUpperCase() : null }
  if (k === 'flagged') return { name: 'flagged', role: q.get('role'), bank: q.get('bank'), reason: q.get('reason') }
  if (k === 'data' || k === 'home') return { name: 'data' }
  return { name: 'overview' }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'overview': return '#overview'
    case 'investigate': return r.account ? `#trace=${r.account}${r.seeds?.length ? `&seeds=${r.seeds.join(',')}` : ''}` : '#investigate'
    case 'ring': return r.account ? `#ring=${r.account}` : '#ring'
    case 'flagged': {
      const q = new URLSearchParams()
      if (r.role) q.set('role', r.role)
      if (r.bank) q.set('bank', r.bank)
      if (r.reason) q.set('reason', r.reason)
      const s = q.toString()
      return `#flagged${s ? `?${s}` : ''}`
    }
    case 'data': return '#data'
  }
}

export function go(r: Route | string) {
  const h = typeof r === 'string' ? r : href(r)
  if (window.location.hash !== h) window.location.hash = h
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
