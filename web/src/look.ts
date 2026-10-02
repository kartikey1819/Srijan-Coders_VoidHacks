import { useEffect, useState } from 'react'

/** Day / Night: one set of colour tokens per theme on <html data-theme>. Remembered per browser; ?theme= overrides. */
export type Theme = 'light' | 'dark'
const KEY = 'abhedya.theme'

function normalise(v: string | null): Theme | null {
  return v === 'light' || v === 'dark' ? v : null
}

function initial(): Theme {
  const q = normalise(new URLSearchParams(window.location.search).get('theme'))
  if (q) return q
  try {
    const s = normalise(window.localStorage.getItem(KEY))
    if (s) return s
  } catch { /* storage blocked: default */ }
  return 'light'
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(initial)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem(KEY, theme) } catch { /* ignore */ }
    window.dispatchEvent(new Event('themechange'))
  }, [theme])
  return [theme, setTheme]
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** Current value of a CSS custom property (Cytoscape and WebGL cannot read var()). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Re-render when the theme changes; returns the theme. */
export function useThemeName(): Theme {
  const [t, setT] = useState<Theme>(currentTheme)
  useEffect(() => {
    const on = () => setT(currentTheme())
    window.addEventListener('themechange', on)
    return () => window.removeEventListener('themechange', on)
  }, [])
  return t
}

/** A number that changes with the theme, for canvas components that re-read colours. */
export function useThemeTick(): number {
  return useThemeName() === 'dark' ? 1 : 0
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
