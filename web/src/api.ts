import type {
  AccountSummary, CaseInfo, CaseOutput, DatasetInfo, DatasetProgress, DQSummary, Overview, RingResult, RiskRow, TraceResult, TxnRow, VictimCandidate,
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
  overview: () => req<Overview>('/api/overview'),
  datasets: () => req<DatasetInfo[]>('/api/datasets'),
  progress: (id: string) => req<DatasetProgress>(`/api/datasets/${enc(id)}/progress`),
  activate: (id: string) => req<DatasetInfo>(`/api/datasets/${enc(id)}/activate`, { method: 'POST' }),
  removeDataset: (id: string) => req<DatasetInfo[]>(`/api/datasets/${enc(id)}`, { method: 'DELETE' }),
  search: (q: string) => req<string[]>(`/api/search?q=${enc(q)}&limit=12`),
  victims: (limit = 50) => req<VictimCandidate[]>(`/api/victims?limit=${limit}`),
  trace: (victim: string, seeds?: number[] | null) =>
    req<TraceResult>(`/api/trace/${enc(victim)}${seeds?.length ? '?' + seeds.map((s) => `seed_txn=${s}`).join('&') : ''}`),
  account: (a: string) => req<AccountSummary>(`/api/account/${enc(a)}`),
  byIndex: (idx: number[]) => req<TxnRow[]>(`/api/txns?${idx.slice(0, 500).map((i) => `idx=${i}`).join('&')}`),
  txns: (a: string, limit = 50, offset = 0) => req<TxnRow[]>(`/api/account/${enc(a)}/txns?limit=${limit}&offset=${offset}`),
  reasons: () => req<Record<string, string>>('/api/risk/reasons'),
  top: (band: string, limit = 5000) => req<RiskRow[]>(`/api/risk/top?band=${band}&limit=${limit}`),
  ring: (a: string) => req<RingResult>(`/api/ring/${enc(a)}`),
  ringExportUrl: (a: string) => `/api/ring/${enc(a)}/export.zip`,
  docs: (victim: string, body: CaseInfo) => req<CaseOutput>(`/api/docs/${enc(victim)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
}
