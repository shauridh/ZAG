import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { isDemo, loadSettings } from './lib/db'
import { OfflineIndicator } from './components/OfflineIndicator'
import { TabletBar } from './components/TabletBar'
import { FullscreenGate } from './components/FullscreenGate'
import { AppErrorBoundary } from './components/AppErrorBoundary'

// Route-level code splitting: tiap halaman chunk sendiri, charts/maps hanya
// terunduh saat halaman yang memang memakainya dibuka.
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Cashier = lazy(() => import('./pages/Cashier'))
const Orders = lazy(() => import('./pages/Orders'))
const Production = lazy(() => import('./pages/Production'))
const Ingredients = lazy(() => import('./pages/Ingredients'))
const Products = lazy(() => import('./pages/Products'))
const Finance = lazy(() => import('./pages/Finance'))
const ShiftPage = lazy(() => import('./pages/Shift'))
const HistoryPage = lazy(() => import('./pages/History'))
const SettingsPage = lazy(() => import('./pages/Settings'))

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}
interface NavGroup {
  label: string
  items: NavItem[]
}

// Menu dikelompokkan: operasional harian di atas, pengelolaan di tengah,
// catatan & pengaturan di bawah.
const NAV_ADMIN: NavGroup[] = [
  {
    label: 'Operasional',
    items: [
      { to: '/', label: 'Dashboard', icon: '📊', end: true },
      { to: '/kasir', label: 'Kasir', icon: '🧾' },
      { to: '/pesanan', label: 'Pesanan', icon: '🛍️' },
      { to: '/riwayat', label: 'Riwayat Transaksi', icon: '🕘' },
      { to: '/produksi', label: 'Produksi & Fryer', icon: '🍟' },
      { to: '/shift', label: 'Shift', icon: '🔄' }
    ]
  },
  {
    label: 'Produk & Stok',
    items: [
      { to: '/menu', label: 'Menu & Paket', icon: '🍗' },
      { to: '/bahan', label: 'Bahan Baku & HPP', icon: '🥘' }
    ]
  },
  {
    label: 'Keuangan',
    items: [{ to: '/keuangan', label: 'Keuangan', icon: '💰' }]
  },
  {
    label: 'Sistem',
    items: [{ to: '/pengaturan', label: 'Pengaturan', icon: '⚙️' }]
  }
]
const NAV_KASIR: NavGroup[] = [
  {
    label: 'Operasional',
    items: [
      { to: '/kasir', label: 'Kasir', icon: '🧾' },
      { to: '/pesanan', label: 'Pesanan', icon: '🛍️' },
      { to: '/riwayat', label: 'Riwayat Transaksi', icon: '🕘' },
      { to: '/produksi', label: 'Produksi & Fryer', icon: '🍟' },
      { to: '/shift', label: 'Shift', icon: '🔄' }
    ]
  },
  {
    label: 'Produk & Stok',
    items: [{ to: '/bahan', label: 'Bahan Baku & HPP', icon: '🥘' }]
  }
]

const LS_SIDEBAR = 'sabana-sidebar-collapsed'

function Shell(): ReactElement {
  const { session, signOut } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  // Brand dari settings toko (nama + tagline); fallback aman saat gagal muat
  const [brand, setBrand] = useState({ name: 'Sabana Kasir', tagline: 'Drieischicken POS' })
  // Aksesibilitas drawer mobile (ux: drawer focus trap — High):
  // Escape menutup, fokus masuk ke link pertama, Tab dipagari di dalam drawer,
  // fokus kembali ke tombol ☰ saat drawer ditutup.
  useEffect(() => {
    if (!open) return
    const aside = drawerRef.current
    const panel = aside?.querySelector('nav') ?? aside
    const first = panel?.querySelector<HTMLElement>('a, button')
    first?.focus()
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        return
      }
      if (e.key !== 'Tab' || !aside) return
      const items = [...aside.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      if (items.length === 0) return
      const idx = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : idx === items.length - 1 ? 0 : idx + 1
      items[next].focus()
    }
    window.addEventListener('keydown', h)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prevOverflow
      document.querySelector<HTMLButtonElement>('button[aria-label="Buka menu"]')?.focus()
    }
  }, [open])
  useEffect(() => {
    if (!session) return
    void loadSettings()
      .then((s) => setBrand({ name: s.store.name || 'Sabana Kasir', tagline: s.store.tagline || 'Drieischicken POS' }))
      .catch(() => {})
  }, [session])
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(LS_SIDEBAR)
    if (saved !== null) return saved === '1'
    // tablet (<1280): mulai dari mode ikon supaya konten lega —
    // di 1024px sidebar terbuka menyisakan terlalu sempit untuk grid menu kasir
    return window.innerWidth < 1280
  })
  if (!session) return <Login />
  const navGroups = session.role === 'admin' ? NAV_ADMIN : NAV_KASIR

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      localStorage.setItem(LS_SIDEBAR, c ? '0' : '1')
      return !c
    })
  }

  const renderNav = (compact: boolean): ReactElement => (
    <nav className={`flex flex-col gap-0.5 ${compact ? 'px-2 pb-3' : 'p-3'}`} aria-label="Menu utama">
      {navGroups.map((g, gi) => (
        <div key={g.label} className={compact && gi > 0 ? 'mt-1.5 border-t border-brand-line pt-1.5' : ''}>
          {!compact && (
            <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-wider text-brand-muted">{g.label}</p>
          )}
          {g.items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              title={compact ? n.label : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-lg text-sm font-bold ${
                  compact ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2.5'
                } ${isActive ? 'bg-brand-btn text-white' : 'text-brand-ink hover:bg-brand-paper'}`
              }
            >
              <span aria-hidden className="w-5 text-center text-base leading-none">
                {n.icon}
              </span>
              {!compact && <span>{n.label}</span>}
            </NavLink>
          ))}
        </div>
      ))}
      <hr className="my-2 border-brand-line" />
      <button
        type="button"
        title={compact ? `Keluar (${session.name})` : undefined}
        className={`flex items-center rounded-lg text-sm font-bold text-brand-redtext hover:bg-brand-paper ${
          compact ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2.5 text-left'
        }`}
        onClick={async () => {
          await signOut()
          nav('/')
        }}
      >
        <span aria-hidden className="w-5 text-center text-base leading-none">
          🚪
        </span>
        {!compact && <span>Keluar ({session.name})</span>}
      </button>
    </nav>
  )

  return (
    <div className="flex h-full">
      {/* Sidebar desktop: bisa diciutkan jadi ikon saja */}
      <aside
        className={`hidden shrink-0 border-r-[1.5px] border-brand-line bg-brand-card md:block ${
          collapsed ? 'w-[68px]' : 'w-56'
        }`}
      >
        <div className="strip flex items-center justify-between px-3 pb-3 pt-5">
          {!collapsed && (
            <div>
              <p className="text-lg font-extrabold leading-tight">{brand.name}</p>
              {brand.tagline && <p className="text-xs font-bold text-brand-muted">{brand.tagline}</p>}
            </div>
          )}
          <button
            type="button"
            className="btn-ghost !min-h-0 !px-2 !py-1 text-base"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Tampilkan label menu' : 'Ciutkan menu jadi ikon'}
            aria-expanded={!collapsed}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        {renderNav(collapsed)}
        {!collapsed && (
          <p className="px-4 pb-4 text-[11px] text-brand-muted">
            {isDemo ? 'Mode demo lokal' : 'Tersambung Supabase'} · {session.role === 'admin' ? 'Admin' : 'Kasir'}
          </p>
        )}
      </aside>

      {/* Drawer mobile/tablet kecil */}
      {open && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true" aria-label="Menu navigasi">
          <div className="absolute inset-0 bg-black/45" onClick={() => setOpen(false)} aria-hidden />
          <aside ref={drawerRef} className="relative w-64 border-r-[1.5px] border-brand-line bg-brand-card">
            <div className="strip flex items-center justify-between px-4 pb-3 pt-5">
              <p className="text-lg font-extrabold leading-tight">{brand.name}</p>
              <button
                type="button"
                className="btn-ghost !min-h-[44px] !w-[44px] !min-w-[44px] !px-0 text-lg"
                onClick={() => setOpen(false)}
                aria-label="Tutup menu"
              >
                ✕
              </button>
            </div>
            {brand.tagline && <p className="px-4 text-xs font-bold text-brand-muted">{brand.tagline}</p>}
            {renderNav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b-[1.5px] border-brand-line bg-brand-card px-4 py-2 md:hidden">
          <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2 text-lg" onClick={() => setOpen(true)} aria-label="Buka menu">
            ☰
          </button>
          <p className="truncate text-base font-extrabold">{brand.name}</p>
          <OfflineIndicator className="ml-auto" />
          {isDemo && <span className="chip bg-brand-gold">DEMO</span>}
        </header>
        <div className="hidden items-center gap-2 border-b-[1.5px] border-brand-line bg-brand-card px-4 py-1.5 md:flex">
          <OfflineIndicator />
          {isDemo && <span className="chip bg-brand-gold">Mode demo: data tersimpan di browser ini</span>}
          <div className="ml-auto">
            <TabletBar />
          </div>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <FullscreenGate />
          <AppErrorBoundary>
            <Suspense fallback={<div className="p-6 text-sm font-bold text-brand-muted">Memuat halaman...</div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/kasir" element={<Cashier />} />
                <Route path="/pesanan" element={<Orders />} />
                <Route path="/riwayat" element={<HistoryPage />} />
                <Route path="/produksi" element={<Production />} />
                <Route path="/bahan" element={<Ingredients />} />
                <Route path="/menu" element={<Products />} />
                {/* Halaman Stok lama sudah merger ke /bahan?tab=stok */}
                <Route path="/stok" element={<Navigate to="/bahan?tab=stok" replace />} />
                <Route path="/keuangan" element={<Finance />} />
                <Route path="/shift" element={<ShiftPage />} />
                <Route path="/pengaturan" element={<SettingsPage />} />
              </Routes>
            </Suspense>
          </AppErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export default function App(): ReactElement {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
