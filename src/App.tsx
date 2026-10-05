import { useSyncExternalStore, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { WifiOff } from 'lucide-react'
import { connection, errorText } from './api/client'
import Header from './components/Header'
import { AuthProvider, useAuth } from './hooks/useAuth'
import ColdChainPage from './pages/ColdChainPage'
import ConsolePage from './pages/ConsolePage'
import FleetPage from './pages/FleetPage'
import LoginPage from './pages/LoginPage'

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

function Banner() {
  const connected = useSyncExternalStore(connection.subscribe, connection.get)
  const { user } = useAuth()
  if (connected || !user) return null
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-critical/30 bg-critical/5 p-4 text-sm">
      <WifiOff className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
      <p><span className="font-bold">Disconnected.</span> {errorText(null)} Showing the last data received.</p>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <div className="min-h-dvh bg-bg text-ink">
          <Header />
          <main className="mx-auto max-w-[1180px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
            <Banner />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/fleet" element={<RequireAuth><FleetPage /></RequireAuth>} />
              <Route path="/cold-chain" element={<RequireAuth><ColdChainPage /></RequireAuth>} />
              <Route path="/console/:tab" element={<RequireAuth><ConsolePage /></RequireAuth>} />
              <Route path="/console" element={<Navigate to="/console/detections" replace />} />
              <Route path="*" element={<Navigate to="/fleet" replace />} />
            </Routes>
            <p className="pt-4 text-center text-[13px] text-faint">Trust the behavior, not just the identity.</p>
          </main>
        </div>
      </AuthProvider>
    </HashRouter>
  )
}
