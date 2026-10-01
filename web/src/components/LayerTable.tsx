import { inr, ROLE_TEXT } from '../format'
import type { TraceResult } from '../types'

interface Props { trace: TraceResult; selected: string | null; onSelect: (a: string) => void }

/** The exact L1 / L2 / L3 accounts, readable at a glance (the blind test asks for exactly these). */
export function LayerTable({ trace, selected, onSelect }: Props) {
  const roles = ['L1', 'L2', 'L3'] as const
  return (
    <div className="card">
      <h3>Accounts on the money trail</h3>
      {roles.map((r) => {
        const rows = trace.nodes.filter((n) => n.role === r)
        return (
          <details key={r} open>
            <summary><span className={`dot ${r}`} />{ROLE_TEXT[r]} <span className="muted">({rows.length})</span></summary>
            {rows.length === 0 ? <p className="muted small">None</p> : (
              <table className="tbl">
                <thead><tr><th>Account</th><th>Bank</th><th className="num">Received</th><th className="num">Holds</th></tr></thead>
                <tbody>
                  {rows.map((n) => (
                    <tr key={n.account} className={n.account === selected ? 'sel' : ''} onClick={() => onSelect(n.account)}>
                      <td className="mono">{n.account}</td><td>{n.bank_name}</td>
                      <td className="num">{inr(n.received_paise)}</td>
                      <td className="num">{n.held_paise > 0 ? inr(n.held_paise) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        )
      })}
    </div>
  )
}
