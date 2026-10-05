import type { LedgerCheck, LedgerEntry } from '../../api/server/types'
import { ChainBadge, StateMessage, card, hhmmss } from '../ui'

const FLAG_TEXT: Record<string, string> = {
  signature_invalid: 'signature does not match', replay_suspected: 'replayed reading', sequence_gap: 'sequence gap',
  implausible_reading: 'impossible change', temperature_excursion: 'outside safe range',
}

export default function LedgerTable({ entries, check }: { entries: LedgerEntry[]; check: LedgerCheck | null }) {
  return (
    <section aria-labelledby="ledger-heading" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="ledger-heading" className="text-lg font-bold">Signed-reading ledger</h2>
        {check && <ChainBadge ok={check.valid}>{check.valid ? 'Ledger chain verified' : `Ledger chain broken at reading ${check.first_broken_seq}`}</ChainBadge>}
      </div>
      {entries.length === 0 ? <div className="p-5"><StateMessage kind="loading">Loading ledger…</StateMessage></div> : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs uppercase tracking-[0.06em] text-faint">
              <tr>{['Time', 'Seq', 'Temp', 'Result', 'Signature', 'Hash'].map((h) => <th key={h} className={`px-5 py-3 font-medium ${h === 'Temp' || h === 'Seq' ? 'text-right' : ''}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e, i) => {
                const broken = check && !check.valid && check.first_broken_seq === e.seq
                return (
                  <tr key={`${e.hash}-${i}`} className={broken ? 'bg-critical/5' : 'hover:bg-bg'}>
                    <td className="px-5 py-2.5 font-mono text-[13px] text-muted">{hhmmss(e.timestamp)}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[13px]">{e.seq}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[13px]">{e.temperature_c.toFixed(2)} °C</td>
                    <td className="px-5 py-2.5">
                      {e.check_result === 'OK' ? <span className="text-muted">OK</span> : <span className="font-medium text-critical">Flagged: {e.flags.map((f) => FLAG_TEXT[f] ?? f).join(', ')}</span>}
                      {broken && <span className="ml-2 inline-block rounded bg-critical px-1.5 py-0.5 text-[12px] font-bold text-white">First broken entry</span>}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[13px] text-muted" title={e.signature}>{e.signature.slice(0, 12)}</td>
                    <td className="px-5 py-2.5 font-mono text-[13px] text-primary" title={e.hash}>{e.hash.slice(0, 12)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
