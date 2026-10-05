import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogIn } from 'lucide-react'
import { ApiError } from '../api/client'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../api/server'
import { ROLE_LABELS } from '../api/server/types'
import { useAuth } from '../hooks/useAuth'
import { Button, card, inputCls } from '../components/ui'

export default function LoginPage() {
  const { user, login, notice } = useAuth()
  const nav = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/fleet'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
      nav(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the MED-DNA service. Check that the backend is running, then try again.")
    } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto grid max-w-[1180px] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_420px] lg:items-center lg:py-20">
      <div className="max-w-lg">
        <p className="font-mono text-[13px] text-primary">Behavioral cybersecurity for connected medical devices</p>
        <h1 tabIndex={-1} className="mt-3 text-[clamp(2rem,5vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em]">Trust the behavior, not just the identity.</h1>
        <p className="mt-4 text-muted">MED-DNA flags devices that stop behaving like themselves and storage units whose readings can't be trusted. Nothing changes on a device or in stock until a person approves it.</p>
      </div>

      <div className={`${card} rounded-2xl p-6 sm:p-8`}>
        <h2 className="text-2xl font-bold tracking-[-0.02em]">Sign in</h2>
        <p className="mt-1 text-sm text-muted">Simulated users for demonstration only.</p>
        <div role="alert" className="empty:hidden mt-4 rounded-lg bg-critical/8 p-3 text-sm font-medium text-critical">{error ?? (notice || '')}</div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Username</span>
            <input className={`${inputCls} mt-1.5 font-mono`} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input className={`${inputCls} mt-1.5 font-mono`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <Button variant="primary" className="w-full" disabled={busy}><LogIn className="size-4" />{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>

        <details className="group mt-6 rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold">
            Demo accounts <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.username} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px]">{a.username}</p>
                  <p className="text-[13px] text-muted">{ROLE_LABELS[a.role]}</p>
                </div>
                <button type="button" onClick={() => { setUsername(a.username); setPassword(DEMO_PASSWORD) }} className="h-9 rounded-lg px-3 text-sm font-bold text-primary hover:bg-well">Fill in</button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">Demo password: <span className="font-mono text-ink">{DEMO_PASSWORD}</span></p>
        </details>
      </div>
    </main>
  )
}
