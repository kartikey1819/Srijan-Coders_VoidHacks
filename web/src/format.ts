/** 45554161 paise -> "₹4,55,541.61" (Indian digit grouping). */
export function inr(paise: number): string {
  const neg = paise < 0
  const abs = Math.abs(Math.round(paise))
  const rupees = Math.floor(abs / 100).toString()
  const p = (abs % 100).toString().padStart(2, '0')
  let s = rupees
  if (rupees.length > 3) {
    let head = rupees.slice(0, -3)
    const groups: string[] = []
    while (head.length > 2) { groups.unshift(head.slice(-2)); head = head.slice(0, -2) }
    if (head) groups.unshift(head)
    s = [...groups, rupees.slice(-3)].join(',')
  }
  return `${neg ? '-' : ''}₹${s}.${p}`
}

/** Compact amount for graph labels: ₹4.56 L, ₹1.2 Cr, ₹950. */
export function inrShort(paise: number): string {
  const r = paise / 100
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)} K`
  return `₹${r.toFixed(0)}`
}

/** "YYYY-MM-DD HH:MM:SS" (as in the data) -> epoch seconds, read as UTC so it round-trips exactly. */
export function toEpoch(ts: string): number {
  return Date.parse(ts.replace(' ', 'T') + 'Z') / 1000
}

export function fromEpoch(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

export function delayText(s: number | null): string {
  if (s === null) return ''
  if (s < 60) return `${s} s later`
  if (s < 3600) return `${Math.round(s / 60)} min later`
  if (s < 86400) return `${(s / 3600).toFixed(1)} h later`
  return `${(s / 86400).toFixed(1)} days later`
}

export const RULE_TEXT: Record<string, string> = {
  seed: 'disputed transfer', window: 'passed on within 3-15 min', amount_match: 'passed on at >= 90% of one credit',
  oldest: 'balance rule (own money spent first)',
}

/** Seconds after the theft, as an officer would say it: "T+7 min", "T+2 h 05 min", "T+3 d 4 h". */
export function tPlus(s: number): string {
  if (!Number.isFinite(s) || s < 0) return 'T+0'
  if (s < 60) return `T+${Math.round(s)} s`
  if (s < 3600) return `T+${Math.floor(s / 60)} min`
  if (s < 86400) return `T+${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`
  return `T+${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`
}

export function spanText(s: number): string {
  if (s < 60) return `${Math.round(s)} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`
  return `${(s / 86400).toFixed(1)} days`
}

/** Account IDs in this data: 4-letter bank prefix + 8 digits. */
export const ACCOUNT_RE = /^[A-Z]{4}\d{8}$/
export function accountHint(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  if (ACCOUNT_RE.test(s)) return null
  if (s.length !== 12) return `Account IDs are 12 characters: 4 letters + 8 digits (you typed ${s.length}).`
  return 'Account IDs are 4 letters (bank) followed by 8 digits.'
}

/** Short names for risk reason codes (full sentences come from /api/risk/reasons). */
export const REASON_SHORT: Record<string, string> = {
  PT_STRICT: '3-15 min pass-through', PT_LENIENT: '<15 min pass-through', FANOUT_EPISODES: 'split to 3-7',
  FANIN_BURST: 'fan-in burst', FANIN_DRAIN: 'drained collector', CYCLE: 'repeated ring', TERM_OUT: 'cash-out sent', TERM_IN: 'cash-out received',
  TERM_IN_FROM_SCRIPT_OR_FOREIGN: 'cash-out from script/proxy', SCRIPT_DEVICE_OUT: 'script device',
  FOREIGN_PROXY_IP_OUT: 'foreign proxy IP', SINK: 'keeps the money', LINKED_TO_FLAGGED: 'linked to suspects',
}

export const ROLE_TEXT: Record<string, string> = {
  VICTIM: 'Victim', L1: 'L1 collector', L2: 'L2 distributor', L3: 'L3 cash-out', UNKNOWN: 'Unknown',
}
