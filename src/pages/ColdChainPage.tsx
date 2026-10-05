import { useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Thermometer } from 'lucide-react'
import { ApiError, api, errorText } from '../api/client'
import type { Attack, LedgerCheck, LedgerEntry, UnitDetail, UnitSummary } from '../api/server/types'
import LedgerTable from '../components/coldchain/LedgerTable'
import UnitPanel from '../components/coldchain/UnitPanel'
import { Badge, Metrics, PageHeading, SelectCard, StateMessage, label, sentence, unitTone } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import usePolling from '../hooks/usePolling'

export default function ColdChainPage() {
  const { refresh: refreshMe } = useAuth()
  const [params, setParams] = useSearchParams()
  const [units, setUnits] = useState<UnitSummary[] | null>(null)
  const [detail, setDetail] = useState<UnitDetail | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [ledgerCheck, setLedgerCheck] = useState<LedgerCheck | null>(null)
  const [quarantined, setQuarantined] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const lastStatus = useRef<Record<string, string>>({})
  const selectedId = params.get('unit') ?? units?.[0]?.id ?? null
  const selRef = useRef(selectedId)
  selRef.current = selectedId

  const refresh = useCallback(async () => {
    try {
      const [us, sum] = await Promise.all([api.units(), api.summary()])
      setUnits(us)
      setQuarantined(sum.quarantined_batches)
      setLoadError(null)
      const id = selRef.current ?? us[0]?.id
      if (!id) return
      const [d, l, v] = await Promise.all([api.unit(id), api.ledger(id, 30), api.verifyLedger(id)])
      if (id !== (selRef.current ?? us[0]?.id)) return // stale
      setDetail(d); setLedger(l); setLedgerCheck(v)
      const prev = lastStatus.current[id]
      if (prev && prev !== d.status) {
        const failed = d.checks.filter((c) => c.state === 'fail').map((c) => c.label.toLowerCase())
        setAnnounce(`${d.name} ${sentence(d.status).toLowerCase()}${failed.length ? `: ${failed.join(', ')} check failed` : ''}`)
      }
      lastStatus.current[id] = d.status
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) setLoadError(e.message)
    }
  }, [])
  usePolling(refresh, 2000)

  const select = (id: string) => {
    setParams({ unit: id }, { replace: true })
    selRef.current = id
    setDetail(null); setLedger([]); setLedgerCheck(null); setError(null); setConfirmMsg(null)
    refresh()
  }

  const run = async (name: string, fn: () => Promise<UnitDetail>, success?: string) => {
    setPending(name); setError(null); setConfirmMsg(null)
    try {
      setDetail(await fn())
      if (success) { setConfirmMsg(success); setAnnounce(success) }
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) setError(errorText(e))
      if (e instanceof ApiError && e.status === 403) refreshMe()
    }
    await refresh()
    setPending(null)
  }

  return (
    <>
      <PageHeading>Cold Chain</PageHeading>
      {loadError && <StateMessage kind="error">{loadError}</StateMessage>}
      <Metrics items={[
        { label: 'Units monitored', value: String(units?.length ?? 0) },
        { label: 'Integrity risks', value: String(units?.filter((u) => u.status === 'INTEGRITY_RISK').length ?? 0), tone: units?.some((u) => u.status === 'INTEGRITY_RISK') ? 'critical' : undefined },
        { label: 'Excursions', value: String(units?.filter((u) => u.status === 'EXCURSION').length ?? 0), tone: units?.some((u) => u.status === 'EXCURSION') ? 'high' : undefined },
        { label: 'Batches quarantined', value: String(quarantined), tone: quarantined ? 'isolated' : undefined },
      ]} />

      <div className="grid items-start gap-6 min-[860px]:grid-cols-[320px_1fr]">
        <section aria-labelledby="units-heading" className="space-y-3">
          <h2 id="units-heading" className={`flex items-center gap-2 ${label}`}><Thermometer className="size-3.5" />Storage units</h2>
          {!units ? <StateMessage kind="loading">Loading units…</StateMessage> : units.map((u) => (
            <SelectCard key={u.id} selected={u.id === selectedId} tone={unitTone(u.status)} onClick={() => select(u.id)}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{u.name}</p>
                <p className="text-[13px] text-muted">{u.location}</p>
                <p className="mt-1 font-mono text-[13px]">{u.last_temperature.toFixed(1)} °C, safe {u.safe_min} to {u.safe_max}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={unitTone(u.status)}>{sentence(u.status)}</Badge>
                  {u.batches_at_risk > 0 && <span className="text-[13px] text-muted">{u.batches_at_risk} batch{u.batches_at_risk > 1 ? 'es' : ''} at risk</span>}
                </div>
              </div>
            </SelectCard>
          ))}
        </section>

        <div>
          {detail ? (
            <UnitPanel key={detail.id} unit={detail} pending={pending} error={error} confirmMsg={confirmMsg}
              onAttack={(a: Attack) => run('attack', () => api.attack(detail.id, a))}
              onReset={() => run('reset', () => api.resetUnit(detail.id))}
              onBatch={(id, action, note) => run(action, () => api.batchAction(id, action, note),
                action === 'quarantine' ? 'Batch held for pharmacist review. No stock is discarded automatically.' : 'Batch released.')} />
          ) : <StateMessage kind="loading">Loading unit…</StateMessage>}
          <p aria-live="polite" className="sr-only">{announce}</p>
        </div>
      </div>

      <LedgerTable entries={ledger} check={ledgerCheck} />
    </>
  )
}
