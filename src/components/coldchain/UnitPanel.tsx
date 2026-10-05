import { useState } from 'react'
import { CheckCircle2, Info, PackageCheck, RotateCcw, ShieldAlert, XCircle, Zap } from 'lucide-react'
import { ATTACK_LABELS, type Attack, type Batch, type Check, type UnitDetail } from '../../api/server/types'
import { useAuth } from '../../hooks/useAuth'
import { Badge, Button, InlineError, RoleNotice, batchTone, card, hhmmss, inputCls, label, selectCls, sentence, toneVar, unitTone } from '../ui'
import TempChart from './TempChart'

const STATUS_MSG = {
  INTEGRITY_RISK: "Readings from this unit can't be trusted until the checks pass. Treat the temperature as unconfirmed.",
  EXCURSION: 'The data looks authentic, and the temperature is outside the safe range. This is a real temperature problem to review.',
  NORMAL: 'Readings are signed, in sequence, plausible, and within range.',
}

function CheckRow({ c }: { c: Check }) {
  const pass = c.state === 'pass'
  return (
    <li className="flex gap-3 py-3">
      {pass ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-low" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="font-medium">{c.label}</span>
          <span className={`font-mono text-[13px] font-medium ${pass ? 'text-ink' : 'text-critical'}`}>{pass ? 'Pass' : 'Fail'}</span>
        </p>
        <p className="mt-0.5 text-[13px] text-muted">{c.detail}</p>
      </div>
    </li>
  )
}

interface Props {
  unit: UnitDetail
  pending: string | null
  error: string | null
  confirmMsg: string | null
  onAttack: (a: Attack) => void
  onReset: () => void
  onBatch: (id: string, action: 'quarantine' | 'release', note?: string) => void
}

export default function UnitPanel({ unit: u, pending, error, confirmMsg, onAttack, onReset, onBatch }: Props) {
  const { can } = useAuth()
  const [attack, setAttack] = useState<Attack>('spoof')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const busy = !!pending
  const tone = unitTone(u.status)
  const integrity = u.checks.filter((c) => c.key !== 'temperature_range')
  const process = u.checks.filter((c) => c.key === 'temperature_range')
  const canSim = can('coldchain.simulate') && can('coldchain.reset')
  const canQ = can('batch.quarantine'), canRel = can('batch.release')
  const recommended = u.batches.some((b) => b.status === 'QUARANTINE_RECOMMENDED')

  const BatchRow = ({ b }: { b: Batch }) => (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[13px] text-muted">{b.id}</p>
          <p className="font-bold">{b.product}</p>
          <p className="font-mono text-[13px]">{b.quantity} {b.quantity_unit}</p>
        </div>
        <Badge tone={batchTone(b.status)}>{sentence(b.status)}</Badge>
      </div>
      {b.status === 'QUARANTINED' && (
        <p className="mt-2 text-[13px] text-muted">Approved by <span className="font-medium text-ink">{b.quarantined_by}</span> at <span className="font-mono">{hhmmss(b.quarantined_at)}</span>{b.note && <> · “{b.note}”</>}</p>
      )}
      {confirming === b.id ? (
        <div className="mt-3 space-y-2 rounded-lg bg-well p-3">
          <label className="block text-[13px] font-medium">Note (optional)
            <input className={`${inputCls} mt-1`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the hold" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy || !canQ} onClick={() => { onBatch(b.id, 'quarantine', note); setConfirming(null); setNote('') }}>Confirm quarantine</Button>
            <Button disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy || !canQ || b.status === 'QUARANTINED'} onClick={() => { setConfirming(b.id); setNote('') }}><ShieldAlert className="size-4" />Approve quarantine</Button>
          {b.status === 'QUARANTINED' && <Button variant="ghost" disabled={busy || !canRel || u.status !== 'NORMAL'} onClick={() => onBatch(b.id, 'release')}><PackageCheck className="size-4" />Release batch</Button>}
        </div>
      )}
      {b.status === 'QUARANTINED' && u.status !== 'NORMAL' && <p className="mt-2 text-[13px] text-muted">The unit readings are still flagged. Reset the unit and confirm the checks pass first.</p>}
    </li>
  )

  return (
    <section aria-labelledby="unit-heading" className={`overflow-hidden ${card}`}>
      <div className="h-1" style={{ background: toneVar(tone) }} />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={label}>Cold chain · {u.location}</p>
            <h2 id="unit-heading" className="mt-1 text-xl font-bold tracking-tight">{u.name}</h2>
            <p className="font-mono text-[13px] text-muted">{u.id}</p>
          </div>
          <Badge tone={tone}>{sentence(u.status)}</Badge>
        </div>
        <p className="mt-3 text-sm">{STATUS_MSG[u.status]}</p>

        <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="font-mono text-[76px] font-medium leading-none tracking-[-0.04em]" style={{ color: u.status === 'NORMAL' ? undefined : toneVar(tone) }}>
            {u.last_temperature.toFixed(1)}<span className="text-4xl">°C</span>
          </div>
          <div className="pb-2 text-sm text-muted">
            Safe range {u.safe_min} to {u.safe_max} °C<br />
            {u.status === 'INTEGRITY_RISK' ? 'Unconfirmed reading' : 'Latest reading'} at <span className="font-mono">{hhmmss(u.last_reading_at)}</span>
          </div>
        </div>

        <p className="mt-5 flex gap-2 rounded-lg bg-well p-3 text-[13px] leading-relaxed text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          An integrity risk means a reading failed a check. It does not prove tampering; it can also come from a faulty sensor, gateway, or clock. An excursion means the temperature left the safe range while the readings passed every integrity check. Neither one changes any stock until a pharmacist approves.
        </p>

        <div className="mt-6"><TempChart unit={u} /></div>

        <div className="mt-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="rounded-lg border border-line px-4">
            <h3 className={`pt-3 ${label}`}>Integrity checks</h3>
            <ul className="divide-y divide-line">{integrity.map((c) => <CheckRow key={c.key} c={c} />)}</ul>
          </div>
          <div className="self-start rounded-lg border border-dashed border-line px-4">
            <h3 className={`pt-3 ${label}`}>Process check</h3>
            <ul>{process.map((c) => <CheckRow key={c.key} c={c} />)}</ul>
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <h3 className={label}>Batches in this unit</h3>
          {recommended && <p className="mt-2 text-sm text-ink">Recommended: pharmacist review of this batch. Nothing is quarantined until a pharmacist approves.</p>}
          {confirmMsg && <p role="status" className="mt-2 rounded-lg bg-isolated/10 p-3 text-sm font-medium text-isolated">{confirmMsg}</p>}
          <ul className="divide-y divide-line">{u.batches.map((b) => <BatchRow key={b.id} b={b} />)}</ul>
          {!canQ && <RoleNotice>Quarantine requires the Pharmacist role.</RoleNotice>}
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <h3 className={label}>Attack simulation</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="attack">Attack preset</label>
            <select id="attack" className={`${selectCls} flex-1 basis-56`} value={attack} disabled={busy || !canSim} onChange={(e) => setAttack(e.target.value as Attack)}>
              {(Object.keys(ATTACK_LABELS) as Attack[]).map((a) => <option key={a} value={a}>{ATTACK_LABELS[a]}</option>)}
            </select>
            <Button variant="primary" disabled={busy || !canSim} onClick={() => onAttack(attack)}><Zap className="size-4" />{pending === 'attack' ? 'Simulating…' : 'Simulate attack'}</Button>
            <Button variant="ghost" disabled={busy || !canSim} onClick={onReset}><RotateCcw className="size-4" />Reset unit</Button>
          </div>
          <div className="mt-3 space-y-1">
            {!canSim && <RoleNotice>Attack simulation and unit reset require the Security Operator or Admin role.</RoleNotice>}
            <InlineError>{error}</InlineError>
          </div>
        </div>
      </div>
    </section>
  )
}
