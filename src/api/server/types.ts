export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type Status = 'TRUSTED' | 'WATCH' | 'SUSPICIOUS' | 'CRITICAL' | 'ISOLATED'
export type AttrKey = 'dest' | 'cmd' | 'pkt' | 'resp' | 'dur'
export type Preset = 'combined' | 'exfiltration' | 'injection' | 'firmware'
export type Attack = 'spoof' | 'replay' | 'log_edit' | 'impossible' | 'excursion'
export type Role = 'security_operator' | 'pharmacist' | 'admin' | 'auditor'
export type UnitStatus = 'NORMAL' | 'EXCURSION' | 'INTEGRITY_RISK'
export type BatchStatus = 'AVAILABLE' | 'QUARANTINE_RECOMMENDED' | 'QUARANTINED'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'

export interface DeviceSummary { id: string; name: string; type: string; location: string; status: Status; risk: Risk; dna_score: number }
export interface Attribute { key: AttrKey; label: string; unit: string; baseline: number; observed: number; tolerance: number; similarity: number }
export interface Deviation { key: AttrKey; label: string; unit: string; baseline: number; observed: number; point_impact: number }
export interface DeviceDetail extends DeviceSummary { acknowledged: boolean; isolated: boolean; attributes: Attribute[]; deviations: Deviation[] }

export interface DnaEvent {
  timestamp: string; actor: string; actor_role: string; source: string; target_type: string; target_id: string; target_name: string
  device_id: string; device_name: string; type: string; detail: string; dna_score: number | null; prev_hash: string; hash: string
}
export interface ChainCheck { valid: boolean; checked: number; broken_at: number | null }

export interface User { id: string; username: string; display_name: string; role: Role; last_login: string | null }
export interface Me extends User { permissions: string[] }
export interface LoginResult { token: string; expires_at: string; user: User }

export interface UnitSummary { id: string; name: string; location: string; safe_min: number; safe_max: number; status: UnitStatus; last_temperature: number; last_reading_at: string; batches_at_risk: number; ledger_valid: boolean }
export interface Check { key: string; label: string; state: 'pass' | 'fail'; detail: string }
export interface Reading { seq: number; timestamp: string; temperature_c: number; check_result: 'OK' | 'FLAGGED'; flags: string[] }
export interface Batch { id: string; product: string; quantity: number; quantity_unit: string; status: BatchStatus; quarantined_by: string | null; quarantined_at: string | null; note: string | null }
export interface UnitDetail extends UnitSummary { first_broken_seq: number | null; checks: Check[]; readings: Reading[]; batches: Batch[]; stock_action?: 'HOLD' }
export interface LedgerEntry extends Reading { signature: string; prev_hash: string; hash: string }
export interface LedgerCheck { unit_id: string; valid: boolean; checked: number; first_broken_seq: number | null }

export interface Detection { id: string; timestamp: string; source: 'device_dna' | 'cold_chain'; type: string; severity: Severity; target_type: 'device' | 'unit'; target_id: string; target_name: string; detail: string; active: boolean; alert_id: string; batch_ids: string[] }
export interface Alert { id: string; detection_id: string; created_at: string; severity: Severity; title: string; status: AlertStatus; acknowledged_by: string | null; acknowledged_at: string | null; resolved_by: string | null; resolved_at: string | null }
export interface Summary { open_detections: number; open_alerts: number; critical_alerts: number; integrity_risk_units: number; quarantined_batches: number; chain_valid: boolean; ledgers_valid: boolean }
export interface RoleInfo { role: Role; label: string; permissions: string[] }

export const PRESET_LABELS: Record<Preset, string> = { combined: 'Combined mutation', exfiltration: 'Data exfiltration', injection: 'Command injection', firmware: 'Firmware drift' }
export const ATTACK_LABELS: Record<Attack, string> = {
  spoof: 'Forged reading (spoof)', replay: 'Replayed readings (replay)', log_edit: 'Edited log (log_edit)',
  impossible: 'Impossible swings (impossible)', excursion: 'Real temperature rise (excursion)',
}
export const ROLE_LABELS: Record<Role, string> = { security_operator: 'Security Operator', pharmacist: 'Pharmacist', admin: 'Admin', auditor: 'Auditor' }
