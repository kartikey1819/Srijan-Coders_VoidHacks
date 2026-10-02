import { ArrowsIn, ArrowsOut, CaretDown, CaretUp } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  collapsed?: boolean
  onToggleCollapse?: () => void
  label?: string
}

/** A titled panel inside a resizable layout: maximize to fill the work area (Esc restores), optional collapse. */
export function PanelFrame({ title, actions, children, collapsed, onToggleCollapse, label }: Props) {
  const [max, setMax] = useState(false)
  useEffect(() => {
    if (!max) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMax(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [max])
  return (
    <section className={`pframe${max ? ' max' : ''}`} aria-label={label}>
      <div className="phead">
        {typeof title === 'string' ? <h2>{title}</h2> : title}
        {actions}
        {onToggleCollapse && !max && (
          <button className="icon-btn" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                  title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? <CaretDown /> : <CaretUp />}</button>
        )}
        <button className="icon-btn" onClick={() => setMax((m) => !m)} aria-label={max ? 'Restore panel size' : 'Maximize panel'}
                title={max ? 'Restore (Esc)' : 'Maximize'}>{max ? <ArrowsIn /> : <ArrowsOut />}</button>
      </div>
      {!collapsed && <div className="pbody">{children}</div>}
    </section>
  )
}
