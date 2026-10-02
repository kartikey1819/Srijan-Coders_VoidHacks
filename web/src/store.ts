/** localStorage that never throws (private windows, blocked storage): layouts and preferences only. */
export const safeStorage = {
  getItem(k: string): string | null {
    try { return window.localStorage.getItem(k) } catch { return null }
  },
  setItem(k: string, v: string): void {
    try { window.localStorage.setItem(k, v) } catch { /* ignore */ }
  },
}

export type CaseSteps = { reviewed: boolean; ring: boolean; notices: boolean }

/** What the officer has done on one victim's case in this browser session (traced is implied by being here). */
export function readSteps(victim: string): CaseSteps {
  try {
    const s = window.sessionStorage.getItem(`abhedya.case.${victim}`)
    if (s) return { reviewed: false, ring: false, notices: false, ...JSON.parse(s) }
  } catch { /* ignore */ }
  return { reviewed: false, ring: false, notices: false }
}

export function markStep(victim: string, step: keyof CaseSteps): CaseSteps {
  const s = { ...readSteps(victim), [step]: true }
  try { window.sessionStorage.setItem(`abhedya.case.${victim}`, JSON.stringify(s)) } catch { /* ignore */ }
  window.dispatchEvent(new Event('casestep'))
  return s
}
