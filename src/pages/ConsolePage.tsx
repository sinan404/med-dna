import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, errorText } from '../api/client'
import { ROLE_LABELS, type Alert, type ChainCheck, type Detection, type DnaEvent, type Role, type RoleInfo, type Summary, type User } from '../api/server/types'
import { roleLabel } from '../components/EventStream'
import { Badge, Button, ChainBadge, InlineError, Metrics, PageHeading, RoleNotice, SeverityBadge, StateMessage, card, hhmmss, selectCls, sentence } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import usePolling from '../hooks/usePolling'

const TABS = [
  { id: 'detections', label: 'Detections' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'audit', label: 'Audit log' },
  { id: 'users', label: 'Users and roles' },
] as const
type TabId = (typeof TABS)[number]['id']

const th = 'px-4 py-3 text-xs font-medium uppercase tracking-[0.06em] text-faint'
const td = 'px-4 py-3 align-top'
const Table = ({ head, children, min = 820 }: { head: string[]; children: React.ReactNode; min?: number }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm" style={{ minWidth: min }}>
      <thead className="border-b border-line"><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  </div>
)
const Filter = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) => (
  <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">{label}
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
)
const SEV_OPTS: [string, string][] = [['', 'All severities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]
const usePoll = <T,>(fn: () => Promise<T>, deps: unknown[]) => {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  usePolling(async () => {
    try { setData(await fn()); setError(null) } catch (e) { if (!(e instanceof ApiError && e.status === 401)) setError(errorText(e)) }
  }, 2000, deps)
  return { data, error, setData }
}

function Detections() {
  const [source, setSource] = useState(''), [severity, setSeverity] = useState(''), [active, setActive] = useState(false)
  const { data, error } = usePoll(() => api.detections({ source: source || undefined, severity: severity || undefined, active: active || undefined }), [source, severity, active])
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Filter label="Source" value={source} onChange={setSource} options={[['', 'All sources'], ['device_dna', 'Device DNA'], ['cold_chain', 'Cold chain']]} />
        <Filter label="Severity" value={severity} onChange={setSeverity} options={SEV_OPTS} />
        <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={active} onChange={(e) => setActive(e.target.checked)} />Active only</label>
      </div>
      {error ? <div className="p-4"><StateMessage kind="error">{error}</StateMessage></div> : !data ? <div className="p-4"><StateMessage kind="loading">Loading detections…</StateMessage></div> : data.length === 0 ? <div className="p-4"><StateMessage kind="empty">No detections. Devices and units are behaving as expected.</StateMessage></div> : (
        <Table head={['Time', 'Source', 'Type', 'Severity', 'Target', 'Detail', 'State']} min={960}>
          {data.map((d: Detection) => (
            <tr key={d.id} className={d.active ? '' : 'text-muted'}>
              <td className={`${td} font-mono text-[13px]`}>{hhmmss(d.timestamp)}</td>
              <td className={td}>{d.source === 'device_dna' ? 'Device DNA' : 'Cold chain'}</td>
              <td className={`${td} font-medium`}>{sentence(d.type)}</td>
              <td className={td}><SeverityBadge severity={d.severity} /></td>
              <td className={td}><Link className="font-medium text-primary underline-offset-2 hover:underline" to={d.target_type === 'device' ? `/fleet?device=${d.target_id}` : `/cold-chain?unit=${d.target_id}`}>{d.target_name}</Link></td>
              <td className={`${td} max-w-[320px] text-[13px]`}>{d.detail}</td>
              <td className={td}>{d.active ? <Badge tone="critical">Active</Badge> : <span className="text-[13px]">Cleared</span>}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

function Alerts() {
  const { can, refresh } = useAuth()
  const [status, setStatus] = useState(''), [severity, setSeverity] = useState('')
  const [rowErr, setRowErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const { data, error, setData } = usePoll(() => api.alerts({ status: status || undefined, severity: severity || undefined }), [status, severity])
  const act = async (a: Alert, s: 'acknowledged' | 'resolved') => {
    setBusy(a.id); setRowErr((r) => ({ ...r, [a.id]: '' }))
    try { const n = await api.alertStatus(a.id, s); setData((d) => d?.map((x) => (x.id === n.id ? n : x)) ?? d) }
    catch (e) { setRowErr((r) => ({ ...r, [a.id]: errorText(e) })); if (e instanceof ApiError && e.status === 403) refresh() }
    setBusy(null)
  }
  const allowed = can('alert.manage')
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Filter label="Status" value={status} onChange={setStatus} options={[['', 'All statuses'], ['OPEN', 'Open'], ['ACKNOWLEDGED', 'Acknowledged'], ['RESOLVED', 'Resolved']]} />
        <Filter label="Severity" value={severity} onChange={setSeverity} options={SEV_OPTS} />
        {!allowed && <RoleNotice>Handling alerts requires the Security Operator or Admin role.</RoleNotice>}
      </div>
      {error ? <div className="p-4"><StateMessage kind="error">{error}</StateMessage></div> : !data ? <div className="p-4"><StateMessage kind="loading">Loading alerts…</StateMessage></div> : data.length === 0 ? <div className="p-4"><StateMessage kind="empty">No alerts.</StateMessage></div> : (
        <Table head={['Time', 'Severity', 'Title', 'Status', 'Handled by', 'Actions']} min={900}>
          {data.map((a) => (
            <tr key={a.id}>
              <td className={`${td} font-mono text-[13px]`}>{hhmmss(a.created_at)}</td>
              <td className={td}><SeverityBadge severity={a.severity} /></td>
              <td className={`${td} font-medium`}>{a.title}</td>
              <td className={td}><Badge tone={a.status === 'OPEN' ? 'critical' : a.status === 'ACKNOWLEDGED' ? 'medium' : 'neutral'}>{sentence(a.status)}</Badge></td>
              <td className={`${td} text-[13px] text-muted`}>
                {a.acknowledged_by && <div>Ack: {a.acknowledged_by} · <span className="font-mono">{hhmmss(a.acknowledged_at)}</span></div>}
                {a.resolved_by && <div>Resolved: {a.resolved_by} · <span className="font-mono">{hhmmss(a.resolved_at)}</span></div>}
                {!a.acknowledged_by && !a.resolved_by && '—'}
              </td>
              <td className={td}>
                <div className="flex flex-wrap gap-2">
                  {a.status === 'OPEN' && <Button disabled={!allowed || busy === a.id} onClick={() => act(a, 'acknowledged')}>Acknowledge</Button>}
                  {a.status !== 'RESOLVED' && <Button variant="ghost" disabled={!allowed || busy === a.id} onClick={() => act(a, 'resolved')}>Resolve</Button>}
                </div>
                {rowErr[a.id] && <div className="mt-2 max-w-[260px]"><InlineError>{rowErr[a.id]}</InlineError></div>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

function Audit() {
  const { can } = useAuth()
  const [actor, setActor] = useState(''), [type, setType] = useState(''), [target, setTarget] = useState('')
  const allowed = can('audit.view')
  const { data, error } = usePoll(async () => {
    if (!allowed) return null
    const [ev, chk] = await Promise.all([api.events({ actor: actor || undefined, type: type || undefined, target_id: target || undefined, limit: 50 }), api.verifyEvents()])
    return { ev, chk }
  }, [actor, type, target, allowed])
  if (!allowed) return <div className="p-4"><RoleNotice>Your role can't view the audit log.</RoleNotice></div>
  const chk: ChainCheck | undefined = data?.chk
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">Actor<input className={`${selectCls} w-40`} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="username" /></label>
          <Filter label="Type" value={type} onChange={setType} options={[['', 'All types'], ...['risk_changed', 'simulation', 'reset', 'isolate', 'restore', 'acknowledge', 'coldchain_attack', 'coldchain_reset', 'batch_quarantine', 'batch_release', 'alert_status', 'role_changed', 'login', 'login_failed', 'access_denied'].map((t) => [t, sentence(t)] as [string, string])]} />
          <label className="flex flex-col gap-1 text-[13px] font-medium text-muted">Target<input className={`${selectCls} w-40`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="ID" /></label>
        </div>
        {chk && <ChainBadge ok={chk.valid}>{chk.valid ? 'Audit chain verified' : `Audit chain broken at event ${chk.broken_at}`}</ChainBadge>}
      </div>
      {error ? <div className="p-4"><StateMessage kind="error">{error}</StateMessage></div> : !data ? <div className="p-4"><StateMessage kind="loading">Loading audit log…</StateMessage></div> : data.ev.length === 0 ? <div className="p-4"><StateMessage kind="empty">No audit events yet.</StateMessage></div> : (
        <Table head={['Time', 'Actor', 'Action', 'Target', 'Detail', 'Hash']} min={960}>
          {data.ev.map((e: DnaEvent, i) => {
            const flag = e.type === 'access_denied' ? 'Denied' : e.type === 'login_failed' ? 'Failed' : null
            return (
              <tr key={`${e.hash}-${i}`}>
                <td className={`${td} font-mono text-[13px]`}>{hhmmss(e.timestamp)}</td>
                <td className={td}><div className="font-medium">{e.actor}</div><div className="text-[13px] text-muted">{roleLabel(e.actor_role)}</div></td>
                <td className={td}>{sentence(e.type)}{flag && <span className="ml-2"><Badge tone="critical">{flag}</Badge></span>}</td>
                <td className={td}>{e.target_name || e.target_id}</td>
                <td className={`${td} max-w-[320px] text-[13px] text-muted`}>{e.detail}</td>
                <td className={`${td} font-mono text-[13px] text-primary`} title={e.hash}>{e.hash.slice(0, 12)}</td>
              </tr>
            )
          })}
        </Table>
      )}
    </>
  )
}

function Users() {
  const { user, can, refresh } = useAuth()
  const canView = can('user.view'), canManage = can('user.manage')
  const users = usePoll(() => (canView ? api.users() : Promise.resolve(null as User[] | null)), [canView])
  const roles = usePoll(() => api.roles(), [])
  const [draft, setDraft] = useState<Record<string, Role>>({})
  const [confirm, setConfirm] = useState<string | null>(null)
  const [rowErr, setRowErr] = useState<Record<string, string>>({})
  const save = async (u: User) => {
    setRowErr((r) => ({ ...r, [u.id]: '' }))
    try { await api.setRole(u.id, draft[u.id]); setDraft(({ [u.id]: _, ...r }) => r); refresh() }
    catch (e) { setRowErr((r) => ({ ...r, [u.id]: errorText(e) })) }
    setConfirm(null)
  }
  const roleList: RoleInfo[] = roles.data ?? []
  const perms = [...new Set(roleList.flatMap((r) => r.permissions))].sort()
  return (
    <div className="space-y-6 p-4">
      <section aria-labelledby="users-h">
        <h3 id="users-h" className="mb-2 font-bold">Users</h3>
        {!canView ? <RoleNotice>Your role can't view the user list.</RoleNotice> : !users.data ? <StateMessage kind="loading">Loading users…</StateMessage> : (
          <>
            {!canManage && <div className="mb-2"><RoleNotice>Your role is read-only.</RoleNotice></div>}
            <Table head={['Name', 'Username', 'Role', 'Last sign-in', '']} min={720}>
              {users.data.map((u) => {
                const d = draft[u.id] ?? u.role
                return (
                  <tr key={u.id}>
                    <td className={`${td} font-medium`}>{u.display_name}{u.id === user?.id && <span className="ml-2 text-[13px] text-muted">(you)</span>}</td>
                    <td className={`${td} font-mono text-[13px]`}>{u.username}</td>
                    <td className={td}>
                      <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.display_name}</label>
                      <select id={`role-${u.id}`} className={selectCls} disabled={!canManage} value={d} onChange={(e) => { setDraft((r) => ({ ...r, [u.id]: e.target.value as Role })); setConfirm(null) }}>
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td className={`${td} font-mono text-[13px] text-muted`}>{hhmmss(u.last_login)}</td>
                    <td className={td}>
                      {canManage && d !== u.role && (confirm === u.id ? (
                        <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => save(u)}>Confirm role change</Button><Button onClick={() => setConfirm(null)}>Cancel</Button></div>
                      ) : <Button onClick={() => setConfirm(u.id)}>Change role</Button>)}
                      {rowErr[u.id] && <div className="mt-2 max-w-[280px]"><InlineError>{rowErr[u.id]}</InlineError></div>}
                    </td>
                  </tr>
                )
              })}
            </Table>
          </>
        )}
      </section>
      <section aria-labelledby="perm-h">
        <h3 id="perm-h" className="mb-2 font-bold">Permissions by role</h3>
        {!roles.data ? <StateMessage kind="loading">Loading roles…</StateMessage> : (
          <Table head={['Permission', ...roleList.map((r) => r.label + (r.role === user?.role ? ' · Your role' : ''))]} min={640}>
            {perms.map((p) => (
              <tr key={p}>
                <td className={`${td} font-mono text-[13px]`}>{p}</td>
                {roleList.map((r) => {
                  const yes = r.permissions.includes(p)
                  return <td key={r.role} className={`${td} ${r.role === user?.role ? 'bg-primary/5' : ''} ${yes ? 'font-medium' : 'text-faint'}`}>{yes ? 'Yes' : 'No'}</td>
                })}
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  )
}

export default function ConsolePage() {
  const { tab } = useParams()
  const nav = useNavigate()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [announce, setAnnounce] = useState('')
  const seen = useRef<Set<string> | null>(null)
  const poll = useCallback(async () => {
    try {
      const [s, open] = await Promise.all([api.summary(), api.alerts({ status: 'OPEN' })])
      setSummary(s)
      const urgent = open.filter((a) => a.severity === 'high' || a.severity === 'critical')
      if (seen.current) {
        const fresh = urgent.filter((a) => !seen.current!.has(a.id))
        if (fresh.length) setAnnounce(`New ${fresh[0].severity} alert: ${fresh[0].title}`)
      }
      seen.current = new Set(urgent.map((a) => a.id))
    } catch { /* banner handles outages */ }
  }, [])
  usePolling(poll, 2000)

  const idx = TABS.findIndex((t) => t.id === tab)
  if (idx < 0) return <Navigate to="/console/detections" replace />
  const go = (i: number) => { nav(`/console/${TABS[i].id}`); refs.current[i]?.focus() }
  const onKey = (e: KeyboardEvent) => {
    const n = TABS.length
    const m: Record<string, number> = { ArrowRight: (idx + 1) % n, ArrowLeft: (idx - 1 + n) % n, Home: 0, End: n - 1 }
    if (e.key in m) { e.preventDefault(); go(m[e.key]) }
  }
  const chainOk = !!summary && summary.chain_valid && summary.ledgers_valid
  const current: TabId = TABS[idx].id

  return (
    <>
      <PageHeading>Security Console</PageHeading>
      <Metrics items={[
        { label: 'Open detections', value: String(summary?.open_detections ?? '—'), tone: summary?.open_detections ? 'high' : undefined },
        { label: 'Open alerts', value: String(summary?.open_alerts ?? '—'), tone: summary?.critical_alerts ? 'critical' : undefined, hint: summary ? `${summary.critical_alerts} critical` : undefined },
        { label: 'Units at integrity risk', value: String(summary?.integrity_risk_units ?? '—'), tone: summary?.integrity_risk_units ? 'critical' : undefined },
        { label: 'Batches quarantined', value: String(summary?.quarantined_batches ?? '—'), tone: summary?.quarantined_batches ? 'isolated' : undefined },
        { label: 'Audit chain', value: summary ? (chainOk ? 'Verified' : 'Broken') : '—', tone: summary ? (chainOk ? 'low' : 'critical') : undefined },
      ]} />
      <p aria-live="assertive" className="sr-only">{announce}</p>
      <section className={card}>
        <div role="tablist" aria-label="Security console" className="flex overflow-x-auto border-b border-line px-2" onKeyDown={onKey}>
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[i] = el }} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={i === idx} tabIndex={i === idx ? 0 : -1}
              onClick={() => go(i)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${i === idx ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} tabIndex={0}>
          {current === 'detections' && <Detections />}
          {current === 'alerts' && <Alerts />}
          {current === 'audit' && <Audit />}
          {current === 'users' && <Users />}
        </div>
      </section>
    </>
  )
}
