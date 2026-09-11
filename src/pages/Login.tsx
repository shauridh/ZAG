import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { useAuth } from '../auth'
import { isDemo, loadSettings } from '../lib/db'

export default function Login(): ReactElement {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Nama & tagline toko dari Pengaturan (anon boleh baca 'store'); fallback aman
  const [brand, setBrand] = useState({ name: 'Sabana Kasir', tagline: 'Drieischicken POS' })

  useEffect(() => {
    void loadSettings()
      .then((s) => setBrand({ name: s.store.name || 'Sabana Kasir', tagline: s.store.tagline || 'Drieischicken POS' }))
      .catch(() => {})
  }, [])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-sm overflow-hidden">
        <div className="border-b-[3px] border-brand-gold bg-brand-btn px-6 pb-6 pt-8 text-center">
          <p className="text-3xl font-extrabold text-white drop-shadow">{brand.name}</p>
          {brand.tagline && <p className="mt-1 text-sm font-bold text-white/90">{brand.tagline}</p>}
        </div>
        <form className="flex flex-col gap-3 p-6" onSubmit={submit}>
          <div>
            <label className="lbl" htmlFor="email">
              Email
            </label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="lbl" htmlFor="password">
              Kata sandi
            </label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {err && (
            <p className="rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
              {err}
            </p>
          )}
          <button type="submit" className="btn-primary mt-1 w-full !py-3" disabled={busy}>
            {busy ? 'Memeriksa...' : 'Masuk'}
          </button>
          {isDemo ? (
            <p className="text-center text-xs text-brand-muted">
              Mode demo: email apa pun bisa masuk. Awali dengan "admin" untuk peran admin,
              <br />
              contoh: admin@sabana.id
            </p>
          ) : (
            <p className="text-center text-xs text-brand-muted">Belum punya akun? Minta dibuatkan oleh pemilik gerai.</p>
          )}
        </form>
      </div>
    </main>
  )
}
