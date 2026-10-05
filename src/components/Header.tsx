import { useSyncExternalStore } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, WifiOff } from 'lucide-react'
import { connection } from '../api/client'
import { ROLE_LABELS } from '../api/server/types'
import { useAuth } from '../hooks/useAuth'
import usePolling from '../hooks/usePolling'
import { api } from '../api/client'

const NAV = [
  { to: '/fleet', label: 'Fleet' },
  { to: '/cold-chain', label: 'Cold Chain' },
  { to: '/console/detections', label: 'Security Console', match: '/console' },
]

export default function Header() {
  const { user, logout } = useAuth()
  const connected = useSyncExternalStore(connection.subscribe, connection.get)
  const offline = useSyncExternalStore(connection.subscribe, connection.isOffline)
  const { pathname } = useLocation()
  usePolling(() => { if (user) api.health().catch(() => {}) }, 2000, [user?.id])

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary font-mono text-xs font-medium text-white" aria-hidden>DNA</div>
            <div>
              <p className="text-[22px] font-bold leading-tight tracking-[-0.02em]">MED-DNA</p>
              <p className="text-[13px] text-muted">Medical Device Command Center</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            <span className="hidden text-faint lg:inline">Simulated devices and synthetic telemetry only.</span>
            {user && (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-muted">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={offline} onChange={(e) => connection.setOffline(e.target.checked)} />
                  Simulate outage
                </label>
                {connected ? (
                  <span className="inline-flex items-center gap-2 font-medium text-ink"><span className="live-dot size-2 rounded-full bg-low" />Live monitoring</span>
                ) : (
                  <span className="inline-flex items-center gap-2 font-medium text-muted"><WifiOff className="size-3.5" />Disconnected</span>
                )}
              </>
            )}
          </div>
          <p className="w-full text-[13px] text-faint lg:hidden">Simulated devices and synthetic telemetry only.</p>
        </div>
        {user && (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <nav aria-label="Views" className="-mb-px min-w-0 max-w-full overflow-x-auto">
              <ul className="flex gap-6 whitespace-nowrap">
                {NAV.map((n) => {
                  const active = pathname.startsWith(n.match ?? n.to)
                  return (
                    <li key={n.to}>
                      <NavLink to={n.to} aria-current={active ? 'page' : undefined}
                        className={`inline-block border-b-2 py-3 text-[15px] font-medium transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'}`}>
                        {n.label}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </nav>
            <div className="flex items-center gap-3 pb-2 text-sm">
              <span><span className="font-medium">{user.display_name}</span> <span className="text-muted">({ROLE_LABELS[user.role]})</span></span>
              <button onClick={() => logout()} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-bold text-primary hover:bg-well"><LogOut className="size-4" />Sign out</button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
