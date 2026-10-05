import { useState } from 'react'
import { AlertTriangle, ShieldCheck, ShieldOff, Info, RotateCcw, Zap, Check, X, Undo2 } from 'lucide-react'
import { PRESET_LABELS, type Attribute, type DeviceDetail, type Preset } from '../api/server/types'
import { useAuth } from '../hooks/useAuth'
import { Button, InlineError, RiskBadge, RoleNotice, card, riskVar, selectCls } from './ui'

const fmt = (n: number, unit: string) => `${n}${unit}`

function AttributeTrack({ a }: { a: Attribute }) {
  const max = a.baseline + a.tolerance
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`
  const color = a.similarity >= 0.8 ? 'var(--risk-low)' : a.similarity >= 0.5 ? 'var(--risk-medium)' : 'var(--risk-critical)'
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[180px_1fr_120px]">
      <span className="text-sm font-medium">{a.label}</span>
      <span className="text-right font-mono text-[13px] text-muted sm:order-3">
        {fmt(a.baseline, a.unit)} <span className="text-faint">→</span> <span style={{ color }}>{fmt(a.observed, a.unit)}</span>
      </span>
      <div role="img" aria-label={`${a.label}: baseline ${a.baseline}, observed ${a.observed}`} className="relative col-span-2 h-6 sm:col-span-1 sm:order-2">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-well" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full" style={{ left: `min(${pos(a.baseline)}, ${pos(a.observed)})`, width: `${Math.abs(Math.min(a.observed, max) - a.baseline) / max * 100}%`, background: `color-mix(in srgb, ${color} 35%, transparent)` }} />
        <div className="absolute top-0.5 h-5 w-0.5 -translate-x-1/2 bg-ink" style={{ left: pos(a.baseline) }} />
        <div className="track-dot absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface" style={{ left: pos(a.observed), background: color }} />
      </div>
    </li>
  )
}

interface Props {
  detail: DeviceDetail
  pending: string | null
  error: string | null
  onSimulate: (p: Preset) => void
  onReset: () => void
  onAction: (a: 'isolate' | 'restore' | 'acknowledge') => void
}

export default function DnaPanel({ detail: d, pending, error, onSimulate, onReset, onAction }: Props) {
  const [preset, setPreset] = useState<Preset>('combined')
  const [confirming, setConfirming] = useState(false)
  const c = riskVar(d.risk, d.status)
  const busy = !!pending
  const { can } = useAuth()
  const canSim = can('device.simulate'), canReset = can('device.reset'), canIso = can('device.isolate'), canRestore = can('device.restore'), canAck = can('alert.acknowledge')
  const notice = !canSim && !canIso && !canAck ? 'Your role is read-only.'
    : !canSim || !canIso ? `Simulation, isolation, restore, and reset require the Security Operator or Admin role.${canAck ? ' You can acknowledge alerts.' : ''}` : null

  return (
    <section aria-labelledby="dna-heading" className={`overflow-hidden ${card}`}>
      <div className="h-1" style={{ background: c }} />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Digital DNA · {d.type}</p>
            <h2 id="dna-heading" className="mt-1 text-xl font-bold tracking-tight">{d.name}</h2>
            <p className="font-mono text-[13px] text-muted">{d.id} · {d.location}</p>
          </div>
          <RiskBadge risk={d.risk} status={d.status} />
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="font-mono text-[76px] font-medium leading-none tracking-[-0.04em]" style={{ color: c }}>
            {d.dna_score}<span className="text-4xl">%</span>
          </div>
          <div className="pb-2 text-sm text-muted">
            DNA match to baseline<br />
            Risk <strong className="font-medium" style={{ color: c }}>{d.risk.toLowerCase()}</strong>
            {d.acknowledged && <> · <span className="text-ink">acknowledged</span></>}
          </div>
        </div>

        <p className="mt-5 flex gap-2 rounded-lg bg-well p-3 text-[13px] leading-relaxed text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Risk is not proof of compromise. A low match means behavior differs from this device's baseline, which can come from an attack, a malfunction, or a configuration change.
        </p>

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.06em] text-faint">
            <span>Attribute</span><span>Baseline → observed</span>
          </div>
          <ul className="mt-1 divide-y divide-line">{d.attributes.map((a) => <AttributeTrack key={a.key} a={a} />)}</ul>
        </div>

        {d.deviations.length > 0 && (
          <div className="mt-5 rounded-lg border border-line border-l-4 p-4" style={{ borderLeftColor: c }}>
            <h3 className="flex items-center gap-2 text-[15px] font-bold"><AlertTriangle className="size-4" style={{ color: c }} aria-hidden /> Why the score dropped</h3>
            <ul className="mt-3 space-y-1.5">
              {d.deviations.map((x) => (
                <li key={x.key} className="flex flex-wrap justify-between gap-x-4 text-sm">
                  <span>{x.label}: <span className="font-mono text-[13px]">{fmt(x.baseline, x.unit)} → {fmt(x.observed, x.unit)}</span></span>
                  <span className="font-mono text-[13px] font-medium text-critical">−{x.point_impact.toFixed(1)} pts</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 border-t border-line pt-5">
          <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Response controls</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="preset">Mutation preset</label>
            <select id="preset" value={preset} disabled={busy || !canSim} onChange={(e) => setPreset(e.target.value as Preset)}
              className={`${selectCls} flex-1 basis-48`}>
              {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
            </select>
            <Button variant="primary" disabled={busy || !canSim} onClick={() => onSimulate(preset)}><Zap className="size-4" />{pending === 'simulate' ? 'Simulating…' : 'Simulate mutation'}</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {confirming ? (
              <>
                <Button variant="danger" disabled={busy || !canIso} onClick={() => { setConfirming(false); onAction('isolate') }}><Check className="size-4" />Confirm isolation</Button>
                <Button disabled={busy} onClick={() => setConfirming(false)}><X className="size-4" />Cancel</Button>
              </>
            ) : (
              <Button disabled={busy || !canIso || d.isolated || d.deviations.length === 0} onClick={() => setConfirming(true)}><ShieldOff className="size-4" />Approve isolation</Button>
            )}
            <Button disabled={busy || !canRestore || !d.isolated} onClick={() => onAction('restore')}><Undo2 className="size-4" />Restore</Button>
            <Button disabled={busy || !canAck || d.risk === 'LOW' || d.acknowledged} onClick={() => onAction('acknowledge')}><Check className="size-4" />Acknowledge</Button>
            <Button variant="ghost" disabled={busy || !canReset} onClick={() => { setConfirming(false); onReset() }}><RotateCcw className="size-4" />Reset DNA</Button>
          </div>
          <div className="mt-3 space-y-1">
            {notice && <RoleNotice>{notice}</RoleNotice>}
            <InlineError>{error}</InlineError>
          </div>
        </div>

        {d.isolated ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg p-3 text-sm font-medium" style={{ color: 'var(--isolated)', background: 'color-mix(in srgb, var(--isolated) 10%, transparent)' }}>
            <ShieldOff className="size-4 shrink-0" aria-hidden /> External communication blocked. Clinical operation: CONTINUE.
          </p>
        ) : d.risk !== 'LOW' ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted"><AlertTriangle className="size-4 shrink-0 text-medium" aria-hidden />Recommended: isolate suspicious network communication. Clinical operation continues either way.</p>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted"><ShieldCheck className="size-4 shrink-0 text-low" aria-hidden />Behaving like itself. No action needed.</p>
        )}
      </div>
    </section>
  )
}
