import { useEffect, useRef, type ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, ChevronsUp, Info, Lock } from 'lucide-react'
import type { BatchStatus, Risk, Severity, Status, UnitStatus } from '../api/server/types'

export type Tone = 'low' | 'medium' | 'high' | 'critical' | 'isolated' | 'neutral' | 'primary'
export const toneVar = (t: Tone) =>
  ({ low: 'var(--risk-low)', medium: 'var(--risk-medium)', high: 'var(--risk-high)', critical: 'var(--risk-critical)', isolated: 'var(--isolated)', neutral: 'var(--muted)', primary: 'var(--primary)' })[t]
export const riskTone = (risk: Risk, status?: Status): Tone => (status === 'ISOLATED' ? 'isolated' : ({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' } as const)[risk])
export const riskVar = (risk: Risk, status?: Status) => toneVar(riskTone(risk, status))
export const unitTone = (s: UnitStatus): Tone => ({ NORMAL: 'low', EXCURSION: 'medium', INTEGRITY_RISK: 'critical' } as const)[s]
export const batchTone = (s: BatchStatus): Tone => ({ AVAILABLE: 'low', QUARANTINE_RECOMMENDED: 'medium', QUARANTINED: 'isolated' } as const)[s]

export const sentence = (s: string) => { const t = s.replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }
export const hhmmss = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour12: false }) : '—')
export const card = 'rounded-xl border border-line bg-surface shadow-[0_1px_3px_rgba(5,15,26,0.06)]'
export const label = 'text-xs font-medium uppercase tracking-[0.06em] text-faint'

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = toneVar(tone)
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium" style={{ color: tone === 'medium' || tone === 'low' ? 'var(--ink)' : c, background: `color-mix(in srgb, ${c} 13%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {children}
    </span>
  )
}
export const RiskBadge = ({ risk, status }: { risk: Risk; status: Status }) => <Badge tone={riskTone(risk, status)}>{sentence(status)}</Badge>

const SEV_ICON = { low: Info, medium: AlertTriangle, high: ChevronsUp, critical: AlertOctagon }
export function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = SEV_ICON[severity]
  const c = toneVar(severity)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium" style={{ color: severity === 'medium' || severity === 'low' ? 'var(--ink)' : c }}>
      <Icon className="size-4" style={{ color: c }} aria-hidden />{sentence(severity)}
    </span>
  )
}

export function Button({ variant = 'secondary', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const v = {
    primary: 'bg-primary text-white hover:bg-primary-hover border-transparent',
    secondary: 'bg-surface text-ink border-line hover:border-primary',
    danger: 'bg-critical text-white border-transparent hover:opacity-90',
    ghost: 'bg-transparent text-primary border-transparent hover:bg-well',
  }[variant]
  return <button {...p} className={`inline-flex h-11 min-w-[100px] items-center justify-center gap-2 rounded-lg border px-5 text-[15px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`} />
}

export const selectCls = 'h-11 rounded-lg border border-line bg-surface px-3.5 text-[15px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-40'
export const inputCls = 'h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[15px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10'

export function StateMessage({ kind, children }: { kind: 'loading' | 'empty' | 'error'; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border border-dashed p-6 text-center text-sm ${kind === 'error' ? 'border-critical bg-critical/5 text-critical' : 'border-line text-muted'}`}>
      {kind === 'loading' && <span className="mx-auto mb-3 block h-2 w-24 animate-pulse rounded bg-well" />}
      {children}
    </div>
  )
}

export function RoleNotice({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-[13px] text-muted"><Lock className="size-3.5 shrink-0" aria-hidden />{children}</p>
}
export function InlineError({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="text-[13px] font-medium text-critical">{children}</p> : null
}

export function Metrics({ items }: { items: { label: string; value: string; tone?: Tone; hint?: string }[] }) {
  return (
    <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line ${items.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {items.map((m, i) => (
        <div key={m.label} className={`bg-surface p-4 sm:p-5 ${items.length === 5 && i === 4 ? 'col-span-2 lg:col-span-1' : ''}`}>
          <dt className="text-[13px] text-muted">{m.label}</dt>
          <dd className="mt-1 font-mono text-3xl font-medium tracking-tight" style={{ color: m.tone ? toneVar(m.tone) : undefined }}>{m.value}</dd>
          {m.hint && <dd className="mt-0.5 text-[13px] text-faint">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** Visually hidden heading that receives focus after a route change. */
export function PageHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return <h1 ref={ref} tabIndex={-1} className="sr-only">{children}</h1>
}

export function ChainBadge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium ${ok ? 'bg-low/12 text-ink' : 'bg-critical/10 text-critical'}`}>
      <span className={`size-1.5 rounded-full ${ok ? 'bg-low' : 'bg-critical'}`} />{children}
    </span>
  )
}

export function SelectCard({ selected, tone, onClick, children }: { selected: boolean; tone: Tone; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={selected}
      className={`flex w-full items-center gap-3 border border-l-4 bg-surface p-4 text-left shadow-[0_1px_3px_rgba(5,15,26,0.06)] transition-colors hover:border-primary rounded-xl ${selected ? 'border-primary ring-2 ring-primary/25' : 'border-line'}`}
      style={{ borderLeftColor: toneVar(tone) }}>
      {children}
    </button>
  )
}
