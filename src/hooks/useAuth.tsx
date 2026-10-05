import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, session } from '../api/client'
import type { User } from '../api/server/types'

interface AuthValue {
  user: User | null
  permissions: string[]
  can: (p: string) => boolean
  login: (username: string, password: string) => Promise<void>
  logout: (message?: string) => void
  refresh: () => Promise<void>
  notice: string | null
}
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => session.stored()?.user ?? null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const logout = useCallback((message?: string) => {
    session.set(null)
    setUser(null)
    setPermissions([])
    setNotice(message ?? null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      const { permissions: perms, ...u } = me
      setUser(u)
      setPermissions(perms)
    } catch { /* 401 handled globally, network errors keep last permissions */ }
  }, [])

  useEffect(() => { session.onUnauthorized(() => logout('Your session has expired. Sign in again.')) }, [logout])
  useEffect(() => { if (user) refresh() }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password)
    session.set(res)
    setNotice(null)
    setUser(res.user)
  }, [])

  const value = useMemo<AuthValue>(() => ({ user, permissions, can: (p) => permissions.includes(p), login, logout, refresh, notice }), [user, permissions, login, logout, refresh, notice])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
