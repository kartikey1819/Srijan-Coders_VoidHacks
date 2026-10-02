import { useEffect, useState } from 'react'

export type Look = 'official' | 'genz'
const KEY = 'abhedya.look'

function normalise(v: string | null): Look | null {
  if (v === 'official') return 'official'
  if (v === 'genz' || v === 'briefing') return 'genz'      // 'briefing' was the previous name of the second look
  return null
}

function initial(): Look {
  const q = normalise(new URLSearchParams(window.location.search).get('look'))
  if (q) return q
  try {
    const s = normalise(window.localStorage.getItem(KEY))
    if (s) return s
  } catch { /* storage blocked: default */ }
  return 'official'
}

/** Official / Gen-Z: one component kit, two token sets, fonts and copy voices on <html data-look>. */
export function useLook(): [Look, (l: Look) => void] {
  const [look, setLook] = useState<Look>(initial)
  useEffect(() => {
    document.documentElement.dataset.look = look
    try { window.localStorage.setItem(KEY, look) } catch { /* ignore */ }
    window.dispatchEvent(new Event('lookchange'))
  }, [look])
  return [look, setLook]
}

export function currentLook(): Look {
  return document.documentElement.dataset.look === 'genz' ? 'genz' : 'official'
}

/** Current value of a CSS custom property (Cytoscape and WebGL cannot read var()). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Re-render when the look changes; returns the look. */
export function useLookName(): Look {
  const [l, setL] = useState<Look>(currentLook)
  useEffect(() => {
    const on = () => setL(currentLook())
    window.addEventListener('lookchange', on)
    return () => window.removeEventListener('lookchange', on)
  }, [])
  return l
}

/** Kept for canvas components that only need a tick. */
export function useLookTick(): number {
  const l = useLookName()
  return l === 'genz' ? 1 : 0
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
