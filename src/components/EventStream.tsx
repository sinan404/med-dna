import type { ChainCheck, DnaEvent } from '../api/server/types'
import { ROLE_LABELS, type Role } from '../api/server/types'
import { ChainBadge, StateMessage, card, hhmmss } from './ui'

export const roleLabel = (r: string) => ROLE_LABELS[r as Role] ?? (r === 'system' ? 'System' : r)

// Fallback when /events/verify is unavailable: each prev_hash must equal the next-older hash.
const localVerify = (events: DnaEvent[]) => events.every((e, i) => i === events.length - 1 || e.prev_hash === events[i + 1].hash)

export default function EventStream({ events, check, allowed }: { events: DnaEvent[]; check: ChainCheck | null; allowed: boolean }) {
  const verified = check ? check.valid : localVerify(events)
  return (
    <section aria-labelledby="events-heading" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="events-heading" className="text-lg font-bold">Security event stream</h2>
        {allowed && events.length > 0 && <ChainBadge ok={verified}>{verified ? 'Hash chain verified' : 'Hash chain broken'}</ChainBadge>}
      </div>
      {!allowed ? (
        <div className="p-5"><StateMessage kind="empty">Your role can't view the event log.</StateMessage></div>
      ) : events.length === 0 ? (
        <div className="p-5"><StateMessage kind="empty">No events yet. Select a device and simulate a mutation.</StateMessage></div>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs uppercase tracking-[0.06em] text-faint">
              <tr>{['Time', 'Actor', 'Target', 'Detail', 'Score', 'Hash'].map((h) => <th key={h} className={`px-5 py-3 font-medium ${h === 'Score' ? 'text-right' : ''}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e) => (
                <tr key={e.hash} className="hover:bg-bg">
                  <td className="px-5 py-3 font-mono text-[13px] text-muted">{hhmmss(e.timestamp)}</td>
                  <td className="px-5 py-3"><span className="font-medium">{e.actor}</span><span className="block text-[13px] text-muted">{roleLabel(e.actor_role)}</span></td>
                  <td className="px-5 py-3 font-medium">{e.target_name}</td>
                  <td className="px-5 py-3 text-muted">{e.detail}</td>
                  <td className="px-5 py-3 text-right font-mono text-[13px]">{e.dna_score == null ? '' : `${e.dna_score}%`}</td>
                  <td className="px-5 py-3 font-mono text-[13px] text-primary" title={e.hash}>{e.hash.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
