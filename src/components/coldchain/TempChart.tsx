import type { UnitDetail } from '../../api/server/types'

const W = 640, H = 220, PAD = { l: 40, r: 16, t: 14, b: 26 }
const VIEW_LIMIT = 10 // y axis may expand this far beyond the default span before clamping

export default function TempChart({ unit }: { unit: UnitDetail }) {
  const pts = [...unit.readings].reverse()
  const temps = pts.map((p) => p.temperature_c)
  const lo = Math.max(unit.safe_min - 2 - VIEW_LIMIT, Math.min(unit.safe_min - 2, ...temps))
  const hi = Math.min(unit.safe_max + 2 + VIEW_LIMIT, Math.max(unit.safe_max + 2, ...temps))
  const x = (i: number) => PAD.l + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (W - PAD.l - PAD.r))
  const y = (t: number) => PAD.t + ((hi - Math.max(lo, Math.min(hi, t))) / (hi - lo)) * (H - PAD.t - PAD.b)
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const flagged = pts.filter((p) => p.check_result === 'FLAGGED').length
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.temperature_c).toFixed(1)}`).join(' ')
  const latest = unit.readings[0]?.temperature_c

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`${unit.name} temperature, last ${pts.length} readings: latest ${latest?.toFixed(1)} degrees, ${flagged} flagged reading${flagged === 1 ? '' : 's'}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="fill-faint font-mono text-[11px]">{t.toFixed(0)}°</text>
          </g>
        ))}
        <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(unit.safe_max)} height={y(unit.safe_min) - y(unit.safe_max)} fill="var(--risk-low)" opacity={0.1} />
        {[unit.safe_max, unit.safe_min].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--risk-low)" strokeOpacity={0.6} />
            <text x={W - PAD.r - 4} y={y(t) + (t === unit.safe_max ? -5 : 13)} textAnchor="end" className="fill-muted font-mono text-[11px]">{t === unit.safe_max ? 'max' : 'min'} {t} °C</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" opacity={0.75} />
        {pts.map((p, i) => {
          const cx = x(i), cy = y(p.temperature_c)
          const clipped = p.temperature_c > hi ? 'up' : p.temperature_c < lo ? 'down' : null
          if (clipped) return <path key={`${p.seq}-${i}`} d={clipped === 'up' ? `M${cx - 5},${cy + 8} L${cx},${cy} L${cx + 5},${cy + 8}Z` : `M${cx - 5},${cy - 8} L${cx},${cy} L${cx + 5},${cy - 8}Z`} fill="var(--risk-critical)" />
          return p.check_result === 'FLAGGED'
            ? <rect key={`${p.seq}-${i}`} x={cx - 4.5} y={cy - 4.5} width={9} height={9} transform={`rotate(45 ${cx} ${cy})`} fill="var(--risk-critical)" stroke="var(--surface)" strokeWidth={1.5} />
            : <circle key={`${p.seq}-${i}`} cx={cx} cy={cy} r={3} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
        })}
        <text x={PAD.l} y={H - 6} className="fill-faint font-mono text-[11px]">oldest</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-faint font-mono text-[11px]">latest</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1.5"><svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="3.5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" /></svg>Normal reading</span>
        <span className="inline-flex items-center gap-1.5"><svg width="12" height="12" aria-hidden><rect x="2.5" y="2.5" width="7" height="7" transform="rotate(45 6 6)" fill="var(--risk-critical)" /></svg>Flagged reading</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-low/20 ring-1 ring-low/60" aria-hidden />Safe range</span>
      </figcaption>
    </figure>
  )
}
