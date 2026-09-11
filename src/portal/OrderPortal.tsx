import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadCatalog, loadSettings, loadZones, portal, type Catalog, type PortalAddress } from '../lib/db'
import { feeForDistance, haversineKm, maxRadius } from '../lib/geo'
import { fmtRp, fmtQty } from '../lib/money'
import { checkSchedule, deliveryActive, DAY_LABELS, normalizeSchedule } from '../lib/delivery-schedule'
import type { DeliveryZone, OutletSetting, PortalOrder, Settings } from '../lib/types'
import { MapPicker } from '../components/MapPicker'
import { useToast } from '../components/Toast'

const LS_TOKEN = 'sabana-portal-token'
const LS_NAME = 'sabana-portal-name'

type Screen = 'katalog' | 'checkout' | 'pesanan' | 'akun'

const STATUS_VIEW: Record<string, { label: string; hint: string }> = {
  menunggu: { label: 'Menunggu validasi kasir', hint: 'Kasir sedang memeriksa ketersediaan pesananmu.' },
  ditolak: { label: 'Ditolak kasir', hint: 'Cek alasan penolakan di bawah. Kamu bisa memesan ulang.' },
  qris_dikirim: { label: 'Scan QRIS untuk bayar', hint: 'Bayar TEPAT sesuai total, lalu tekan "Sudah Bayar".' },
  menunggu_verifikasi: { label: 'Menunggu konfirmasi pembayaran', hint: 'Kasir sedang mengecek penerimaan pembayaranmu.' },
  diproses: { label: 'Pesanan digoreng', hint: 'Ayammu sedang digoreng segar!' },
  dikirim: { label: 'Sedang diantar', hint: 'Siapkan pembayaran kalau ada sisa.' },
  selesai: { label: 'Selesai', hint: 'Terima kasih sudah memesan di Sabana!' },
  batal: { label: 'Batal', hint: 'Pesanan dibatalkan.' }
}

export default function OrderPortal(): ReactElement {
  const [token, setToken] = useState<string>(() => localStorage.getItem(LS_TOKEN) ?? '')
  const [name, setName] = useState<string>(() => localStorage.getItem(LS_NAME) ?? '')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // jadwal antar dicek ulang tiap menit supaya portal on/off sendiri mengikuti jam operasional
    const iv = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(iv)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [c, s] = await Promise.all([loadCatalog(), loadSettings()])
        setCatalog(c)
        setSettings(s)
      } catch {
        setCatalog(null)
      }
    })()
  }, [])

  const logout = (): void => {
    localStorage.removeItem(LS_TOKEN)
    localStorage.removeItem(LS_NAME)
    setToken('')
    setName('')
  }

  if (!catalog || !settings) {
    return <div className="flex min-h-full items-center justify-center p-6 text-sm font-bold text-brand-muted">Memuat menu...</div>
  }

  if (!token) {
    return (
      <PortalLogin
        storeName={settings.store.name}
        note={settings.portal.outlet_note}
        onLogin={(t, n) => {
          localStorage.setItem(LS_TOKEN, t)
          localStorage.setItem(LS_NAME, n)
          setToken(t)
          setName(n)
        }}
      />
    )
  }

  return <PortalMain token={token} name={name} catalog={catalog} settings={settings} now={now} onLogout={logout} />
}

// ================= Login / daftar =================

function PortalLogin({
  storeName,
  note,
  onLogin
}: {
  storeName: string
  note: string
  onLogin: (token: string, name: string) => void
}): ReactElement {
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const res =
        mode === 'daftar' ? await portal.register(phone.trim(), name.trim(), pin.trim()) : await portal.login(phone.trim(), pin.trim())
      onLogin(res.token, res.name)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-sm overflow-hidden">
        <div className="strip px-5 pb-5 pt-7 text-center">
          <p className="text-2xl font-extrabold text-white drop-shadow">{storeName}</p>
          <p className="mt-1 text-sm font-bold text-white/90">Pesan online, ambil atau diantar</p>
        </div>
        <form className="flex flex-col gap-3 p-5" onSubmit={submit}>
          {mode === 'daftar' && (
            <div>
              <label className="lbl" htmlFor="pn">
                Nama kamu
              </label>
              <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="lbl" htmlFor="pw">
              No. WhatsApp
            </label>
            <input id="pw" className="input" inputMode="tel" placeholder="08xxxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div>
            <label className="lbl" htmlFor="pp">
              PIN 6 angka {mode === 'daftar' ? '(buat sendiri, dipakai login berikutnya)' : ''}
            </label>
            <input
              id="pp"
              className="input text-center text-lg tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
          {err && (
            <p className="rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
              {err}
            </p>
          )}
          <button type="submit" className="btn-primary w-full !py-3" disabled={busy}>
            {busy ? 'Memeriksa...' : mode === 'daftar' ? 'Daftar & Mulai Pesan' : 'Masuk'}
          </button>
          <button
            type="button"
            className="text-sm font-bold text-brand-redtext underline"
            onClick={() => {
              setMode(mode === 'masuk' ? 'daftar' : 'masuk')
              setErr('')
            }}
          >
            {mode === 'masuk' ? 'Belum punya akun? Daftar di sini' : 'Sudah terdaftar? Masuk'}
          </button>
          <p className="text-center text-xs text-brand-muted">{note}</p>
        </form>
      </div>
    </div>
  )
}

// ================= Main =================

function PortalMain({
  token,
  name,
  catalog,
  settings,
  now,
  onLogout
}: {
  token: string
  name: string
  catalog: Catalog
  settings: Settings
  now: Date
  onLogout: () => void
}): ReactElement {
  const [screen, setScreen] = useState<Screen>('katalog')
  const [cart, setCart] = useState<{ product_id: number; qty: number }[]>([])
  const [avail, setAvail] = useState<Map<number, number>>(new Map())
  const [orders, setOrders] = useState<PortalOrder[]>([])
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [outlet, setOutlet] = useState<OutletSetting>({ lat: null, lng: null, max_radius_km: 8 })
  const [addresses, setAddresses] = useState<PortalAddress[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [a, o] = await Promise.all([portal.availability(), portal.orders(token)])
      setAvail(a)
      setOrders(o as PortalOrder[])
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [token])

  const refreshAddresses = useCallback(async () => {
    try {
      setAddresses(await portal.listAddresses(token))
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [token])

  useEffect(() => {
    void refresh()
    void refreshAddresses()
    void loadZones().then((z) => {
      setZones(z.zones)
      setOutlet(z.outlet)
    })
    const iv = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(iv)
  }, [refresh, refreshAddresses])

  const activeOrder = orders.find((o) => !['selesai', 'batal', 'ditolak'].includes(o.status))
  const catOf = (id: number): string => catalog.categories.find((c) => c.id === id)?.name ?? 'Lainnya'

  // Status antar = saklar manual DAN jadwal (kalau dipasang); dihitung ulang tiap menit lewat `now`.
  const schedule = normalizeSchedule(settings.portal.delivery_schedule ?? null)
  const schedInfo = schedule ? checkSchedule(schedule, now) : null
  const deliveryOn = deliveryActive(settings.portal, now)
  const schedNote = !deliveryOn && schedInfo
    ? !schedInfo.openToday
      ? `Hari ini libur antar${schedInfo.next ? ` — buka lagi ${DAY_LABELS[schedInfo.next.day]} ${schedInfo.next.range}` : ''}`
      : `Luar jam antar${schedInfo.range ? ` (${schedInfo.range})` : ''}${schedInfo.next ? ` — buka lagi ${DAY_LABELS[schedInfo.next.day]} ${schedInfo.next.range}` : ''}`
    : ''

  const add = (id: number): void => {
    const max = avail.get(id) ?? 0
    setCart((c) => {
      const cur = c.find((x) => x.product_id === id)
      if (cur) {
        if (cur.qty + 1 > max) return c
        return c.map((x) => (x.product_id === id ? { ...x, qty: x.qty + 1 } : x))
      }
      if (max < 1) return c
      return [...c, { product_id: id, qty: 1 }]
    })
  }
  const setQty = (id: number, qty: number): void =>
    setCart((c) => c.map((x) => (x.product_id === id ? { ...x, qty } : x)).filter((x) => x.qty > 0))

  const prodOf = (id: number) => catalog.products.find((p) => p.id === id)
  const subtotal = cart.reduce((s, l) => s + (prodOf(l.product_id)?.price ?? 0) * l.qty, 0)
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)

  const byCat = useMemo(() => {
    const m = new Map<number, typeof catalog.products>()
    for (const p of catalog.products.filter((x) => x.is_active)) {
      const arr = m.get(p.category_id ?? 0) ?? []
      arr.push(p)
      m.set(p.category_id ?? 0, arr)
    }
    return [...m.entries()].sort((a, b) => (a[0] || 99) - (b[0] || 99))
  }, [catalog])

  const submitOrder = async (addressId: number, note: string): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      await portal.createOrder(token, cart, addressId, note)
      setCart([])
      setScreen('pesanan')
      await refresh()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="strip sticky top-0 z-20 flex items-center gap-2 border-b-[1.5px] border-brand-line bg-brand-card px-4 py-3">
        <div className="mr-auto">
          <p className="text-base font-extrabold leading-tight">{settings.store.name}</p>
          <p className="text-xs font-bold text-brand-muted">Halo, {name}</p>
        </div>
        <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1.5 text-xs" onClick={onLogout}>
          Keluar
        </button>
      </header>

      {err && (
        <p className="mx-4 mt-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {activeOrder && screen === 'katalog' && (
        <OrderStatusCard order={activeOrder} settings={settings} token={token} refresh={refresh} setErr={setErr} />
      )}

      {!deliveryOn && screen === 'katalog' && (
        <p className="mx-4 mt-3 rounded-lg bg-brand-gold/25 px-3 py-2.5 text-sm font-bold" role="status">
          {schedNote
            ? `Layanan antar sedang libur — ${schedNote}.`
            : 'Layanan antar sedang libur. Semua pesanan diambil langsung di outlet.'}
        </p>
      )}

      <main className="min-h-0 flex-1 p-3 pb-28">
        {screen === 'katalog' &&
          byCat.map(([cid, prods]) => (
            <section key={cid} className="mb-4">
              <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-brand-redtext">{catOf(cid)}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {prods.map((p) => {
                  const max = avail.get(p.id) ?? 0
                  const inCart = cart.find((x) => x.product_id === p.id)?.qty ?? 0
                  return (
                    <div key={p.id} className={`card overflow-hidden p-2.5 ${max <= 0 ? 'opacity-50' : ''}`}>
                      {p.photo && <img src={p.photo} alt="" className="mb-1.5 -mx-2.5 -mt-2.5 h-24 w-[calc(100%+20px)] object-cover" loading="lazy" />}
                      <p className="text-sm font-bold leading-snug">{p.name}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-sm font-extrabold">{fmtRp(p.price)}</span>
                        {max <= 0 ? (
                          <span className="chip bg-brand-redtext text-white text-[10px]">Habis</span>
                        ) : inCart > 0 ? (
                          <span className="chip bg-brand-gold text-[10px]">{inCart} di tas</span>
                        ) : (
                          <button type="button" className="btn-primary !min-h-0 !px-2 !py-1 text-xs" onClick={() => add(p.id)}>
                            + Tambah
                          </button>
                        )}
                      </div>
                      {max > 0 && max <= 3 && <p className="mt-1 text-[10px] font-bold text-brand-redtext">sisa {fmtQty(max)} porsi</p>}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

        {screen === 'checkout' && (
          <CheckoutScreen
            cart={cart}
            catalog={catalog}
            addresses={addresses}
            zones={zones}
            outlet={outlet}
            deliveryOn={deliveryOn}
            busy={busy}
            setQty={setQty}
            onSaveAddress={async (id, label, addr, lat, lng) => {
              const newId = await portal.saveAddress(token, id, label, addr, lat, lng)
              await refreshAddresses()
              return newId
            }}
            onDeleteAddress={async (id) => {
              await portal.deleteAddress(token, id)
              await refreshAddresses()
            }}
            onBack={() => setScreen('katalog')}
            onSubmit={submitOrder}
            setErr={setErr}
          />
        )}

        {screen === 'pesanan' && (
          <div>
            {orders.length === 0 && <p className="py-10 text-center text-sm text-brand-muted">Belum ada pesanan. Yuk pesan dulu.</p>}
            {[...orders].reverse().map((o) => (
              <OrderStatusCard key={o.id} order={o} settings={settings} token={token} refresh={refresh} setErr={setErr} />
            ))}
          </div>
        )}

        {screen === 'akun' && <AccountScreen token={token} settings={settings} setErr={setErr} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-2xl items-center border-t-[1.5px] border-brand-line bg-brand-card px-2" aria-label="Navigasi portal">
        {(
          [
            ['katalog', 'Menu'],
            ['pesanan', 'Pesanan'],
            ['akun', 'Akun']
          ] as [Screen, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`flex-1 py-3 text-sm font-bold ${screen === k ? 'text-brand-redtext' : 'text-brand-muted'}`}
            onClick={() => setScreen(k)}
          >
            {label}
            {k === 'pesanan' && activeOrder ? ' ●' : ''}
          </button>
        ))}
      </nav>

      {cartCount > 0 && screen === 'katalog' && (
        <div className="fixed inset-x-0 bottom-16 z-20 mx-auto max-w-2xl px-3">
          <button type="button" className="btn-primary w-full !py-3 shadow-lg" onClick={() => setScreen('checkout')}>
            Checkout ({cartCount} item) · {fmtRp(subtotal)}
          </button>
        </div>
      )}
    </div>
  )
}

// ================= Checkout =================

function CheckoutScreen({
  cart,
  catalog,
  addresses,
  zones,
  outlet,
  deliveryOn,
  busy,
  setQty,
  onSaveAddress,
  onDeleteAddress,
  onBack,
  onSubmit,
  setErr
}: {
  cart: { product_id: number; qty: number }[]
  catalog: Catalog
  addresses: PortalAddress[]
  zones: DeliveryZone[]
  outlet: OutletSetting
  /** Status antar gabungan (saklar + jadwal) sudah dihitung di PortalMain. */
  deliveryOn: boolean
  busy: boolean
  setQty: (id: number, qty: number) => void
  onSaveAddress: (id: number | null, label: string, addr: string, lat: number | null, lng: number | null) => Promise<number>
  onDeleteAddress: (id: number) => Promise<void>
  onBack: () => void
  onSubmit: (addressId: number, note: string) => Promise<void>
  setErr: (s: string) => void
}): ReactElement {
  const [selected, setSelected] = useState<number | null>(
    () => addresses.find((a) => deliveryOn || a.label === 'Ambil Sendiri')?.id ?? null
  )
  const [note, setNote] = useState('')
  const [addOpen, setAddOpen] = useState(addresses.length === 0)
  const [editId, setEditId] = useState<number | null>(null)
  const [label, setLabel] = useState('Rumah')
  const [addr, setAddr] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)

  const prodOf = (id: number) => catalog.products.find((p) => p.id === id)
  const subtotal = cart.reduce((s, l) => s + (prodOf(l.product_id)?.price ?? 0) * l.qty, 0)
  // Saat layanan antar libur (manual atau jadwal), alamat kirim tidak bisa dipilih: hanya Ambil Sendiri.
  const pickable = addresses.filter((a) => deliveryOn || a.label === 'Ambil Sendiri')
  const addrObj = pickable.find((a) => a.id === selected)

  // Estimasi ongkir client-side (final dihitung server saat submit)
  const estFee = useMemo(() => {
    if (!addrObj) return null
    if (addrObj.label === 'Ambil Sendiri') return 0
    if (addrObj.lat !== null && addrObj.lng !== null && outlet.lat !== null && outlet.lng !== null) {
      const km = haversineKm(outlet.lat, outlet.lng, addrObj.lat, addrObj.lng)
      return feeForDistance(km, zones)
    }
    return null
  }, [addrObj, outlet, zones])

  const maxKm = maxRadius(zones)

  // Auto-pilih: saat delivery off ambil Ambil Sendiri; saat on pilih alamat pertama
  // kalau yang terpilih tidak bisa dipakai (mis. dibuka saat toggle masih off).
  useEffect(() => {
    if (deliveryOn) {
      if (selected === null || !pickable.some((a) => a.id === selected)) setSelected(addresses[0]?.id ?? null)
    } else {
      const self = pickable.find((a) => a.label === 'Ambil Sendiri')
      if (self && selected !== self.id) setSelected(self.id)
    }
  }, [deliveryOn, addresses, selected, pickable])

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1.5 text-xs" onClick={onBack}>
          ← Menu
        </button>
        <h2 className="text-base font-extrabold">Checkout</h2>
      </div>

      {/* Item */}
      <div className="card mb-3 p-3">
        <h3 className="mb-2 text-sm font-extrabold">Pesanan</h3>
        {cart.map((l) => {
          const p = prodOf(l.product_id)
          if (!p) return null
          return (
            <div key={l.product_id} className="mb-2 flex items-center gap-2">
              <span className="flex-1 text-sm font-bold">{p.name}</span>
              <button type="button" className="btn-ghost !min-h-0 !h-8 !w-8 !px-0" onClick={() => setQty(l.product_id, l.qty - 1)} aria-label={`Kurangi ${p.name}`}>
                −
              </button>
              <span className="w-6 text-center text-sm font-extrabold tabular-nums">{l.qty}</span>
              <button type="button" className="btn-ghost !min-h-0 !h-8 !w-8 !px-0" onClick={() => setQty(l.product_id, l.qty + 1)} aria-label={`Tambah ${p.name}`}>
                +
              </button>
              <span className="w-20 text-right text-sm font-bold tabular-nums">{fmtRp(p.price * l.qty)}</span>
            </div>
          )
        })}
        <div className="flex justify-between border-t border-brand-line pt-2 text-sm font-bold">
          <span>Subtotal</span>
          <span className="tabular-nums">{fmtRp(subtotal)}</span>
        </div>
      </div>

      {/* Alamat: saat delivery off, hanya Ambil Sendiri */}
      {!deliveryOn && (
        <div className="card mb-3 p-3">
          <div className="flex items-start gap-2">
            <span className="chip bg-brand-gold text-xs font-extrabold">Ambil Sendiri</span>
            <p className="text-sm font-bold">Layanan antar sedang libur. Pesananmu diambil langsung di outlet, tanpa ongkir.</p>
          </div>
          {!addresses.some((a) => a.label === 'Ambil Sendiri') && (
            <button
              type="button"
              className="btn-ghost mt-2 !min-h-0 !py-2 text-xs"
              onClick={async () => {
                try {
                  const id = await onSaveAddress(null, 'Ambil Sendiri', 'Ambil di outlet', null, null)
                  setSelected(id)
                } catch (ex) {
                  setErr((ex as Error).message)
                }
              }}
            >
              Pakai Ambil Sendiri untuk pesanan ini
            </button>
          )}
        </div>
      )}
      {deliveryOn && (
      <div className="card mb-3 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-extrabold">Alamat kirim</h3>
          <button
            type="button"
            className="btn-ghost !min-h-0 !px-2 !py-1 text-xs"
            onClick={() => {
              setEditId(null)
              setLabel('Rumah')
              setAddr('')
              setLat(null)
              setLng(null)
              setAddOpen(true)
            }}
          >
            + Alamat Baru
          </button>
        </div>
        {addresses.length === 0 && <p className="text-sm text-brand-muted">Belum ada alamat. Tambahkan dulu, atau pilih Ambil Sendiri.</p>}
        {addresses.map((a) => {
          const km =
            a.lat !== null && a.lng !== null && outlet.lat !== null && outlet.lng !== null
              ? haversineKm(outlet.lat, outlet.lng, a.lat, a.lng)
              : null
          const fee = a.label === 'Ambil Sendiri' ? 0 : km !== null ? feeForDistance(km, zones) : null
          return (
            <label
              key={a.id}
              className={`mb-2 block cursor-pointer rounded-lg border-[1.5px] p-2.5 ${selected === a.id ? 'border-brand-btn' : 'border-brand-line'}`}
            >
              <span className="flex items-start gap-2">
                <input type="radio" name="addr" checked={selected === a.id} onChange={() => setSelected(a.id)} aria-label={a.label} />
                <span className="flex-1">
                  <span className="block text-sm font-extrabold">{a.label}</span>
                  {a.label !== 'Ambil Sendiri' && <span className="block text-xs text-brand-muted">{a.address}</span>}
                  {a.label !== 'Ambil Sendiri' && km !== null && (
                    <span className={`block text-xs font-bold ${fee === null ? 'text-brand-redtext' : 'text-brand-muted'}`}>
                      {km.toFixed(1)} km dari outlet{fee !== null ? ` · ongkir ${fmtRp(fee)}` : ` · di luar radius (maks ${maxKm} km)`}
                    </span>
                  )}
                  {a.label === 'Ambil Sendiri' && <span className="block text-xs text-brand-muted">Ambil di outlet, tanpa ongkir</span>}
                </span>
                <span className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="text-xs font-bold text-brand-redtext underline"
                    onClick={(e) => {
                      e.preventDefault()
                      setEditId(a.id)
                      setLabel(a.label)
                      setAddr(a.address)
                      setLat(a.lat)
                      setLng(a.lng)
                      setAddOpen(true)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs font-bold text-brand-muted underline"
                    onClick={async (e) => {
                      e.preventDefault()
                      try {
                        await onDeleteAddress(a.id)
                        if (selected === a.id) setSelected(null)
                      } catch (ex) {
                        setErr((ex as Error).message)
                      }
                    }}
                  >
                    Hapus
                  </button>
                </span>
              </span>
            </label>
          )
        })}

        {/* Form alamat */}
        {addOpen && (
          <div className="mt-2 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3">
            <label className="lbl" htmlFor="clabel">
              Label
            </label>
            <select id="clabel" className="input mb-2" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option>Rumah</option>
              <option>Kantor</option>
              <option>Kos</option>
              <option>Ambil Sendiri</option>
            </select>
            {label !== 'Ambil Sendiri' && (
              <>
                <label className="lbl" htmlFor="caddr">
                  Alamat lengkap
                </label>
                <textarea id="caddr" className="input !h-20 mb-2" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Nama jalan, nomor rumah, patokan" />
                <p className="lbl">Titik lokasi di peta</p>
                <MapPicker lat={lat} lng={lng} outlet={{ lat: outlet.lat, lng: outlet.lng }} onChange={(la, ln) => { setLat(la); setLng(ln) }} />
                <p className="mt-1 text-xs font-bold text-brand-muted">
                  {lat !== null && outlet.lat !== null
                    ? `Jarak dari outlet: ${haversineKm(outlet.lat, outlet.lng!, lat, lng!).toFixed(1)} km`
                    : 'Ketuk peta untuk menandai lokasi rumahmu'}
                </p>
              </>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={label !== 'Ambil Sendiri' && (addr.trim() === '' || lat === null)}
                onClick={async () => {
                  try {
                    const id = await onSaveAddress(editId, label, label === 'Ambil Sendiri' ? 'Ambil di outlet' : addr, lat, lng)
                    setSelected(id)
                    setAddOpen(false)
                  } catch (ex) {
                    setErr((ex as Error).message)
                  }
                }}
              >
                Simpan Alamat
              </button>
              <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Catatan & ringkasan */}
      <div className="card strip mb-3 p-3">
        <label className="lbl" htmlFor="cnote">
          Catatan untuk kasir
        </label>
        <input id="cnote" className="input mb-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="contoh: geprek jangan terlalu pedas" />
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span className="tabular-nums">{fmtRp(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Ongkir</span>
          <span className="tabular-nums">
            {addrObj === undefined ? '-' : estFee === null ? 'di luar radius' : fmtRp(estFee)}
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t border-brand-line pt-1 text-lg font-extrabold">
          <span>Total</span>
          <span className="tabular-nums">{fmtRp(subtotal + (estFee ?? 0))}</span>
        </div>
        <button
          type="button"
          className="btn-primary mt-3 w-full !py-3"
          disabled={selected === null || busy || (estFee === null && addrObj?.label !== 'Ambil Sendiri')}
          onClick={() => selected !== null && void onSubmit(selected, note)}
        >
          {busy ? 'Mengirim...' : 'Kirim Pesanan ke Kasir'}
        </button>
        <p className="mt-2 text-center text-xs text-brand-muted">
          Pesananmu divalidasi kasir dulu. Setelah diterima, kamu diminta bayar via QRIS di halaman ini.
        </p>
      </div>
    </div>
  )
}

// ================= Status card =================

function OrderStatusCard({
  order,
  settings,
  token,
  refresh,
  setErr
}: {
  order: PortalOrder
  settings: Settings
  token: string
  refresh: () => Promise<void>
  setErr: (s: string) => void
}): ReactElement {
  const view = STATUS_VIEW[order.status] ?? { label: order.status, hint: '' }
  return (
    <div className={`card mx-0 mt-3 p-4 ${order.status === 'menunggu' ? 'border-brand-gold' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-extrabold">
            Pesanan #{order.id} · {view.label}
          </p>
          <p className="text-xs text-brand-muted">{view.hint}</p>
        </div>
        <p className="whitespace-nowrap text-lg font-extrabold">{fmtRp(order.total)}</p>
      </div>
      <ul className="mt-2 border-y border-brand-line py-2 text-sm">
        {order.items.map((it, i) => (
          <li key={i} className="flex justify-between">
            <span>
              {it.qty}× {it.name}
            </span>
            <span className="tabular-nums">{fmtRp(it.qty * it.price)}</span>
          </li>
        ))}
        <li className="flex justify-between text-brand-muted">
          <span>Ongkir</span>
          <span className="tabular-nums">{fmtRp(order.delivery_fee)}</span>
        </li>
      </ul>

      {order.status === 'qris_dikirim' && (
        <div className="mt-3 text-center">
          {settings.qris.image ? (
            <img src={settings.qris.image} alt="Kode QRIS pembayaran" className="mx-auto max-w-[240px] rounded-lg border-[1.5px] border-brand-line" />
          ) : (
            <p className="rounded-lg bg-brand-gold/20 p-3 text-sm font-bold">QRIS belum dipasang outlet. Hubungi kasir untuk bayar tunai/transfer.</p>
          )}
          <p className="mt-2 text-sm font-bold">
            Bayar TEPAT <span className="text-brand-redtext">{fmtRp(order.total)}</span>
          </p>
          <button
            type="button"
            className="btn-primary mt-2 w-full"
            onClick={async () => {
              try {
                await portal.confirmPaid(token, order.id)
                await refresh()
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          >
            Sudah Bayar, Konfirmasi ke Kasir
          </button>
        </div>
      )}

      {order.reject_reason && <p className="mt-2 rounded-lg bg-brand-redtext/10 p-2 text-sm font-bold text-brand-redtext">Ditolak: {order.reject_reason}</p>}

      {['menunggu', 'qris_dikirim'].includes(order.status) && (
        <button
          type="button"
          className="btn-danger mt-3 !min-h-0 w-full !py-2 text-xs"
          onClick={async () => {
            try {
              await portal.cancelOrder(token, order.id)
              await refresh()
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        >
          Batalkan Pesanan
        </button>
      )}
    </div>
  )
}

// ================= Akun =================

function AccountScreen({ token, settings, setErr }: { token: string; settings: Settings; setErr: (s: string) => void }): ReactElement {
  const { toast } = useToast()
  const [prof, setProf] = useState<{ phone: string; name: string; address: string; label: string } | null>(null)
  const [pinOld, setPinOld] = useState('')
  const [pinNew, setPinNew] = useState('')

  useEffect(() => {
    void portal
      .profile(token)
      .then(setProf)
      .catch((ex) => setErr((ex as Error).message))
  }, [token])

  if (!prof) return <p className="py-8 text-center text-sm text-brand-muted">Memuat profil...</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-4">
        <h2 className="mb-2 font-extrabold">Profil & Alamat</h2>
        <label className="lbl" htmlFor="aname">
          Nama
        </label>
        <input id="aname" className="input mb-2" value={prof.name} onChange={(e) => setProf({ ...prof, name: e.target.value })} />
        <label className="lbl" htmlFor="aaddr">
          Alamat pengiriman (utama)
        </label>
        <textarea id="aaddr" className="input !h-20" value={prof.address} onChange={(e) => setProf({ ...prof, address: e.target.value })} placeholder="Nama jalan, nomor, patokan" />
        <button
          type="button"
          className="btn-primary mt-2"
          onClick={async () => {
            try {
              await portal.updateProfile(token, prof.name, prof.address)
              toast('Profil tersimpan.')
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        >
          Simpan Profil
        </button>
      </div>
      <div className="card p-4">
        <h2 className="mb-2 font-extrabold">Ganti PIN</h2>
        <label className="lbl" htmlFor="po">
          PIN lama
        </label>
        <input id="po" className="input mb-2 text-center tracking-[0.4em]" inputMode="numeric" maxLength={6} value={pinOld} onChange={(e) => setPinOld(e.target.value.replace(/\D/g, ''))} />
        <label className="lbl" htmlFor="pn2">
          PIN baru (6 angka)
        </label>
        <input id="pn2" className="input text-center tracking-[0.4em]" inputMode="numeric" maxLength={6} value={pinNew} onChange={(e) => setPinNew(e.target.value.replace(/\D/g, ''))} />
        <button
          type="button"
          className="btn-primary mt-2"
          onClick={async () => {
            try {
              await portal.changePin(token, pinOld, pinNew)
              setPinOld('')
              setPinNew('')
              toast('PIN diganti.')
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        >
          Ganti PIN
        </button>
      </div>
      <p className="px-1 text-xs text-brand-muted">{settings.portal.outlet_note}</p>
    </div>
  )
}
