import type { AccountSummary, CaseInfo, CaseOutput, DQSummary, DatasetInfo, DatasetProgress, FlowSummary, LlmStatus, Overview, RingResult, RiskRow, TraceResult, TxnRow, VictimCandidate } from './types'

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
  flow: () => req<FlowSummary>('/api/flow'),
  datasets: () => req<DatasetInfo[]>('/api/datasets'),
  progress: (id: string) => req<DatasetProgress>(`/api/datasets/${enc(id)}/progress`),
  activate: (id: string) => req<DatasetInfo>(`/api/datasets/${enc(id)}/activate`, { method: 'POST' }),
  removeDataset: (id: string) => req<DatasetInfo[]>(`/api/datasets/${enc(id)}`, { method: 'DELETE' }),
  search: (q: string) => req<string[]>(`/api/search?q=${enc(q)}&limit=12`),
  victims: (limit = 50) => req<VictimCandidate[]>(`/api/victims?limit=${limit}`),
  trace: (victim: string, seeds?: number[] | null, hops = 4) =>
    req<TraceResult>(`/api/trace/${enc(victim)}?max_hops=${hops}${seeds?.length ? '&' + seeds.map((s) => `seed_txn=${s}`).join('&') : ''}`),
  /** Transactions by row number, any count (fetched 500 at a time). */
  byIndexAll: async (idx: number[]) => {
    const out: TxnRow[] = []
    for (let i = 0; i < idx.length; i += 500) out.push(...await req<TxnRow[]>(`/api/txns?${idx.slice(i, i + 500).map((x) => `idx=${x}`).join('&')}`))
    return out
  },
  account: (a: string) => req<AccountSummary>(`/api/account/${enc(a)}`),
  byIndex: (idx: number[]) => req<TxnRow[]>(`/api/txns?${idx.slice(0, 500).map((i) => `idx=${i}`).join('&')}`),
  txns: (a: string, limit = 50, offset = 0) => req<TxnRow[]>(`/api/account/${enc(a)}/txns?limit=${limit}&offset=${offset}`),
  reasons: () => req<Record<string, string>>('/api/risk/reasons'),
  top: (band: string, limit = 5000) => req<RiskRow[]>(`/api/risk/top?band=${band}&limit=${limit}`),
  ring: (a: string) => req<RingResult>(`/api/ring/${enc(a)}`),
  ringExportUrl: (a: string) => `/api/ring/${enc(a)}/export.zip`,
  llm: () => req<LlmStatus>('/api/docs/llm'),
  docs: (victim: string, body: CaseInfo) => req<CaseOutput>(`/api/docs/${enc(victim)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
}
