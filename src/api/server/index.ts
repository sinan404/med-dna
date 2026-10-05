// In-browser stand-in for the MED-DNA FastAPI service (Backend Specification v1.1).
// Owns scoring, signed readings, ledgers, detections, alerts, sessions, roles and the audit chain.
import { hmac, randomKey, sha256 } from './crypto'
import type {
  Alert, AlertStatus, Attack, AttrKey, Batch, Check, DeviceDetail, Detection, DnaEvent, LedgerEntry, Preset, Risk, Role, Severity, Status, UnitDetail, UnitStatus, User,
} from './types'
import { ATTACK_LABELS, PRESET_LABELS, ROLE_LABELS } from './types'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

let clockOffset = 0 // ms in the past, used only while seeding demo history
const now = () => new Date(Date.now() - clockOffset).toISOString().replace(/\.\d+Z$/, 'Z')
const TICK_MS = 2000

/* ---------- Config ---------- */
const SPEC: Record<AttrKey, { label: string; unit: string; weight: number; tolerance: number }> = {
  dest: { label: 'Unknown destinations', unit: '', weight: 0.3, tolerance: 5 },
  cmd: { label: 'Unusual commands', unit: '', weight: 0.25, tolerance: 8 },
  pkt: { label: 'Packets per minute', unit: '/min', weight: 0.2, tolerance: 57 },
  resp: { label: 'Response time', unit: ' ms', weight: 0.15, tolerance: 90 },
  dur: { label: 'Connection duration', unit: ' s', weight: 0.1, tolerance: 24 },
}
const ORDER: AttrKey[] = ['dest', 'cmd', 'pkt', 'resp', 'dur']
const JITTER = 0.12
const PRESETS: Record<Preset, { pkt: number; resp: number; dest: number; cmd: number; dur: number }> = {
  combined: { pkt: 2.9, resp: 1.67, dest: 3, cmd: 4, dur: 1.25 },
  exfiltration: { pkt: 3.5, resp: 1.2, dest: 5, cmd: 0, dur: 1.5 },
  injection: { pkt: 1.4, resp: 2.0, dest: 1, cmd: 7, dur: 1.0 },
  firmware: { pkt: 1.2, resp: 1.8, dest: 0, cmd: 2, dur: 1.6 },
}

const PERMS: Record<Role, string[]> = {
  security_operator: ['view', 'audit.view', 'alert.acknowledge', 'alert.resolve', 'device.isolate', 'device.restore', 'device.simulate', 'device.reset', 'coldchain.simulate', 'coldchain.reset'],
  pharmacist: ['view', 'audit.view', 'alert.acknowledge', 'alert.resolve', 'batch.quarantine', 'batch.release'],
  admin: ['view', 'audit.view', 'alert.acknowledge', 'alert.resolve', 'device.isolate', 'device.restore', 'device.simulate', 'device.reset', 'coldchain.simulate', 'coldchain.reset', 'user.view', 'user.manage'],
  auditor: ['view', 'audit.view', 'user.view'],
}
export const ALL_PERMISSIONS = ['view', 'audit.view', 'alert.acknowledge', 'alert.resolve', 'device.isolate', 'device.restore', 'device.simulate', 'device.reset', 'coldchain.simulate', 'coldchain.reset', 'batch.quarantine', 'batch.release', 'user.view', 'user.manage']
export const DEMO_PASSWORD = 'med-dna-demo'

/* ---------- Events (audit log, one hash chain) ---------- */
interface Actor { username: string; role: string }
const SYSTEM: Actor = { username: 'system', role: 'system' }
const events: DnaEvent[] = []

const eventHash = (e: Omit<DnaEvent, 'hash'>) =>
  sha256(`${e.prev_hash}|${e.timestamp}|${e.target_id}|${e.type}|${e.dna_score ?? ''}|${e.actor}`)

function log(actor: Actor, source: string, target_type: string, target_id: string, target_name: string, type: string, detail: string, dna_score: number | null = null) {
  const e = { timestamp: now(), actor: actor.username, actor_role: actor.role, source, target_type, target_id, target_name, device_id: target_id, device_name: target_name, type, detail, dna_score, prev_hash: events[0]?.hash ?? 'GENESIS' }
  events.unshift({ ...e, hash: eventHash(e) })
}

function verifyChain() {
  let prev = 'GENESIS'
  for (let i = events.length - 1, pos = 1; i >= 0; i--, pos++) {
    const { hash, ...rest } = events[i]
    if (rest.prev_hash !== prev || eventHash(rest) !== hash) return { valid: false, checked: pos, broken_at: pos }
    prev = hash
  }
  return { valid: true, checked: events.length, broken_at: null }
}

/* ---------- Users and sessions ---------- */
interface UserRec extends User { salt: string; password_hash: string; failed: number; locked_until: number }
const hashPw = (salt: string, pw: string) => sha256(`${salt}|${pw}`)
const mkUser = (id: string, username: string, display_name: string, role: Role): UserRec => {
  const salt = sha256(String(Math.random())).slice(0, 32)
  return { id, username, display_name, role, last_login: null, salt, password_hash: hashPw(salt, DEMO_PASSWORD), failed: 0, locked_until: 0 }
}
const users: UserRec[] = [
  mkUser('u-op', 'demo.operator', 'Demo Operator', 'security_operator'),
  mkUser('u-ph', 'demo.pharmacist', 'Demo Pharmacist', 'pharmacist'),
  mkUser('u-ad', 'demo.admin', 'Demo Admin', 'admin'),
  mkUser('u-au', 'demo.auditor', 'Demo Auditor', 'auditor'),
]
export const DEMO_ACCOUNTS = users.map(({ username, display_name, role }) => ({ username, display_name, role }))
const SESSION_TTL = 8 * 3600
// Persisted per tab so a page refresh can keep the session even though the simulator restarts.
const SESSION_SECRET = (() => {
  const k = 'medna.sim.secret'
  let s = sessionStorage.getItem(k)
  if (!s) { s = [...randomKey()].map((b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem(k, s) }
  return new TextEncoder().encode(s)
})()
const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))
const publicUser = ({ id, username, display_name, role, last_login }: UserRec): User => ({ id, username, display_name, role, last_login })

function currentUser(token: string | null): UserRec {
  const expired = new HttpError(401, 'Your session has expired. Sign in again.')
  if (!token) throw expired
  const [payload, sig] = token.split('.')
  if (!payload || hmac(SESSION_SECRET, payload) !== unb64(sig ?? '').split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')) throw expired
  const { sub, exp } = JSON.parse(unb64(payload))
  const u = users.find((x) => x.id === sub)
  if (!u || exp < Date.now() / 1000) throw expired
  return u
}

const DENIED_TEXT: Record<string, string> = {
  'device.simulate': 'simulate a device mutation', 'device.reset': 'reset device DNA', 'device.isolate': 'approve device isolation', 'device.restore': 'restore a device',
  'alert.acknowledge': 'acknowledge alerts', 'alert.resolve': 'resolve alerts', 'coldchain.simulate': 'simulate a cold-chain attack', 'coldchain.reset': 'reset a storage unit',
  'batch.quarantine': 'approve quarantine', 'batch.release': 'release a batch', 'user.view': 'view users', 'user.manage': 'change roles', 'audit.view': 'view the audit log',
}
const DENIED_HINT: Record<string, string> = { 'batch.quarantine': ' Ask a pharmacist.', 'batch.release': ' Ask a pharmacist.', 'user.manage': ' Ask an admin.' }
function requirePerm(u: UserRec, perm: string, target: [string, string, string] = ['session', u.id, u.username]) {
  if (PERMS[u.role].includes(perm)) return
  const action = DENIED_TEXT[perm] ?? perm
  log({ username: u.username, role: u.role }, 'auth', target[0], target[1], target[2], 'access_denied', `Role ${u.role} cannot ${action}`)
  throw new HttpError(403, `Your role can't ${action}.${DENIED_HINT[perm] ?? ''}`)
}
const actorOf = (u: UserRec): Actor => ({ username: u.username, role: u.role })

/* ---------- Detections and alerts ---------- */
const detections: Detection[] = []
const alerts: Alert[] = []
let detSeq = 0

function openDetection(d: Omit<Detection, 'id' | 'timestamp' | 'active' | 'alert_id'>, title: string) {
  const n = String(++detSeq).padStart(4, '0')
  const det: Detection = { ...d, id: `DET-${n}`, timestamp: now(), active: true, alert_id: `ALR-${n}` }
  detections.unshift(det)
  alerts.unshift({ id: det.alert_id, detection_id: det.id, created_at: det.timestamp, severity: det.severity, title, status: 'OPEN', acknowledged_by: null, acknowledged_at: null, resolved_by: null, resolved_at: null })
  return det
}
const activeDetection = (target_id: string, type: string) => detections.find((d) => d.active && d.target_id === target_id && d.type === type)
const alertFor = (det?: Detection) => alerts.find((a) => a.id === det?.alert_id)

/* ---------- Devices ---------- */
interface DeviceRec { id: string; name: string; type: string; location: string; baseline: Record<AttrKey, number>; observed: Record<AttrKey, number>; mutation: Preset | null; isolated: boolean; acknowledged: boolean; lastRisk: Risk }
const mkDevice = (id: string, name: string, type: string, location: string, pkt: number, resp: number, dur: number): DeviceRec => {
  const baseline = { dest: 0, cmd: 0, pkt, resp, dur }
  return { id, name, type, location, baseline, observed: { ...baseline }, mutation: null, isolated: false, acknowledged: false, lastRisk: 'LOW' }
}
const devices: DeviceRec[] = [
  mkDevice('infusion-pump-17', 'Infusion Pump 17', 'Infusion Pump', 'ICU-2', 30, 45, 12),
  mkDevice('patient-monitor-04', 'Patient Monitor 04', 'Patient Monitor', 'ICU-2', 60, 30, 20),
  mkDevice('ventilator-09', 'Ventilator 09', 'Ventilator', 'ICU-1', 45, 25, 30),
  mkDevice('imaging-02', 'Imaging System 02', 'Imaging System', 'Radiology', 120, 80, 8),
]
const riskOf = (s: number): Risk => (s >= 85 ? 'LOW' : s >= 70 ? 'MEDIUM' : s >= 50 ? 'HIGH' : 'CRITICAL')
const STATUS_OF: Record<Risk, Status> = { LOW: 'TRUSTED', MEDIUM: 'WATCH', HIGH: 'SUSPICIOUS', CRITICAL: 'CRITICAL' }

function telemetry(d: DeviceRec) {
  const p = d.mutation ? PRESETS[d.mutation] : null
  const j = () => 1 + (Math.random() * 2 - 1) * JITTER / 2
  const b = d.baseline
  d.observed = {
    dest: p && !d.isolated ? p.dest : 0,
    cmd: p && !d.isolated ? p.cmd : 0,
    pkt: Math.round(b.pkt * (p?.pkt ?? 1) * j()),
    resp: Math.round(b.resp * (p?.resp ?? 1) * j()),
    dur: Math.round(b.dur * (p?.dur ?? 1) * j()),
  }
}

function evaluate(d: DeviceRec): DeviceDetail {
  let score = 0
  const attributes = ORDER.map((key) => {
    const s = SPEC[key]
    const similarity = Math.max(0, 1 - Math.abs(d.observed[key] - d.baseline[key]) / s.tolerance)
    score += s.weight * similarity
    return { key, label: s.label, unit: s.unit, baseline: d.baseline[key], observed: d.observed[key], tolerance: s.tolerance, similarity: Math.round(similarity * 1000) / 1000 }
  })
  const dna_score = Math.round(score * 100)
  const risk = riskOf(dna_score)
  const deviations = attributes
    .filter((a) => a.similarity < 0.8)
    .map((a) => ({ key: a.key, label: a.label, unit: a.unit, baseline: a.baseline, observed: a.observed, point_impact: Math.round(SPEC[a.key].weight * (1 - a.similarity) * 1000) / 10 }))
    .sort((a, b) => b.point_impact - a.point_impact)
  return { id: d.id, name: d.name, type: d.type, location: d.location, risk, status: d.isolated ? 'ISOLATED' : STATUS_OF[risk], dna_score, acknowledged: d.acknowledged, isolated: d.isolated, attributes, deviations }
}
const sevOfRisk = (r: Risk): Severity => (r === 'CRITICAL' ? 'critical' : r === 'HIGH' ? 'high' : 'medium')
const findDevice = (id: string) => devices.find((d) => d.id === id) ?? (() => { throw new HttpError(404, `No device with ID ${id}. Pick a device from the fleet list.`) })()

function syncDnaDetection(d: DeviceRec, risk: Risk) {
  const det = activeDetection(d.id, 'dna_deviation')
  if (!det) return
  det.severity = sevOfRisk(risk)
  const a = alertFor(det)
  if (a) a.severity = det.severity
}

/* ---------- Cold chain ---------- */
const NOISE = 0.1, OFFSET_LIMIT = 0.6, MAX_STEP = 0.5, SKEW = 10, WINDOW = 15, EXC_CONSEC = 2, EXC_HIGH = 2.0
const LEDGER_MAX = 1000, STARTUP_HISTORY = 20, REPLAY_LOOKBACK = 10, SWING = 9, DRIFT = 0.3, CAP = 4
const INTEGRITY_FLAGS = ['signature_invalid', 'replay_suspected', 'implausible_reading']
const attackerKey = randomKey()

interface UnitRec {
  id: string; name: string; location: string; safe_min: number; safe_max: number; nominal: number; sensor_id: string; key: Uint8Array
  attack: Exclude<Attack, 'log_edit'> | null; offset: number; next_seq: number; last_valid_seq: number; last_valid_ts: string; last_valid_temp: number
  ledger: LedgerEntry[]; anchor: string; status: UnitStatus
}
interface BatchRec { id: string; product: string; unit_id: string; quantity: number; quantity_unit: string; quarantined: boolean; quarantined_by: string | null; quarantined_at: string | null; note: string | null }

const mkUnit = (id: string, name: string, location: string, safe_min: number, safe_max: number, nominal: number): UnitRec => ({
  id, name, location, safe_min, safe_max, nominal, sensor_id: `${id}-sensor`, key: randomKey(), attack: null, offset: 0, next_seq: 1,
  last_valid_seq: 0, last_valid_ts: now(), last_valid_temp: nominal, ledger: [], anchor: 'GENESIS', status: 'NORMAL',
})
const units: UnitRec[] = [
  mkUnit('vaccine-fridge-01', 'Vaccine Fridge 01', 'Pharmacy', 2, 8, 5),
  mkUnit('insulin-cabinet-03', 'Insulin Cabinet 03', 'Ward 4', 2, 8, 4.5),
  mkUnit('blood-bank-02', 'Blood Bank Fridge 02', 'Laboratory', 1, 6, 4),
]
const batches: BatchRec[] = [
  ['VAC-2026-0412', 'Influenza vaccine', 'vaccine-fridge-01', 120, 'doses'],
  ['VAC-2026-0418', 'Hepatitis B vaccine', 'vaccine-fridge-01', 80, 'doses'],
  ['INS-2026-0207', 'Insulin glargine', 'insulin-cabinet-03', 200, 'pens'],
  ['BLD-2026-0931', 'Packed red cells', 'blood-bank-02', 12, 'units'],
  ['BLD-2026-0934', 'Plasma', 'blood-bank-02', 8, 'units'],
].map(([id, product, unit_id, quantity, quantity_unit]) => ({ id, product, unit_id, quantity, quantity_unit, quarantined: false, quarantined_by: null, quarantined_at: null, note: null }) as BatchRec)

const canonical = (sensor: string, seq: number, ts: string, t: number) => `${sensor}|${seq}|${ts}|${t.toFixed(2)}`
const ledgerHash = (u: UnitRec, e: Omit<LedgerEntry, 'hash'>) =>
  sha256(`${e.prev_hash}|${u.id}|${e.seq}|${e.timestamp}|${e.temperature_c.toFixed(2)}|${e.signature}|${e.check_result}`)

function verifyLedger(u: UnitRec) {
  let prev = u.anchor
  for (let i = u.ledger.length - 1; i >= 0; i--) {
    const { hash, ...rest } = u.ledger[i]
    if (rest.prev_hash !== prev || ledgerHash(u, rest) !== hash) return { valid: false, checked: u.ledger.length - i, first_broken_seq: rest.seq }
    prev = hash
  }
  return { valid: true, checked: u.ledger.length, first_broken_seq: null as number | null }
}

interface Received { seq: number; timestamp: string; temperature_c: number; signature: string }

function produce(u: UnitRec, ts: string): Received {
  const signed = (seq: number, t: number, key = u.key) => ({ seq, timestamp: ts, temperature_c: Math.round(t * 100) / 100, signature: hmac(key, canonical(u.sensor_id, seq, ts, Math.round(t * 100) / 100)) })
  switch (u.attack) {
    case 'spoof': return signed(u.next_seq++, u.nominal, attackerKey)
    case 'replay': {
      const old = u.ledger[Math.min(REPLAY_LOOKBACK - 1, u.ledger.length - 1)]
      return { seq: old.seq, timestamp: old.timestamp, temperature_c: old.temperature_c, signature: old.signature }
    }
    case 'impossible': { const seq = u.next_seq++; return signed(seq, seq % 2 === 0 ? u.nominal + SWING : u.nominal) }
    case 'excursion': return signed(u.next_seq++, Math.min(u.last_valid_temp + DRIFT, u.safe_max + CAP))
    default:
      u.offset = Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, u.offset + (Math.random() * 2 - 1) * NOISE))
      return signed(u.next_seq++, u.nominal + u.offset)
  }
}

function receive(u: UnitRec, r: Received, serverTs: string) {
  const flags: string[] = []
  const sigOk = hmac(u.key, canonical(u.sensor_id, r.seq, r.timestamp, r.temperature_c)) === r.signature
  if (!sigOk) flags.push('signature_invalid')
  const skew = Math.abs(Date.parse(serverTs) - Date.parse(r.timestamp)) / 1000
  const replay = r.seq <= u.last_valid_seq || skew > SKEW
  if (replay) flags.push('replay_suspected')
  else if (sigOk && r.seq > u.last_valid_seq + 1) flags.push('sequence_gap')
  if (sigOk && !replay) {
    if (r.temperature_c < -40 || r.temperature_c > 60 || Math.abs(r.temperature_c - u.last_valid_temp) > MAX_STEP + 1e-9) flags.push('implausible_reading')
    if (r.temperature_c < u.safe_min || r.temperature_c > u.safe_max) flags.push('temperature_excursion')
    u.last_valid_seq = r.seq; u.last_valid_ts = r.timestamp; u.last_valid_temp = r.temperature_c
  }
  const base = { ...r, check_result: (flags.length ? 'FLAGGED' : 'OK') as 'OK' | 'FLAGGED', flags, prev_hash: u.ledger[0]?.hash ?? u.anchor }
  u.ledger.unshift({ ...base, hash: ledgerHash(u, base) })
  if (u.ledger.length > LEDGER_MAX) u.anchor = u.ledger.pop()!.hash
}

const isAuthentic = (e: LedgerEntry) => !e.flags.includes('signature_invalid') && !e.flags.includes('replay_suspected')
function unitState(u: UnitRec) {
  const chain = verifyLedger(u)
  const window = u.ledger.slice(0, WINDOW)
  const count = (f: string) => window.filter((e) => e.flags.includes(f)).length
  const authentic = u.ledger.filter(isAuthentic).slice(0, EXC_CONSEC)
  const out = (t: number) => t < u.safe_min || t > u.safe_max
  const outOfRange = authentic.length === EXC_CONSEC && authentic.every((e) => out(e.temperature_c))
  const integrityHit = INTEGRITY_FLAGS.some((f) => count(f) > 0)
  const status: UnitStatus = !chain.valid || integrityHit ? 'INTEGRITY_RISK' : outOfRange ? 'EXCURSION' : 'NORMAL'
  return { chain, count, outOfRange, status, lastAuthentic: authentic[0] }
}

function startHistory(u: UnitRec) {
  u.ledger = []; u.anchor = 'GENESIS'; u.attack = null; u.offset = 0; u.last_valid_seq = u.next_seq - 1; u.last_valid_temp = u.nominal
  const start = Date.now() - STARTUP_HISTORY * TICK_MS
  for (let i = 1; i <= STARTUP_HISTORY; i++) {
    const ts = new Date(start + i * TICK_MS).toISOString().replace(/\.\d+Z$/, 'Z')
    receive(u, produce(u, ts), ts)
  }
  u.status = 'NORMAL'
}

const CC_DETAIL: Record<string, string> = {
  signature_invalid: 'Signature does not match the sensor key. This can come from a forged reading, a faulty gateway, or a key mismatch.',
  replay_suspected: 'A reading reused an old sequence number or timestamp. This can come from a replayed message, a gateway retry, or a clock problem.',
  implausible_reading: 'Temperature changed faster than the unit physically can. This can come from injected values or a failing sensor.',
  ledger_chain_broken: 'A stored ledger entry no longer matches its hash. A record was changed after it was written, or storage is corrupted.',
  temperature_excursion: 'Temperature is outside the safe range while readings passed every integrity check.',
  sequence_gap: 'Some sequence numbers were skipped. This can come from dropped messages or a sensor restart.',
}
const CC_TITLE: Record<string, string> = {
  signature_invalid: 'A reading failed the signature check on', replay_suspected: 'Replayed reading suspected on', implausible_reading: 'Impossible reading on',
  ledger_chain_broken: 'Ledger chain broken on', temperature_excursion: 'Temperature outside safe range on', sequence_gap: 'Sequence gap on',
}
const CC_EVENT: Record<string, string> = {
  signature_invalid: 'Signature check failed on', replay_suspected: 'Sequence and freshness check failed on', implausible_reading: 'Plausibility check failed on', ledger_chain_broken: 'Ledger chain check failed on',
}
const CC_SEVERITY: Record<string, Severity> = { signature_invalid: 'high', replay_suspected: 'high', implausible_reading: 'high', ledger_chain_broken: 'critical', temperature_excursion: 'medium', sequence_gap: 'low' }

function evaluateUnit(u: UnitRec) {
  const s = unitState(u)
  u.status = s.status
  const present: Record<string, boolean> = {
    signature_invalid: s.count('signature_invalid') > 0, replay_suspected: s.count('replay_suspected') > 0, implausible_reading: s.count('implausible_reading') > 0,
    ledger_chain_broken: !s.chain.valid, temperature_excursion: s.outOfRange, sequence_gap: s.count('sequence_gap') > 0,
  }
  for (const [type, on] of Object.entries(present)) {
    const det = activeDetection(u.id, type)
    if (on && !det) {
      const sev = type === 'temperature_excursion' && s.lastAuthentic && (s.lastAuthentic.temperature_c > u.safe_max + EXC_HIGH || s.lastAuthentic.temperature_c < u.safe_min - EXC_HIGH) ? 'high' : CC_SEVERITY[type]
      openDetection({ source: 'cold_chain', type, severity: sev, target_type: 'unit', target_id: u.id, target_name: u.name, detail: CC_DETAIL[type], batch_ids: batches.filter((b) => b.unit_id === u.id).map((b) => b.id) }, `${CC_TITLE[type]} ${u.name}`)
      if (type === 'temperature_excursion') log(SYSTEM, 'cold_chain', 'unit', u.id, u.name, 'excursion_detected', 'Temperature outside safe range while readings passed integrity checks')
      else if (CC_EVENT[type]) log(SYSTEM, 'cold_chain', 'unit', u.id, u.name, 'integrity_risk_detected', `${CC_EVENT[type]} ${u.name}`)
    } else if (det && type === 'temperature_excursion' && on && s.lastAuthentic) {
      const t = s.lastAuthentic.temperature_c
      if (t > u.safe_max + EXC_HIGH || t < u.safe_min - EXC_HIGH) { det.severity = 'high'; const a = alertFor(det); if (a) a.severity = 'high' }
    } else if (!on && det && type !== 'ledger_chain_broken') det.active = false
  }
  return s
}

const batchStatus = (b: BatchRec) => (b.quarantined ? 'QUARANTINED' : unitById(b.unit_id).status !== 'NORMAL' ? 'QUARANTINE_RECOMMENDED' : 'AVAILABLE')
const unitById = (id: string) => units.find((u) => u.id === id) ?? (() => { throw new HttpError(404, `No storage unit with ID ${id}. Pick a unit from the list.`) })()
const toBatch = (b: BatchRec): Batch => ({ id: b.id, product: b.product, quantity: b.quantity, quantity_unit: b.quantity_unit, status: batchStatus(b), quarantined_by: b.quarantined_by, quarantined_at: b.quarantined_at, note: b.note })

function unitSummary(u: UnitRec) {
  const last = u.ledger[0]
  return {
    id: u.id, name: u.name, location: u.location, safe_min: u.safe_min, safe_max: u.safe_max, status: u.status,
    last_temperature: last?.temperature_c ?? u.nominal, last_reading_at: last?.timestamp ?? now(),
    batches_at_risk: batches.filter((b) => b.unit_id === u.id && batchStatus(b) !== 'AVAILABLE').length, ledger_valid: verifyLedger(u).valid,
  }
}

function unitDetail(u: UnitRec): UnitDetail {
  const s = unitState(u)
  const n = (k: string) => s.count(k)
  const plural = (c: number) => `${c} of the last ${Math.min(WINDOW, u.ledger.length)} readings`
  const last = s.lastAuthentic?.temperature_c
  const checks: Check[] = [
    n('signature_invalid')
      ? { key: 'signature', label: 'Reading signature', state: 'fail', detail: `${plural(n('signature_invalid'))} failed the signature check. Signature does not match.` }
      : { key: 'signature', label: 'Reading signature', state: 'pass', detail: 'Every recent reading carries a valid sensor signature.' },
    n('replay_suspected')
      ? { key: 'sequence', label: 'Sequence and freshness', state: 'fail', detail: `${plural(n('replay_suspected'))} reused an old sequence number or timestamp.` }
      : { key: 'sequence', label: 'Sequence and freshness', state: 'pass', detail: n('sequence_gap') ? 'No replays. Some sequence numbers were skipped.' : 'Readings arrive in order and on time.' },
    n('implausible_reading')
      ? { key: 'plausibility', label: 'Plausibility', state: 'fail', detail: `${plural(n('implausible_reading'))} changed by more than ${MAX_STEP} °C between readings.` }
      : { key: 'plausibility', label: 'Plausibility', state: 'pass', detail: `Changes between readings stay within ${MAX_STEP} °C.` },
    s.chain.valid
      ? { key: 'ledger_chain', label: 'Ledger chain', state: 'pass', detail: `All ${s.chain.checked} ledger entries link to the one before.` }
      : { key: 'ledger_chain', label: 'Ledger chain', state: 'fail', detail: `Entry for reading ${s.chain.first_broken_seq} no longer matches its hash.` },
    s.outOfRange
      ? { key: 'temperature_range', label: 'Temperature range', state: 'fail', detail: `Latest authentic readings are outside ${u.safe_min} to ${u.safe_max} °C (now ${last?.toFixed(1)} °C).` }
      : { key: 'temperature_range', label: 'Temperature range', state: 'pass', detail: `Authentic readings are within ${u.safe_min} to ${u.safe_max} °C.` },
  ]
  return {
    ...unitSummary(u), first_broken_seq: s.chain.first_broken_seq, checks,
    readings: u.ledger.slice(0, 60).map(({ seq, timestamp, temperature_c, check_result, flags }) => ({ seq, timestamp, temperature_c, check_result, flags })),
    batches: batches.filter((b) => b.unit_id === u.id).map(toBatch),
  }
}

/* ---------- Simulator tick ---------- */
function tick() {
  for (const d of devices) {
    telemetry(d)
    const r = evaluate(d).risk
    if (r !== d.lastRisk && (d.mutation || d.isolated)) {
      log(SYSTEM, 'device_dna', 'device', d.id, d.name, 'risk_changed', `Risk ${d.lastRisk} to ${r}`, evaluate(d).dna_score)
      syncDnaDetection(d, r)
    }
    d.lastRisk = r
  }
  const ts = now()
  for (const u of units) {
    receive(u, produce(u, ts), ts)
    evaluateUnit(u)
  }
}
devices.forEach(telemetry)
units.forEach(startHistory)

/* ---------- Demo history: past detections, alerts and audit events ---------- */
function seedDemo() {
  const op = { username: 'demo.operator', role: 'security_operator' }, ph = { username: 'demo.pharmacist', role: 'pharmacist' }
  const ad = { username: 'demo.admin', role: 'admin' }, au = { username: 'demo.auditor', role: 'auditor' }
  const at = (min: number) => { clockOffset = min * 60_000; return now() }
  const det = (min: number, d: Omit<Detection, 'id' | 'timestamp' | 'active' | 'alert_id'>, title: string) => { at(min); return openDetection(d, title) }
  const alertOf = (d: Detection) => alerts.find((a) => a.id === d.alert_id)!
  const ack = (d: Detection, who: Actor, min: number) => { const a = alertOf(d); a.status = 'ACKNOWLEDGED'; a.acknowledged_by = who.username; a.acknowledged_at = at(min); log(who, 'console', 'alert', a.id, a.title, 'alert_status', 'Alert acknowledged') }
  const resolve = (d: Detection, who: Actor, min: number) => { d.active = false; const a = alertOf(d); a.status = 'RESOLVED'; a.resolved_by = who.username; a.resolved_at = at(min); log(who, 'console', 'alert', a.id, a.title, 'alert_status', 'Alert resolved') }
  const mon = devices[1], vent = devices[2], img = devices[3]
  const fridge = units[0], insulin = units[1], blood = units[2]

  at(185); log(ad, 'auth', 'session', 'u-ad', ad.username, 'login', 'Signed in')
  at(182); log(ad, 'users', 'user', 'u-au', au.username, 'role_changed', 'Role changed from pharmacist to auditor')
  at(170); log(op, 'auth', 'session', 'u-op', op.username, 'login', 'Signed in')

  at(162); log(SYSTEM, 'device_dna', 'device', img.id, img.name, 'risk_changed', 'Risk LOW to HIGH', 62)
  const d1 = det(162, { source: 'device_dna', type: 'dna_deviation', severity: 'high', target_type: 'device', target_id: img.id, target_name: img.name, detail: "DNA match 62%. Behavior differs from this device's baseline: destinations, packet size.", batch_ids: [] }, `Behavior differs from baseline on ${img.name}`)
  ack(d1, op, 158)
  at(150); log(op, 'device_dna', 'device', img.id, img.name, 'isolate', 'Isolation approved by operator')
  at(121); log(op, 'device_dna', 'device', img.id, img.name, 'restore', 'Device restored after vendor patch review')
  at(120); log(SYSTEM, 'device_dna', 'device', img.id, img.name, 'risk_changed', 'Risk HIGH to LOW', 97)
  resolve(d1, op, 119)

  at(104); log(SYSTEM, 'cold_chain', 'unit', blood.id, blood.name, 'excursion_detected', 'Temperature outside safe range while readings passed integrity checks')
  const d2 = det(104, { source: 'cold_chain', type: 'temperature_excursion', severity: 'high', target_type: 'unit', target_id: blood.id, target_name: blood.name, detail: 'Temperature reached 7.4 °C, above the 6 °C limit. Readings passed every integrity check.', batch_ids: [] }, `Temperature excursion on ${blood.name}`)
  at(101); log(ph, 'auth', 'session', 'u-ph', ph.username, 'login', 'Signed in')
  ack(d2, ph, 100)
  at(98); log(op, 'auth', 'batch', 'BATCH-RBC-0412', 'Red cells', 'access_denied', 'Role security_operator cannot approve quarantine')
  at(84); log(SYSTEM, 'cold_chain', 'unit', blood.id, blood.name, 'reset', 'Door seal replaced, temperature back in range')
  resolve(d2, ph, 82)

  at(66); log(SYSTEM, 'auth', 'session', 'u-op', 'unknown.user', 'login_failed', 'Wrong password for demo.operator')
  at(65); log(SYSTEM, 'auth', 'session', 'u-op', 'unknown.user', 'login_failed', 'Wrong password for demo.operator')

  at(48); log(SYSTEM, 'cold_chain', 'unit', insulin.id, insulin.name, 'integrity_risk_detected', `Replayed readings detected on ${insulin.name}`)
  const d3 = det(48, { source: 'cold_chain', type: 'replay_suspected', severity: 'critical', target_type: 'unit', target_id: insulin.id, target_name: insulin.name, detail: 'Readings arrived with sequence numbers already in the ledger. The gateway may be resending old data.', batch_ids: [] }, `Replayed readings on ${insulin.name}`)
  ack(d3, op, 45)
  at(30); log(op, 'cold_chain', 'unit', insulin.id, insulin.name, 'reset', 'Gateway restarted; unit reset to verified baseline')
  resolve(d3, op, 29)

  at(22); log(SYSTEM, 'device_dna', 'device', mon.id, mon.name, 'risk_changed', 'Risk LOW to MEDIUM', 78)
  const d4 = det(22, { source: 'device_dna', type: 'dna_deviation', severity: 'medium', target_type: 'device', target_id: mon.id, target_name: mon.name, detail: "DNA match 78%. Behavior differs from this device's baseline: response time.", batch_ids: [] }, `Behavior differs from baseline on ${mon.name}`)
  ack(d4, op, 18)
  at(15); log(SYSTEM, 'device_dna', 'device', mon.id, mon.name, 'risk_changed', 'Risk MEDIUM to LOW', 91)
  d4.active = false // cleared; alert still awaiting resolution

  at(12); log(SYSTEM, 'device_dna', 'device', vent.id, vent.name, 'risk_changed', 'Risk LOW to MEDIUM', 81)
  const d5 = det(12, { source: 'device_dna', type: 'dna_deviation', severity: 'medium', target_type: 'device', target_id: vent.id, target_name: vent.name, detail: "DNA match 81%. Behavior differs from this device's baseline: session duration.", batch_ids: [] }, `Behavior differs from baseline on ${vent.name}`)
  at(11); log(SYSTEM, 'device_dna', 'device', vent.id, vent.name, 'risk_changed', 'Risk MEDIUM to LOW', 94)
  d5.active = false // cleared; alert still open

  at(8); log(au, 'auth', 'session', 'u-au', au.username, 'login', 'Signed in')
  at(7); log(au, 'auth', 'user', 'u-au', au.username, 'access_denied', 'Role auditor cannot change roles')
  at(5); log(SYSTEM, 'cold_chain', 'unit', fridge.id, fridge.name, 'excursion_detected', 'Temperature outside safe range while readings passed integrity checks')
  const d6 = det(5, { source: 'cold_chain', type: 'temperature_excursion', severity: 'low', target_type: 'unit', target_id: fridge.id, target_name: fridge.name, detail: 'One reading at 8.2 °C during a restock, back in range within 2 minutes.', batch_ids: [] }, `Brief temperature excursion on ${fridge.name}`)
  d6.active = false
  clockOffset = 0
}
seedDemo()
setInterval(tick, TICK_MS)

/* ---------- Router ---------- */
type Body = Record<string, unknown> | undefined
const q = (url: URL, k: string) => url.searchParams.get(k) || undefined
const limit = (url: URL, def: number) => Math.min(200, Number(q(url, 'limit') ?? def) || def)

export function handle(method: string, path: string, body: Body, token: string | null): unknown {
  const url = new URL(path, 'http://sim')
  const p = url.pathname
  const route = `${method} ${p}`
  let m: RegExpMatchArray | null

  if (route === 'GET /health') return { status: 'ok', devices: devices.length, units: units.length }

  if (route === 'POST /auth/login') {
    const username = String(body?.username ?? '').trim()
    const u = users.find((x) => x.username === username)
    if (u && u.locked_until > Date.now()) throw new HttpError(429, 'Too many failed attempts. Wait a minute and try again.')
    if (!u || hashPw(u.salt, String(body?.password ?? '')) !== u.password_hash) {
      if (u) { u.failed++; if (u.failed >= 5) { u.locked_until = Date.now() + 60_000; u.failed = 0 } }
      log({ username: username || 'unknown', role: u?.role ?? 'unknown' }, 'auth', 'session', u?.id ?? username, username || 'unknown', 'login_failed', 'Sign-in failed')
      throw new HttpError(401, 'Username or password is incorrect. Check them and try again.')
    }
    u.failed = 0
    u.last_login = now()
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL
    const payload = b64(JSON.stringify({ sub: u.id, exp }))
    const sigHex = hmac(SESSION_SECRET, payload)
    const sig = b64(sigHex.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join(''))
    log(actorOf(u), 'auth', 'session', u.id, u.username, 'login', 'Signed in')
    return { token: `${payload}.${sig}`, expires_at: new Date(exp * 1000).toISOString().replace(/\.\d+Z$/, 'Z'), user: publicUser(u) }
  }

  const user = currentUser(token)
  const actor = actorOf(user)

  if (route === 'GET /auth/me') return { ...publicUser(user), permissions: PERMS[user.role] }

  // Device DNA
  if (route === 'GET /devices') {
    requirePerm(user, 'view')
    return devices.map((d) => { const { id, name, type, location, status, risk, dna_score } = evaluate(d); return { id, name, type, location, status, risk, dna_score } })
  }
  if (method === 'GET' && (m = p.match(/^\/devices\/([^/]+)$/))) { requirePerm(user, 'view'); return evaluate(findDevice(m[1])) }
  if (route === 'GET /events') {
    requirePerm(user, 'audit.view')
    const f = { target: q(url, 'target_id') ?? q(url, 'device_id'), actor: q(url, 'actor'), type: q(url, 'type'), source: q(url, 'source') }
    return events
      .filter((e) => (!f.target || e.target_id.includes(f.target) || e.target_name.toLowerCase().includes(f.target.toLowerCase())) && (!f.actor || e.actor.includes(f.actor)) && (!f.type || e.type === f.type) && (!f.source || e.source === f.source))
      .slice(0, limit(url, 30))
  }
  if (route === 'GET /events/verify') { requirePerm(user, 'audit.view'); return verifyChain() }
  if (method === 'POST' && (m = p.match(/^\/simulate\/([^/]+)$/))) {
    const d = findDevice(m[1])
    requirePerm(user, 'device.simulate', ['device', d.id, d.name])
    const preset = body?.preset as Preset
    if (!PRESETS[preset]) throw new HttpError(422, 'Unknown preset. Choose combined, exfiltration, injection, or firmware.')
    Object.assign(d, { mutation: preset, isolated: false, acknowledged: false })
    telemetry(d)
    const ev = evaluate(d)
    d.lastRisk = ev.risk
    if (ev.risk !== 'LOW') {
      const det = activeDetection(d.id, 'dna_deviation')
      if (det) syncDnaDetection(d, ev.risk)
      else openDetection({ source: 'device_dna', type: 'dna_deviation', severity: sevOfRisk(ev.risk), target_type: 'device', target_id: d.id, target_name: d.name, detail: `DNA match ${ev.dna_score}%. Behavior differs from this device's baseline: ${ev.deviations.map((x) => x.label.toLowerCase()).join(', ')}.`, batch_ids: [] }, `Behavior differs from baseline on ${d.name}`)
    }
    log(actor, 'device_dna', 'device', d.id, d.name, 'mutation_detected', `Behavioral mutation detected: ${PRESET_LABELS[preset].toLowerCase()}`, ev.dna_score)
    return ev
  }
  if (method === 'POST' && (m = p.match(/^\/reset\/([^/]+)$/))) {
    const d = findDevice(m[1])
    requirePerm(user, 'device.reset', ['device', d.id, d.name])
    Object.assign(d, { mutation: null, isolated: false, acknowledged: false, lastRisk: 'LOW' })
    telemetry(d)
    const det = activeDetection(d.id, 'dna_deviation')
    if (det) det.active = false
    log(actor, 'device_dna', 'device', d.id, d.name, 'reset', 'DNA reset to trusted baseline', evaluate(d).dna_score)
    return evaluate(d)
  }
  if (route === 'POST /actions') {
    const d = findDevice(String(body?.device_id))
    const action = body?.action
    const perm = { isolate: 'device.isolate', restore: 'device.restore', acknowledge: 'alert.acknowledge' }[String(action)]
    if (!perm) throw new HttpError(422, 'Unknown action. Use isolate, restore, or acknowledge.')
    requirePerm(user, perm, ['device', d.id, d.name])
    const ev = evaluate(d)
    if (action === 'isolate') {
      if (d.isolated) throw new HttpError(409, 'Device is already isolated.')
      if (!ev.deviations.length) throw new HttpError(409, 'Device has no active deviation, so there is nothing to isolate.')
      d.isolated = true; telemetry(d)
      log(actor, 'device_dna', 'device', d.id, d.name, 'isolated', 'Isolation approved by operator. Clinical operation continues.', evaluate(d).dna_score)
      return { ...evaluate(d), clinical_operation: 'CONTINUE' }
    }
    if (action === 'restore') {
      if (!d.isolated) throw new HttpError(409, 'Device is not isolated, so there is nothing to restore.')
      d.isolated = false; telemetry(d)
      log(actor, 'device_dna', 'device', d.id, d.name, 'restored', 'Device returned to monitored status', evaluate(d).dna_score)
      return evaluate(d)
    }
    if (ev.risk === 'LOW') throw new HttpError(409, 'Risk is low, so there is no alert to acknowledge.')
    if (d.acknowledged) throw new HttpError(409, 'This alert is already acknowledged.')
    acknowledgeDevice(d, user)
    return evaluate(d)
  }

  // Cold chain
  if (route === 'GET /coldchain/units') { requirePerm(user, 'view'); return units.map(unitSummary) }
  if (method === 'GET' && (m = p.match(/^\/coldchain\/units\/([^/]+)$/))) { requirePerm(user, 'view'); return unitDetail(unitById(m[1])) }
  if (route === 'GET /coldchain/ledger') {
    requirePerm(user, 'view')
    const u = unitById(String(q(url, 'unit_id')))
    return u.ledger.slice(0, limit(url, 50))
  }
  if (route === 'GET /coldchain/ledger/verify') { requirePerm(user, 'view'); const u = unitById(String(q(url, 'unit_id'))); return { unit_id: u.id, ...verifyLedger(u) } }
  if (method === 'POST' && (m = p.match(/^\/coldchain\/simulate\/([^/]+)$/))) {
    const u = unitById(m[1])
    requirePerm(user, 'coldchain.simulate', ['unit', u.id, u.name])
    const attack = body?.attack as Attack
    if (!ATTACK_LABELS[attack]) throw new HttpError(422, 'Unknown attack. Choose spoof, replay, log_edit, impossible, or excursion.')
    if (attack === 'log_edit') {
      const e = u.ledger[Math.min(4, u.ledger.length - 1)]
      e.temperature_c = e.temperature_c === u.nominal ? u.nominal + 0.01 : u.nominal // edited without recomputing the hash
    } else u.attack = attack
    log(actor, 'cold_chain', 'unit', u.id, u.name, 'attack_simulated', `Cold-chain attack simulated: ${ATTACK_LABELS[attack]}`)
    if (attack === 'log_edit') evaluateUnit(u)
    return unitDetail(u)
  }
  if (method === 'POST' && (m = p.match(/^\/coldchain\/reset\/([^/]+)$/))) {
    const u = unitById(m[1])
    requirePerm(user, 'coldchain.reset', ['unit', u.id, u.name])
    startHistory(u)
    detections.filter((d) => d.target_id === u.id && d.active).forEach((d) => (d.active = false))
    log(actor, 'cold_chain', 'unit', u.id, u.name, 'reset', 'Unit reset to verified baseline')
    return unitDetail(u)
  }
  if (route === 'POST /coldchain/actions') {
    const b = batches.find((x) => x.id === body?.batch_id)
    if (!b) throw new HttpError(404, 'No batch with that ID.')
    const u = unitById(b.unit_id)
    const note = body?.note ? String(body.note).slice(0, 200) : null
    if (body?.action === 'quarantine') {
      requirePerm(user, 'batch.quarantine', ['batch', b.id, `${b.id} ${b.product}`])
      if (b.quarantined) throw new HttpError(409, 'Batch is already quarantined.')
      Object.assign(b, { quarantined: true, quarantined_by: user.display_name, quarantined_at: now(), note })
      log(actor, 'cold_chain', 'batch', b.id, `${b.id} ${b.product}`, 'batch_quarantined', `Quarantine approved by pharmacist${note ? `: ${note}` : ''}`)
      return { ...unitDetail(u), stock_action: 'HOLD' }
    }
    if (body?.action === 'release') {
      requirePerm(user, 'batch.release', ['batch', b.id, `${b.id} ${b.product}`])
      if (!b.quarantined) throw new HttpError(409, 'Batch is not quarantined, so there is nothing to release.')
      if (u.status !== 'NORMAL') throw new HttpError(409, 'The unit readings are still flagged, so the batch cannot be released yet. Reset the unit and confirm the checks pass first.')
      Object.assign(b, { quarantined: false, quarantined_by: null, quarantined_at: null, note: null })
      log(actor, 'cold_chain', 'batch', b.id, `${b.id} ${b.product}`, 'batch_released', `Batch released by pharmacist${note ? `: ${note}` : ''}`)
      return unitDetail(u)
    }
    throw new HttpError(422, 'Unknown action. Use quarantine or release.')
  }

  // Console
  if (route === 'GET /console/summary') {
    requirePerm(user, 'view')
    const open = alerts.filter((a) => a.status !== 'RESOLVED')
    return {
      open_detections: detections.filter((d) => d.active).length, open_alerts: open.length, critical_alerts: open.filter((a) => a.severity === 'critical').length,
      integrity_risk_units: units.filter((u) => u.status === 'INTEGRITY_RISK').length, quarantined_batches: batches.filter((b) => b.quarantined).length,
      chain_valid: verifyChain().valid, ledgers_valid: units.every((u) => verifyLedger(u).valid),
    }
  }
  if (route === 'GET /console/detections') {
    requirePerm(user, 'view')
    const [source, severity, active, target] = ['source', 'severity', 'active', 'target_id'].map((k) => q(url, k))
    return detections.filter((d) => (!source || d.source === source) && (!severity || d.severity === severity) && (active !== 'true' || d.active) && (!target || d.target_id === target)).slice(0, limit(url, 50))
  }
  if (route === 'GET /console/alerts') {
    requirePerm(user, 'view')
    const [status, severity, target] = ['status', 'severity', 'target_id'].map((k) => q(url, k))
    return alerts.filter((a) => (!status || a.status === status.toUpperCase()) && (!severity || a.severity === severity) && (!target || detections.find((d) => d.id === a.detection_id)?.target_id === target)).slice(0, limit(url, 50))
  }
  if (method === 'POST' && (m = p.match(/^\/console\/alerts\/([^/]+)\/status$/))) {
    const a = alerts.find((x) => x.id === m![1])
    if (!a) throw new HttpError(404, 'No alert with that ID.')
    const det = detections.find((d) => d.id === a.detection_id)!
    const target: [string, string, string] = ['alert', a.id, a.title]
    if (body?.status === 'acknowledged') {
      requirePerm(user, 'alert.acknowledge', target)
      if (a.status !== 'OPEN') throw new HttpError(409, `Alert is already ${a.status.toLowerCase()}.`)
      const d = det.source === 'device_dna' ? devices.find((x) => x.id === det.target_id) : undefined
      if (d) acknowledgeDevice(d, user)
      else {
        Object.assign(a, { status: 'ACKNOWLEDGED' as AlertStatus, acknowledged_by: user.display_name, acknowledged_at: now() })
        log(actor, det.source, 'alert', a.id, a.title, 'acknowledged', 'Alert acknowledged by operator')
      }
      return a
    }
    if (body?.status === 'resolved') {
      requirePerm(user, 'alert.resolve', target)
      if (a.status === 'RESOLVED') throw new HttpError(409, 'Alert is already resolved.')
      if (det.active) throw new HttpError(409, 'The condition behind this alert is still active. Reset the device or unit, or wait until the checks pass, then resolve.')
      Object.assign(a, { status: 'RESOLVED' as AlertStatus, resolved_by: user.display_name, resolved_at: now() })
      log(actor, det.source, 'alert', a.id, a.title, 'alert_status_changed', 'Alert resolved by operator')
      return a
    }
    throw new HttpError(422, 'Unknown status. Use acknowledged or resolved.')
  }
  if (route === 'GET /users') { requirePerm(user, 'user.view'); return users.map(publicUser) }
  if (route === 'GET /roles') { requirePerm(user, 'view'); return (Object.keys(PERMS) as Role[]).map((role) => ({ role, label: ROLE_LABELS[role], permissions: PERMS[role] })) }
  if (method === 'POST' && (m = p.match(/^\/users\/([^/]+)\/role$/))) {
    const t = users.find((x) => x.id === m![1])
    if (!t) throw new HttpError(404, 'No user with that ID.')
    requirePerm(user, 'user.manage', ['user', t.id, t.username])
    const role = body?.role as Role
    if (!PERMS[role]) throw new HttpError(422, 'Unknown role.')
    if (t.role === role) throw new HttpError(409, `${t.display_name} already has the ${ROLE_LABELS[role]} role.`)
    if (t.role === 'admin' && users.filter((x) => x.role === 'admin').length === 1) throw new HttpError(409, 'At least one Admin must remain. Assign another Admin first.')
    const prev = t.role
    t.role = role
    log(actor, 'users', 'user', t.id, t.username, 'role_changed', `Role ${prev} to ${role}`)
    return publicUser(t)
  }
  throw new HttpError(404, `No endpoint for ${method} ${p}.`)
}

function acknowledgeDevice(d: DeviceRec, u: UserRec) {
  d.acknowledged = true
  const a = alertFor(activeDetection(d.id, 'dna_deviation'))
  if (a && a.status === 'OPEN') Object.assign(a, { status: 'ACKNOWLEDGED' as AlertStatus, acknowledged_by: u.display_name, acknowledged_at: now() })
  log(actorOf(u), 'device_dna', 'device', d.id, d.name, 'acknowledged', 'Alert acknowledged by operator', evaluate(d).dna_score)
}
