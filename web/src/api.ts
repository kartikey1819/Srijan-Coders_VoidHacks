import type {
  AccountSummary, CaseInfo, CaseOutput, DQSummary, RingResult, RiskRow, TraceResult, TxnRow, VictimCandidate,
} from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail ?? msg } catch { /* not JSON */ }
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json() as Promise<T>
}

const enc = encodeURIComponent

export const api = {
  stats: () => req<DQSummary>('/api/stats'),
  search: (q: string) => req<string[]>(`/api/search?q=${enc(q)}&limit=12`),
  victims: (limit = 50) => req<VictimCandidate[]>(`/api/victims?limit=${limit}`),
  trace: (victim: string) => req<TraceResult>(`/api/trace/${enc(victim)}`),
  account: (a: string) => req<AccountSummary>(`/api/account/${enc(a)}`),
  txns: (a: string, limit = 50, offset = 0) => req<TxnRow[]>(`/api/account/${enc(a)}/txns?limit=${limit}&offset=${offset}`),
  reasons: () => req<Record<string, string>>('/api/risk/reasons'),
  top: (band: string, limit = 5000) => req<RiskRow[]>(`/api/risk/top?band=${band}&limit=${limit}`),
  ring: (a: string) => req<RingResult>(`/api/ring/${enc(a)}`),
  ringExportUrl: (a: string) => `/api/ring/${enc(a)}/export.zip`,
  docs: (victim: string, body: CaseInfo) => req<CaseOutput>(`/api/docs/${enc(victim)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
}
