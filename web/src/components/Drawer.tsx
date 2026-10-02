import { X } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'

/** Side panel over the page: opens where the eye is (not below the fold), Esc closes, focus returns. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); back?.focus?.() }
  }, [onClose])
  return (
    <aside className="drawer" role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
      <header><span className="small muted">{title}</span>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close panel"><X /> Close</button></header>
      <div className="body">{children}</div>
    </aside>
  )
}
