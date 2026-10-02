// Mirror of contracts/models.py (the API's response shapes). Money is always integer paise.
export type Role = 'VICTIM' | 'L1' | 'L2' | 'L3'
export type Band = 'HIGH' | 'MEDIUM' | 'LOW'

export interface RiskRow { account: string; score: number; band: Band; role_hint: 'L1' | 'L2' | 'L3' | null; reasons: string[] }

export interface TraceNode {
  account: string; role: Role; hop: number; bank_prefix: string; bank_name: string; ifsc: string
  received_paise: number; sent_paise: number; held_paise: number; first_in_ts: string | null; risk: RiskRow | null
}
export interface TraceEdge {
  txn_idx: number; transaction_id: string; src: string; dst: string; ts: string; amount_paise: number
  attributed_paise: number; hop: number; delay_s: number | null; rule: 'seed' | 'window' | 'amount_match' | 'oldest'
  mode: string; narr_category: string; terminal: boolean
}
export interface TraceResult {
  victim: string; loss_paise: number; nodes: TraceNode[]; edges: TraceEdge[]; freeze_candidates: string[]
  warnings: string[]; elapsed_ms: number; data_sha256: string
}

export interface Counterparty { account: string; direction: 'in' | 'out'; n_txn: number; total_paise: number }
export interface AccountSummary {
  account: string; ifsc: string; bank_prefix: string; bank_name: string; n_in: number; n_out: number
  sum_in_paise: number; sum_out_paise: number; first_ts: string | null; last_ts: string | null
  top_counterparties: Counterparty[]; modes: Record<string, number>; devices: Record<string, number>
  ip_classes: Record<string, number>; dq_flags: Record<string, number>; risk: RiskRow | null
}
export interface TxnRow {
  txn_idx: number; transaction_id: string; sender: string; receiver: string; sender_ifsc: string; receiver_ifsc: string
  amount_paise: number; ts: string; mode: string; narration: string; narr_category: string; ip: string
  ip_class: string; device: string; device_class: string; dq_flags: string[]
}

export interface GraphNode { account: string; role: Role | 'UNKNOWN'; bank_prefix: string; risk_score: number | null; risk_band: Band | null }
export interface GraphEdge { src: string; dst: string; n_txn: number; total_paise: number; first_ts: string; last_ts: string; txn_idxs: number[] }
export interface RingResult { seed: string; nodes: GraphNode[]; edges: GraphEdge[]; n_txn: number; total_paise: number; t_from: string | null; t_to: string | null }

export interface VictimCandidate { account: string; out_paise_to_flagged: number; first_ts: string }
export interface DQSummary { rows: number; accounts: number; counts: Record<string, number>; input_sha256: string; ingest_seconds: Record<string, number> }

export interface CaseInfo {
  fir_no?: string; ncrp_ack?: string; police_station?: string; io_name?: string; io_rank?: string; sections?: string
  use_llm: boolean; seed_txns?: number[]
}
export interface NoticeInfo { bank_prefix: string; bank_name: string; accounts: number; hold_paise: number; url: string }
export interface Verification {
  ok: boolean; accounts: number; ifscs: number; txn_ids: number; amounts: number; total: number; unverified: number; fingerprint: string
}
export interface CaseOutput {
  case_id: string; files: Record<string, string>; used_llm: boolean; llm_fallback_reason: string | null; manifest_sha256: string
  facts_sha256: string; diary_url: string; notices: NoticeInfo[]; verification: Verification; narrative_source: string
}
export interface LlmStatus { available: boolean; model: string }

export interface CountRow { key: string; label: string; count: number }
export interface DayActivity { day: string; n_txn: number; n_flagged: number }
export interface Overview {
  accounts: number; score_hist: number[]; bands: Record<string, number>; flagged_by_role: CountRow[]
  flagged_by_bank: CountRow[]; flagged_reasons: CountRow[]; activity: DayActivity[]
}

export interface DatasetInfo { id: string; name: string; rows: number; accounts: number; sha256: string; created_at: string; status: string; active: boolean }
export interface DatasetProgress {
  id: string; status: string; stage: string | null; stages_done: Record<string, number>; rows: number; accounts: number
  flagged: number; error: string | null
}

export interface FlowLayer {
  role: 'VICTIM' | 'L1' | 'L2' | 'L3'; accounts: number; received_paise: number; passed_on_paise: number; held_paise: number
  fast_share: number | null; per_account: number | null; wallet_share: number | null
}
export interface FlowSummary {
  victims: number; loss_paise: number; avg_loss_paise: number; max_loss_paise: number; layers: FlowLayer[]
  to_l2_s: number | null; to_l3_s: number | null; freezable_paise: number; traced_ms: number
  suspects: number; linked_largest: number; linked_groups: number; sent_back: number
  club_victims: number; club_collectors: number; club_top_collector: string | null; club_top_victims: string[]
  banks: FlowBank[]; top_collectors: FlowCollector[]; to_l3_each_s: number[]
}
export interface FlowBank { bank: string; bank_name: string; accounts: number; held_paise: number }
export interface FlowCollector { account: string; victims: string[]; received_paise: number }
export interface ScoreCheck { key: string; label: string; max_points: number; points: number; detail: string }
export interface ScoreExplain {
  account: string; score: number; combined: number; floor: number | null; floor_reason: string | null
  checks: ScoreCheck[]; matches_stored: boolean
}
