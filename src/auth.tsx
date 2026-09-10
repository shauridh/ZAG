import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { currentSession, signIn as dbSignIn, signOut as dbSignOut, type SessionInfo } from './lib/db'
import { primeAudio } from './lib/sound'

interface AuthCtx {
  session: SessionInfo | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void currentSession().then((s) => {
      setSession(s)
      setLoading(false)
    })
  }, [])

  const value: AuthCtx = {
    session,
    loading,
    signIn: async (email, password) => {
      const s = await dbSignIn(email, password)
      setSession(s)
      primeAudio()
    },
    signOut: async () => {
      await dbSignOut()
      setSession(null)
    }
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth di luar AuthProvider')
  return c
}
