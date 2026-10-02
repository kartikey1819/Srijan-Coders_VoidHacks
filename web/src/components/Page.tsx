import type { ReactNode } from 'react'

/** Every screen: breadcrumb, English title with the Hindi title beneath, one line on what the page is for, actions. */
export function Page({ title, hi, desc, actions, children }: {
  title: string; hi: string; desc?: ReactNode; actions?: ReactNode; children: ReactNode
}) {
  return (
    <div className="gpage">
      <div className="phead">
        <div className="phead-text">
          <div className="pcrumbs">Cyber Crime Cell <span aria-hidden="true">›</span> {title}</div>
          <h1>{title}<span className="hi" lang="hi">{hi}</span></h1>
          {desc && <p>{desc}</p>}
        </div>
        {actions && <div className="phead-acts">{actions}</div>}
      </div>
      <div className="gpage-body">{children}</div>
      <footer className="gfoot">
        <span>Indore Police Commissionerate · Cyber Crime Cell</span>
        <span>All analysis runs on this computer; no data leaves the system.</span>
        <span>Results are investigative aids: verify against bank records before legal use.</span>
      </footer>
    </div>
  )
}

/** A bordered section with a heading bar: title, a one-line note on how to read it, and optional actions. */
export function Panel({ title, note, actions, children, flush, id, className }: {
  title?: ReactNode; note?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; id?: string; className?: string
}) {
  return (
    <section className={`gpanel${className ? ' ' + className : ''}`} id={id}>
      {title && (
        <div className="gpanel-h">
          <h2>{title}</h2>
          {note && <span className="note">{note}</span>}
          {actions && <div className="gpanel-acts">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'gpanel-b'}>{children}</div>
    </section>
  )
}

const ROLE_NAME: Record<string, string> = {
  VICTIM: 'Victim', L1: 'Layer 1 · Collector', L2: 'Layer 2 · Distributor', L3: 'Layer 3 · Cash-out', UNKNOWN: 'Not on a layer',
}
export function RoleBadge({ role }: { role: string }) {
  return <span className={`rbadge r-${role}`}>{ROLE_NAME[role] ?? role}</span>
}
