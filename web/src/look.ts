import { useEffect, useState } from 'react'

export type Look = 'official' | 'briefing'
const KEY = 'abhedya.look'

function initial(): Look {
  const q = new URLSearchParams(window.location.search).get('look')
  if (q === 'official' || q === 'briefing') return q
  try {
    const s = window.localStorage.getItem(KEY)
    if (s === 'official' || s === 'briefing') return s
  } catch { /* storage blocked: default */ }
  return 'official'
}

/** The Official / Briefing switch: one component kit, two sets of tokens on <html data-look>. */
export function useLook(): [Look, (l: Look) => void] {
  const [look, setLook] = useState<Look>(initial)
  useEffect(() => {
    document.documentElement.dataset.look = look
    try { window.localStorage.setItem(KEY, look) } catch { /* ignore */ }
    window.dispatchEvent(new Event('lookchange'))
  }, [look])
  return [look, setLook]
}

/** Current value of a CSS custom property (Cytoscape cannot read var()). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Re-render when the look changes, so canvas charts can re-read their colours. */
export function useLookTick(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const on = () => setN((x) => x + 1)
    window.addEventListener('lookchange', on)
    return () => window.removeEventListener('lookchange', on)
  }, [])
  return n
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
