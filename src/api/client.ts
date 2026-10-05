import { handle, HttpError } from './server'
import type {
  Alert, ChainCheck, DeviceDetail, DeviceSummary, Detection, DnaEvent, LedgerCheck, LedgerEntry, LoginResult, Me, Preset, Attack, RoleInfo, Summary, UnitDetail, UnitSummary, User, Role,
} from './server/types'

// Uses VITE_API_BASE when configured; otherwise requests go to the in-browser simulator.
const BASE = import.meta.env.VITE_API_BASE as string | undefined
const SESSION_KEY = 'medna.session'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/* connection + outage simulation, shared via a tiny external store */
let connected = true
let offline = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const setConnected = (v: boolean) => { if (v !== connected) { connected = v; emit() } }
export const connection = {
  subscribe: (l: () => void) => (listeners.add(l), () => { listeners.delete(l) }),
  get: () => connected,
  isOffline: () => offline,
  setOffline: (v: boolean) => { offline = v; emit() },
}

let token: string | null = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')?.token ?? null } catch { return null } })()
let onUnauthorized: () => void = () => {}
export const session = {
  set: (s: LoginResult | null) => {
    token = s?.token ?? null
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(SESSION_KEY)
  },
  stored: (): LoginResult | null => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') } catch { return null } },
  onUnauthorized: (fn: () => void) => { onUnauthorized = fn },
}

const latency = () => new Promise((r) => setTimeout(r, 80 + Math.random() * 140))

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let status = 200
  let data: unknown
  try {
    if (BASE) {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      status = res.status
      data = await res.json().catch(() => ({}))
    } else {
      await latency()
      if (offline) throw new TypeError('Network unreachable')
      try { data = structuredClone(handle(method, path, body as Record<string, unknown>, token)) }
      catch (e) { if (!(e instanceof HttpError)) throw e; status = e.status; data = { detail: e.message } }
    }
  } catch (e) {
    setConnected(false)
    throw e
  }
  setConnected(true)
  if (status >= 400) {
    const detail = (data as { detail?: string })?.detail ?? `Request failed (${status}).`
    if (status === 401 && path !== '/auth/login') onUnauthorized()
    throw new ApiError(status, detail)
  }
  return data as T
}

const qs = (o: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString()
  return s ? `?${s}` : ''
}

export const api = {
  health: () => call('GET', '/health'),
  login: (username: string, password: string) => call<LoginResult>('POST', '/auth/login', { username, password }),
  me: () => call<Me>('GET', '/auth/me'),
  devices: () => call<DeviceSummary[]>('GET', '/devices'),
  device: (id: string) => call<DeviceDetail>('GET', `/devices/${id}`),
  events: (f: { target_id?: string; actor?: string; type?: string; source?: string; limit?: number } = {}) => call<DnaEvent[]>('GET', `/events${qs(f)}`),
  verifyEvents: () => call<ChainCheck>('GET', '/events/verify'),
  simulate: (id: string, preset: Preset) => call<DeviceDetail>('POST', `/simulate/${id}`, { preset }),
  reset: (id: string) => call<DeviceDetail>('POST', `/reset/${id}`),
  action: (device_id: string, action: 'isolate' | 'restore' | 'acknowledge') => call<DeviceDetail>('POST', '/actions', { device_id, action }),
  units: () => call<UnitSummary[]>('GET', '/coldchain/units'),
  unit: (id: string) => call<UnitDetail>('GET', `/coldchain/units/${id}`),
  ledger: (unit_id: string, limit = 30) => call<LedgerEntry[]>('GET', `/coldchain/ledger${qs({ unit_id, limit })}`),
  verifyLedger: (unit_id: string) => call<LedgerCheck>('GET', `/coldchain/ledger/verify${qs({ unit_id })}`),
  attack: (id: string, attack: Attack) => call<UnitDetail>('POST', `/coldchain/simulate/${id}`, { attack }),
  resetUnit: (id: string) => call<UnitDetail>('POST', `/coldchain/reset/${id}`),
  batchAction: (batch_id: string, action: 'quarantine' | 'release', note?: string) => call<UnitDetail>('POST', '/coldchain/actions', { batch_id, action, note: note || undefined }),
  summary: () => call<Summary>('GET', '/console/summary'),
  detections: (f: { source?: string; severity?: string; active?: boolean }) => call<Detection[]>('GET', `/console/detections${qs(f)}`),
  alerts: (f: { status?: string; severity?: string }) => call<Alert[]>('GET', `/console/alerts${qs(f)}`),
  alertStatus: (id: string, status: 'acknowledged' | 'resolved') => call<Alert>('POST', `/console/alerts/${id}/status`, { status }),
  users: () => call<User[]>('GET', '/users'),
  roles: () => call<RoleInfo[]>('GET', '/roles'),
  setRole: (id: string, role: Role) => call<User>('POST', `/users/${id}/role`, { role }),
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : "Can't reach the MED-DNA service. Check that the backend is running at the configured address. Retrying automatically."
