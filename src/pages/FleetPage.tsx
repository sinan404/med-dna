import { useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { ApiError, api, errorText } from '../api/client'
import type { ChainCheck, DeviceDetail, DeviceSummary, DnaEvent, Preset } from '../api/server/types'
import DnaPanel from '../components/DnaPanel'
import EventStream from '../components/EventStream'
import { Metrics, PageHeading, RiskBadge, SelectCard, StateMessage, label, riskTone, riskVar, sentence } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import usePolling from '../hooks/usePolling'

export default function FleetPage() {
  const { can, refresh: refreshMe } = useAuth()
  const [params, setParams] = useSearchParams()
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null)
  const [detail, setDetail] = useState<DeviceDetail | null>(null)
  const [events, setEvents] = useState<DnaEvent[]>([])
  const [check, setCheck] = useState<ChainCheck | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const selectedId = params.get('device') ?? devices?.[0]?.id ?? null
  const selRef = useRef(selectedId)
  selRef.current = selectedId
  const audit = can('audit.view')

  const refresh = useCallback(async () => {
    try {
      const ds = await api.devices()
      setDevices(ds)
      setLoadError(null)
      const id = selRef.current ?? ds[0]?.id
      const [d, ev, ck] = await Promise.all([
        id ? api.device(id) : null,
        audit ? api.events({ limit: 30 }) : [],
        audit ? api.verifyEvents().catch(() => null) : null,
      ])
      if (d && d.id === (selRef.current ?? ds[0]?.id)) setDetail(d) // discard stale responses
      setEvents(ev)
      setCheck(ck)
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) setLoadError(e.message)
    }
  }, [audit])
  usePolling(refresh, 2000, [audit])

  const select = (id: string) => {
    setParams({ device: id }, { replace: true })
    selRef.current = id
    setDetail(null)
    setError(null)
    refresh()
  }

  const run = async (name: string, fn: () => Promise<DeviceDetail>) => {
    setPending(name)
    setError(null)
    try { setDetail(await fn()) } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) setError(errorText(e))
      if (e instanceof ApiError && e.status === 403) refreshMe()
    }
    await refresh()
    setPending(null)
  }

  const n = devices?.length ?? 0
  const crit = devices?.filter((d) => d.risk === 'CRITICAL').length ?? 0
  const susp = devices?.filter((d) => d.risk !== 'LOW').length ?? 0

  return (
    <>
      <PageHeading>Fleet</PageHeading>
      {loadError && <StateMessage kind="error">{loadError}</StateMessage>}
      <Metrics items={[
        { label: 'Devices monitored', value: String(n) },
        { label: 'Critical alerts', value: String(crit), tone: crit ? 'critical' : undefined },
        { label: 'Suspicious devices', value: String(susp), tone: susp ? 'high' : undefined },
        { label: 'Fleet DNA match', value: n ? `${Math.round(devices!.reduce((s, d) => s + d.dna_score, 0) / n)}%` : '—' },
      ]} />

      <div className="grid items-start gap-6 min-[860px]:grid-cols-[320px_1fr]">
        <section aria-labelledby="fleet-heading" className="space-y-3">
          <h2 id="fleet-heading" className={`flex items-center gap-2 ${label}`}><Activity className="size-3.5" />Device fleet</h2>
          {!devices ? <StateMessage kind="loading">Loading fleet…</StateMessage> : devices.map((d) => (
            <SelectCard key={d.id} selected={d.id === selectedId} tone={riskTone(d.risk, d.status)} onClick={() => select(d.id)}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{d.name}</p>
                <p className="text-[13px] text-muted">{d.type} · {d.location}</p>
                <div className="mt-2"><RiskBadge risk={d.risk} status={d.status} /></div>
              </div>
              <span className="font-mono text-2xl font-medium" style={{ color: d.risk === 'LOW' && d.status !== 'ISOLATED' ? undefined : riskVar(d.risk, d.status) }}>{d.dna_score}<span className="text-sm">%</span></span>
            </SelectCard>
          ))}
        </section>

        <div>
          {detail ? (
            <DnaPanel key={detail.id} detail={detail} pending={pending} error={error}
              onSimulate={(p: Preset) => run('simulate', () => api.simulate(detail.id, p))}
              onReset={() => run('reset', () => api.reset(detail.id))}
              onAction={(a) => run(a, () => api.action(detail.id, a))} />
          ) : <StateMessage kind="loading">Loading device DNA…</StateMessage>}
          <p aria-live="polite" className="sr-only">{detail && `${detail.name} DNA match ${detail.dna_score} percent, ${sentence(detail.status)}.`}</p>
        </div>
      </div>

      <EventStream events={events} check={check} allowed={audit} />
    </>
  )
}
