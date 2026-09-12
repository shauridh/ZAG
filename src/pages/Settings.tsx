import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { loadSettings, saveSetting, loadZones, saveZones, resetDemoData, isDemo } from '../lib/db'
import { fmtRpPlain, parseNum } from '../lib/money'
import { normalizeSchedule, DAY_LABELS, DAY_ORDER, type DeliveryWeek } from '../lib/delivery-schedule'
import type { Settings } from '../lib/types'
import { MapPicker } from '../components/MapPicker'
import { useToast } from '../components/Toast'
import { bluetoothAvailable, getSavedPrinter, forgetPrinter, pickAndSavePrinter, printTextBluetooth, canReconnectSaved, diagnosePrinter, type SavedPrinter, type DiagStep } from '../lib/bluetooth-printer'

type Tab = 'toko' | 'struk' | 'printer' | 'qris' | 'outlet' | 'tablet' | 'biaya'

export default function SettingsPage(): ReactElement {
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('toko')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [zones, setZones] = useState<{ radius_km: number; fee: number }[]>([])
  const [outlet, setOutlet] = useState<{ lat: number | null; lng: number | null; max_radius_km: number }>({ lat: null, lng: null, max_radius_km: 8 })
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    try {
      const [s, z] = await Promise.all([loadSettings(), loadZones()])
      setSettings(s)
      setZones(z.zones.map((x) => ({ radius_km: x.radius_km, fee: x.fee })))
      setOutlet({ lat: z.outlet.lat, lng: z.outlet.lng, max_radius_km: z.outlet.max_radius_km })
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!settings) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  const upd = async (key: keyof Settings, value: unknown): Promise<void> => {
    try {
      await saveSetting(key, value)
      setSettings({ ...settings, [key]: value } as Settings)
      toast('Tersimpan.')
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  return (
    <div className="p-3 lg:p-4">
      <h1 className="mb-3 text-xl font-extrabold">Pengaturan</h1>
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {/* Nav topik di kiri + satu panel di kanan: semua form tidak lagi menumpuk ke bawah */}
      <div className="grid gap-3 lg:grid-cols-[190px_1fr]">
        <nav className="card h-fit gap-1 p-2 max-lg:grid max-lg:grid-cols-2" aria-label="Topik pengaturan">
          {(
            [
              ['toko', '🏪 Toko & Operasional'],
              ['struk', '🧾 Template Struk'],
              ['printer', '🖨️ Printer'],
              ['qris', '📲 Halaman QRIS'],
              ['outlet', '🛍️ Outlet & Ongkir'],
              ['tablet', '📱 Tablet & Layar'],
              ['biaya', '🏷️ Beban Tetap']
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-current={tab === k ? 'true' : undefined}
              className={`rounded-lg px-3 py-2.5 text-left text-sm font-bold ${tab === k ? 'bg-brand-btn text-white' : 'text-brand-ink hover:bg-brand-paper'}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {tab === 'toko' && (
            <div className="grid max-w-3xl gap-3 lg:grid-cols-2">
              <div className="card p-4">
                <h2 className="mb-2 font-extrabold">Identitas toko</h2>
                <StoreForm settings={settings} onSave={(v) => void upd('store', v)} />
              </div>
              <div className="card p-4">
                <h2 className="mb-2 font-extrabold">Operasional</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="lbl" htmlFor="float">
                  Float kembalian wajib per shift (Rp)
                </label>
                <input
                  id="float"
                  className="input text-right"
                  inputMode="numeric"
                  defaultValue={fmtRpPlain(settings.shift.float_cash)}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0
                    if (v !== settings.shift.float_cash) void upd('shift', { ...settings.shift, float_cash: v })
                  }}
                />
                <p className="mt-1 text-xs text-brand-muted">Kasir tidak bisa buka shift di bawah nilai ini, dan drawer wajib menyisakan minimal nilai ini saat tutup shift.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="lbl" htmlFor="odays">
                    Umur minyak maksimal (hari)
                  </label>
                  <input
                    id="odays"
                    className="input text-right"
                    inputMode="numeric"
                    defaultValue={String(settings.oil.max_days)}
                    onBlur={(e) => void upd('oil', { ...settings.oil, max_days: parseInt(e.target.value.replace(/\D/g, ''), 10) || 3 })}
                  />
                </div>
                <div>
                  <label className="lbl" htmlFor="ofry">
                    Maks goreng per siklus (x)
                  </label>
                  <input
                    id="ofry"
                    className="input text-right"
                    inputMode="numeric"
                    defaultValue={String(settings.oil.max_fry_count)}
                    onBlur={(e) => void upd('oil', { ...settings.oil, max_fry_count: parseInt(e.target.value.replace(/\D/g, ''), 10) || 60 })}
                  />
                </div>
              </div>
              <div>
                <label className="lbl" htmlFor="warn">
                  Peringatan margin di bawah (%)
                </label>
                <input
                  id="warn"
                  className="input text-right"
                  inputMode="numeric"
                  defaultValue={String(settings.margin.warn_pct)}
                  onBlur={(e) => void upd('margin', { warn_pct: parseInt(e.target.value.replace(/\D/g, ''), 10) || 15 })}
                />
              </div>
              <div>
                <label className="lbl" htmlFor="chf">
                  Komisi channel online (%)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['gofood', 'grabfood', 'shopeefood'] as const).map((k) => (
                    <div key={k}>
                      <label className="block text-center text-xs font-bold capitalize" htmlFor={`fee-${k}`}>
                        {k}
                      </label>
                      <input
                        id={`fee-${k}`}
                        className="input text-right"
                        inputMode="numeric"
                        defaultValue={String(settings.channels[k].fee)}
                        onBlur={(e) => void upd('channels', { ...settings.channels, [k]: { fee: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="lbl" htmlFor="oemail">
                  Email pemilik (laporan tutup shift)
                </label>
                <input
                  id="oemail"
                  className="input"
                  type="email"
                  defaultValue={settings.owner_email.email}
                  onBlur={(e) => void upd('owner_email', { email: e.target.value.trim(), whatsapp: settings.owner_email.whatsapp })}
                />
                <p className="mt-1 text-xs text-brand-muted">Laporan tutup shift dikirim otomatis ke email ini (butuh Edge Function + Gmail App Password, lihat README).</p>
              </div>
              <div>
                <label className="lbl" htmlFor="owa">
                  WhatsApp pemilik (laporan tutup shift)
                </label>
                <input
                  id="owa"
                  className="input"
                  inputMode="tel"
                  defaultValue={settings.owner_email.whatsapp ?? ''}
                  onBlur={(e) => void upd('owner_email', { email: settings.owner_email.email, whatsapp: e.target.value.trim() })}
                  placeholder="62812xxxxxxx"
                />
                <p className="mt-1 text-xs text-brand-muted">Format internasional tanpa + (contoh 6281234567890). Saat shift ditutup, WhatsApp terbuka dengan laporan terisi tinggal kirim.</p>
              </div>
            </div>
            {isDemo && (
              <button
                type="button"
                className="btn-danger mt-4"
                onClick={() => {
                  if (window.confirm('Hapus semua data demo dan mulai dari awal?')) {
                    resetDemoData()
                    window.location.reload()
                  }
                }}
              >
                Reset Data Demo
              </button>
            )}
          </div>
          </div>
      )}

      {tab === 'tablet' && (
        <div className="card max-w-xl p-4">
          <h2 className="mb-2 font-extrabold">Tablet & Layar</h2>
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3">
              <Switch
                checked={settings.tablet?.keep_awake ?? true}
                onChange={(v) =>
                  void upd('tablet', { ...(settings.tablet ?? { keep_awake: true, fullscreen: false }), keep_awake: v })
                }
                label="Layar tetap menyala (wake lock)"
              />
              <span>
                <span className="block text-sm font-extrabold">Layar tetap menyala (wake lock)</span>
                <span className="block text-xs text-brand-muted">
                  Cegah layar tablet mati saat jam jualan. Bisa juga diaktifkan kapan saja dari tombol ☀ di bilah atas.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <Switch
                checked={settings.tablet?.fullscreen ?? false}
                onChange={(v) =>
                  void upd('tablet', { ...(settings.tablet ?? { keep_awake: true, fullscreen: false }), fullscreen: v })
                }
                label="Mode layar penuh"
              />
              <span>
                <span className="block text-sm font-extrabold">Mode layar penuh</span>
                <span className="block text-xs text-brand-muted">
                  Sembunyikan bilah browser agar kasir fokus. Browser mewajibkan satu ketukan pengguna — banner konfirmasi akan muncul setelah login.
                </span>
              </span>
            </label>
            <div>
              <span className="lbl">Ukuran kartu menu kasir</span>
              <div className="flex gap-2" role="radiogroup" aria-label="Ukuran kartu menu kasir">
                {([
                  { v: 'normal', label: 'Normal', desc: 'Kompak, lebih banyak menu terlihat' },
                  { v: 'besar', label: 'Besar', desc: 'Foto dominan, mudah dipindai' }
                ] as const).map((o) => {
                  const aktif = (settings.tablet?.card_size ?? 'besar') === o.v
                  return (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={aktif}
                      onClick={() => void upd('tablet', { ...(settings.tablet ?? { keep_awake: true, fullscreen: false }), card_size: o.v })}
                      className={`flex-1 rounded-lg border-[1.5px] p-3 text-left ${aktif ? 'border-brand-btn bg-brand-btn text-white' : 'border-brand-line bg-white hover:bg-brand-paper'}`}
                    >
                      <span className="block text-sm font-extrabold">{o.label}</span>
                      <span className={`block text-xs ${aktif ? 'text-white/85' : 'text-brand-muted'}`}>{o.desc}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-brand-muted">Langsung berlaku di halaman Kasir di semua perangkat yang memakai setting ini.</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'struk' && <ReceiptForm settings={settings} onSave={(v) => void upd('receipt', v)} />}

      {tab === 'printer' && (
        <PrinterTab
          autoPrint={settings.printer.auto_print}
          onAutoPrint={(v) => void upd('printer', { auto_print: v })}
          mode={settings.printer.mode ?? 'bt'}
          onMode={(m) => void upd('printer', { mode: m })}
          setErr={setErr}
        />
      )}

      {tab === 'qris' && (
        <div className="card max-w-xl p-4">
          <h2 className="mb-2 font-extrabold">Halaman QRIS</h2>
          <p className="mb-2 text-sm text-brand-muted">Unggah foto QRIS statis dari aplikasi bank/e-wallet. Customer portal akan menampilkan ini saat kasir mengirim tagihan.</p>
          <input
            type="file"
            accept="image/*"
            className="text-sm"
            aria-label="Unggah gambar QRIS"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => void upd('qris', { image: String(reader.result) })
              reader.readAsDataURL(file)
            }}
          />
          {settings.qris.image && (
            <div className="mt-3">
              <img src={settings.qris.image} alt="QRIS tersimpan" className="max-w-[220px] rounded-lg border-[1.5px] border-brand-line" />
              <button type="button" className="btn-danger mt-2" onClick={() => void upd('qris', { image: '' })}>
                Hapus Gambar
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'outlet' && (
        <div className="grid max-w-4xl gap-3 lg:grid-cols-2">
          <div className="card p-4">
            <h2 className="mb-2 font-extrabold">Layanan pesan antar</h2>
            <label className="flex items-start gap-3">
              <Switch
                checked={settings.portal?.delivery_enabled ?? true}
                onChange={(v) => void upd('portal', { ...settings.portal, delivery_enabled: v })}
                label="Terima pesanan diantar"
              />
              <span>
                <span className="block text-sm font-extrabold">Terima pesanan diantar</span>
                <span className="block text-xs text-brand-muted">
                  Matikan saat tutup, hujan, atau kurir habis: customer hanya bisa "Ambil Sendiri" di portal. Pesanan yang sudah masuk tetap bisa diproses.
                </span>
              </span>
            </label>
            <ScheduleEditor
              value={settings.portal.delivery_schedule ?? null}
              onChange={(v) => void upd('portal', { ...settings.portal, delivery_schedule: v })}
            />
          </div>
          <div className="card p-4">
            <h2 className="mb-2 font-extrabold">Titik outlet</h2>
            <MapPicker lat={outlet.lat} lng={outlet.lng} outlet={{ lat: outlet.lat, lng: outlet.lng }} onChange={(lat, lng) => setOutlet({ ...outlet, lat, lng })} />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => setOutlet({ ...outlet, lat: p.coords.latitude, lng: p.coords.longitude }),
                    () => setErr('Izin lokasi ditolak perangkat')
                  )
                }
              >
                Pakai Lokasi GPS Saya
              </button>
              <span className="text-xs tabular-nums text-brand-muted">
                {outlet.lat ? `${outlet.lat.toFixed(5)}, ${outlet.lng?.toFixed(5)}` : 'belum ada titik'}
              </span>
            </div>
            <div className="mt-2">
              <label className="lbl" htmlFor="maxr">
                Radius kirim maksimal (km)
              </label>
              <input
                id="maxr"
                className="input !w-32 text-right"
                inputMode="decimal"
                defaultValue={String(outlet.max_radius_km)}
                onBlur={(e) => setOutlet({ ...outlet, max_radius_km: parseNum(e.target.value) || 8 })}
              />
            </div>
          </div>
          <div className="card p-4">
            <h2 className="mb-2 font-extrabold">Zona ongkir per radius</h2>
            <p className="mb-2 text-sm text-brand-muted">Ongkir dipakai dari zona terkecil yang jangkauannya melebihi jarak customer.</p>
            {zones.map((z, i) => (
              <div key={i} className="mb-2 grid grid-cols-[110px_130px_32px] items-center gap-2">
                <div>
                  <label className="lbl" htmlFor={`zr${i}`}>
                    ≤ radius (km)
                  </label>
                  <input
                    id={`zr${i}`}
                    className="input !h-10 text-right"
                    inputMode="decimal"
                    value={String(z.radius_km)}
                    onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, radius_km: parseNum(e.target.value) } : x)))}
                  />
                </div>
                <div>
                  <label className="lbl" htmlFor={`zf${i}`}>
                    Ongkir (Rp)
                  </label>
                  <input
                    id={`zf${i}`}
                    className="input !h-10 text-right"
                    inputMode="numeric"
                    value={z.fee ? fmtRpPlain(z.fee) : ''}
                    onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, fee: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 } : x)))}
                  />
                </div>
                <button type="button" className="mt-4 font-extrabold text-brand-redtext" onClick={() => setZones(zones.filter((_, j) => j !== i))} aria-label="Hapus zona">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => setZones([...zones, { radius_km: 1, fee: 5000 }])}>
              + Zona
            </button>
            <button
              type="button"
              className="btn-primary mt-3 w-full"
              onClick={async () => {
                try {
                  await saveZones(zones.filter((z) => z.radius_km > 0), outlet)
                  toast('Pengaturan ongkir tersimpan.')
                } catch (ex) {
                  setErr((ex as Error).message)
                }
              }}
            >
              Simpan Outlet & Zona
            </button>
          </div>
        </div>
      )}

      {tab === 'biaya' && (
        <div className="card max-w-lg p-4">
          <h2 className="mb-2 font-extrabold">Beban tetap bulanan</h2>
          <p className="mb-2 text-sm text-brand-muted">Dipakai di Keuangan & Laporan untuk menghitung laba bersih.</p>
          {settings.fixed_costs.map((f, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_130px_32px] gap-2">
              <input
                className="input !h-10"
                value={f.name}
                onChange={(e) => {
                  const arr = [...settings.fixed_costs]
                  arr[i] = { ...f, name: e.target.value }
                  setSettings({ ...settings, fixed_costs: arr })
                }}
                aria-label="Nama beban"
              />
              <input
                className="input !h-10 text-right"
                inputMode="numeric"
                value={f.amount ? fmtRpPlain(f.amount) : ''}
                onChange={(e) => {
                  const arr = [...settings.fixed_costs]
                  arr[i] = { ...f, amount: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 }
                  setSettings({ ...settings, fixed_costs: arr })
                }}
                aria-label="Nominal"
              />
              <button
                type="button"
                className="mt-1 font-extrabold text-brand-redtext"
                onClick={() => setSettings({ ...settings, fixed_costs: settings.fixed_costs.filter((_, j) => j !== i) })}
                aria-label="Hapus beban"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost !min-h-0 !py-1.5 text-xs"
            onClick={() => setSettings({ ...settings, fixed_costs: [...settings.fixed_costs, { name: '', amount: 0 }] })}
          >
            + Beban
          </button>
          <button type="button" className="btn-primary mt-3 w-full" onClick={() => void upd('fixed_costs', settings.fixed_costs.filter((f) => f.name && f.amount > 0))}>
            Simpan Beban Tetap
          </button>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

/** Saklar on/off visual: status terbaca sekilas, bukan checkbox polos. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-lg border-[1.5px] border-brand-line ${checked ? 'bg-brand-btn' : 'bg-brand-paper'}`}
    >
      <span
        aria-hidden
        className={`absolute top-[1px] h-[18px] w-[18px] rounded-md bg-brand-card shadow-pop ${checked ? 'left-[24px]' : 'left-[2px]'}`}
      />
    </button>
  )
}

/** Pengaturan printer thermal Bluetooth: mode cetak, pilih, tes cetak, lupa, auto-print. */
function PrinterTab({ autoPrint, onAutoPrint, mode, onMode, setErr }: { autoPrint: boolean; onAutoPrint: (v: boolean) => void; mode: 'bt' | 'rawbt'; onMode: (m: 'bt' | 'rawbt') => void; setErr: (s: string) => void }): ReactElement {
  const { toast } = useToast()
  const [printer, setPrinter] = useState<SavedPrinter | null>(getSavedPrinter())
  const [busy, setBusy] = useState(false)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [diag, setDiag] = useState<DiagStep[]>([])

  const runDiag = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    setDiag([])
    try {
      const steps = await diagnosePrinter((s) => setDiag((prev) => [...prev, { step: s.replace(/^[✓✗] /, ''), ok: s.startsWith('✓'), info: undefined }]))
      setDiag(steps)
    } catch (ex) {
      setErr((ex as Error).message || 'Diagnostik gagal')
    } finally {
      setBusy(false)
    }
  }

  const pick = async (mode: 'strict' | 'all'): Promise<void> => {
    if (!bluetoothAvailable()) {
      setErr('Browser ini tidak mendukung Web Bluetooth. Pakai Chrome/Edge (Android, Windows, macOS), atau pakai aplikasi RawBT (panduan di bawah).')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const saved = await pickAndSavePrinter(mode)
      setPrinter(saved)
      toast(mode === 'all' ? 'Perangkat tersimpan — kalau bukan printernya, tekan Ganti Printer.' : 'Printer tersimpan.')
    } catch (ex) {
      setErr((ex as Error).message || 'Gagal memilih printer')
    } finally {
      setBusy(false)
    }
  }

  const test = '*** TES CETAK ***\nSabana Drieischicken\nPrinter Bluetooth OK\n\n\n'

  // Cek sambungan nyata ke printer tersimpan saat tab dibuka (tanpa dialog pair).
  useEffect(() => {
    let alive = true
    if (printer && bluetoothAvailable()) {
      void canReconnectSaved().then((ok) => {
        if (alive) setReachable(ok)
      })
    }
    return () => {
      alive = false
    }
  }, [printer])

  return (
    <div className="card max-w-xl p-4">
      <h2 className="mb-2 font-extrabold">Printer Struk Bluetooth</h2>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className={`card p-3 text-left ${mode === 'bt' ? 'ring-2 ring-brand-btn' : 'opacity-75'}`}
          onClick={() => onMode('bt')}
        >
          <p className="text-sm font-extrabold">Web Bluetooth (langsung)</p>
          <p className="text-xs text-brand-muted">App mengirim struk sendiri ke printer. Dialog pair bisa muncul sekali per sesi — keterbatasan Chrome.</p>
        </button>
        <button
          type="button"
          className={`card p-3 text-left ${mode === 'rawbt' ? 'ring-2 ring-brand-btn' : 'opacity-75'}`}
          onClick={() => onMode('rawbt')}
        >
          <p className="text-sm font-extrabold">RawBT (printer sistem) ★</p>
          <p className="text-xs text-brand-muted">Paling andal: tanpa dialog Web Bluetooth sama sekali. Pasang RawBT dulu (panduan di bawah), struk dikirim ke dialog printer Android.</p>
        </button>
      </div>
      <p className="mb-3 text-sm text-brand-muted">
        Sambungkan printer thermal sekali lewat Chrome/Edge (Android, Windows, macOS) — printer tersimpan dan dipakai ulang otomatis tanpa dialog lagi.
        Safari/iOS belum mendukung Bluetooth; struk otomatis jatuh ke print dialog. Bluetooth membandel? Lihat panduan <b>RawBT</b> di bawah.
      </p>
      <div className="mb-3 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3">
        {printer ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold">{printer.name}</p>
              <p className="text-xs text-brand-muted">{reachable === false ? 'Cek otomatis tak tersedia di browser ini — jalankan Tes Cetak untuk memastikan printer siap' : 'Tersambung — jalankan Tes Cetak untuk memastikan struk bisa terkirim'}</p>
            </div>
            <span className={`chip ${reachable === false ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>{reachable === false ? 'Cek printer' : 'Tersambung'}</span>
          </div>
        ) : (
          <p className="text-sm font-bold text-brand-muted">Belum ada printer tersimpan.</p>
        )}
      </div>
      {autoPrint && !printer && (
        <p className="mb-2 rounded-lg bg-brand-gold/25 px-3 py-2 text-sm font-bold">Print otomatis aktif: pilih printer dulu supaya struk langsung tercetak tanpa dialog.</p>
      )}
      {printer && (
        <p className="mb-2 rounded-lg bg-brand-gold/20 px-3 py-2 text-xs font-bold text-brand-muted">
          Kenapa dialog pair kadang muncul? Chrome stabil belum mengizinkan web mengingat perangkat Bluetooth antar sesi (keterbatasan browser, bukan printer rusak). Sejak dipilih sekali, cetak berikutnya <b>dalam sesi yang sama</b> sudah tanpa dialog. Tanpa dialog total → pakai RawBT (panduan di bawah).
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void pick('strict')}
        >
          {busy ? 'Menyambung...' : printer ? 'Ganti Printer' : 'Pilih & Sambungkan Printer'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => void pick('all')}
        >
          Printer tidak muncul di daftar? Cari semua perangkat Bluetooth
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost flex-1"
            disabled={busy || !printer}
            onClick={async () => {
              setBusy(true)
              setErr('')
              try {
                const how = await printTextBluetooth(test)
                if (how === 'bt') {
                  toast('Halaman tes terkirim ke printer.')
                } else if (how === 'reconnect-gagal') {
                  toast('Gagal sambung: printer mati/di luar jangkauan, atau dialog pair ditutup. Di Chrome stabil, dialog pair muncul sekali per sesi — ketuk printer yang sama. Tanpa dialog total: pakai RawBT.')
                } else if (how === 'print-gagal') {
                  toast('Printer tersambung, tapi tes gagal terkirim. Coba sekali lagi — kalau tetap gagal, printer mungkin bukan ESC/POS: pakai RawBT atau Dialog printer.')
                } else {
                  toast('Bluetooth gagal — tes dikirim ke print dialog.')
                }
              } catch (ex) {
                setErr((ex as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Tes Cetak
          </button>
          <button
            type="button"
            className="btn-ghost flex-1"
            disabled={!printer}
            onClick={() => {
              forgetPrinter()
              setPrinter(null)
              toast('Printer dihapus dari daftar.')
            }}
          >
            Lupakan Printer
          </button>
        </div>
        <label className="mt-1 flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={autoPrint} onChange={(e) => onAutoPrint(e.target.checked)} />
          Print otomatis setiap transaksi selesai
        </label>
      </div>
      <details className="mt-3 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3 text-sm">
        <summary className="cursor-pointer font-extrabold">Masih gagal juga? Jalankan Diagnostik</summary>
        <p className="mt-2">Menyambung ke printer lewat dialog lalu memetakan semua service/karakteristik dan mengirim tes cetak — hasilnya diperlihatkan persis gagal di tahap mana. Jalankan saat printer nyala. Salin hasilnya dan kirim ke saya bila masih buntu.</p>
        <button type="button" className="btn-ghost mt-2" disabled={busy} onClick={() => void runDiag()}>
          {busy ? 'Menjalankan diagnostik...' : 'Jalankan Diagnostik Printer'}
        </button>
        {diag.length > 0 && (
          <div className="mt-2 rounded-lg bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-green-200">
            {diag.map((d, i) => (
              <p key={i} className={d.ok ? '' : 'text-red-300'}>
                {d.ok ? '✓' : '✗'} {d.step}
                {d.info ? ` — ${d.info}` : ''}
              </p>
            ))}
            <button
              type="button"
              className="btn-ghost mt-2 !py-1 text-xs"
              onClick={() => void navigator.clipboard.writeText(diag.map((d) => `${d.ok ? 'OK' : 'GAGAL'}: ${d.step}${d.info ? ' — ' + d.info : ''}`).join('\n')).then(() => toast('Hasil diagnostik disalin.'))}
            >
              Salin hasil
            </button>
          </div>
        )}
      </details>
      <details className="mt-3 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3 text-sm">
        <summary className="cursor-pointer font-extrabold">Printer bandel? 3 cara alternatif</summary>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>
            <b>RawBT (paling andal, gratis)</b> — aplikasi Android yang menjadikan printer Bluetooth sebagai printer sistem. Pasang dari Play Store → buka RawBT → pilih printernya → izinkan lokasi &amp; selesaikan pairing di pengaturan Android → kembali ke sini, tombol cetak &amp; print otomatis langsung jalan.
          </li>
          <li>
            <b>Printer tidak muncul saat pairing?</b> Pakai tombol <b>“Cari semua perangkat Bluetooth”</b> di atas — sebagian printer memakai nama/UUID tidak standar sehingga lolos dari filter. Kalau tersimpan tapi tetap gagal, tekan <b>Ganti Printer</b> lalu pilih ulang.
          </li>
          <li>
            <b>Kabel USB / printer sistem</b> — pasang printer sebagai printer sistem (USB di Windows/Mac, atau pair Bluetooth lewat pengaturan OS), lalu di modal Lunas gunakan <b>Cetak (dialog)</b> dan pilih printer tersebut.
          </li>
        </ol>
      </details>
    </div>
  )
}

function ScheduleEditor({ value, onChange }: { value: DeliveryWeek | null; onChange: (v: DeliveryWeek | null) => void }): ReactElement {
  const [sched, setSched] = useState<DeliveryWeek>(() => normalizeSchedule(value) ?? normalizeSchedule({})!)
  const [enabled, setEnabled] = useState(value !== null)
  const [dirty, setDirty] = useState(false)

  // Sinkron kalau setting berubah dari luar (mis. tombol cepat di halaman Pesanan tidak menyentuh jadwal, tapi reload)
  useEffect(() => {
    if (dirty) return
    setSched(normalizeSchedule(value) ?? normalizeSchedule({})!)
    setEnabled(value !== null)
  }, [value, dirty])

  const apply = (next: DeliveryWeek, nextEnabled: boolean): void => {
    setSched(next)
    setEnabled(nextEnabled)
    setDirty(true)
  }

  const save = (): void => {
    onChange(enabled ? sched : null)
    setDirty(false)
  }

  const dayRow = (k: (typeof DAY_ORDER)[number]): ReactElement => {
    const d = sched[k]
    return (
      <div key={k} className="flex items-center gap-2">
        <label className="flex w-14 shrink-0 items-center gap-1.5 text-sm font-extrabold">
          <input
            type="checkbox"
            className="h-4 w-4"
            aria-label={`Buka hari ${DAY_LABELS[k]}`}
            checked={!d.closed}
            onChange={(e) => apply({ ...sched, [k]: { ...d, closed: !e.target.checked } }, enabled)}
          />
          {DAY_LABELS[k]}
        </label>
        <input
          type="time"
          className="input !h-9 !w-[104px] text-sm"
          aria-label={`Jam buka hari ${DAY_LABELS[k]}`}
          value={d.closed || !d.open ? '' : d.open}
          disabled={d.closed}
          onChange={(e) => apply({ ...sched, [k]: { ...d, open: e.target.value || null } }, enabled)}
        />
        <span className="text-xs font-bold text-brand-muted">s/d</span>
        <input
          type="time"
          className="input !h-9 !w-[104px] text-sm"
          aria-label={`Jam tutup hari ${DAY_LABELS[k]}`}
          value={d.closed || !d.close ? '' : d.close}
          disabled={d.closed}
          min={d.open ?? undefined}
          onChange={(e) => apply({ ...sched, [k]: { ...d, close: e.target.value || null } }, enabled)}
        />
      </div>
    )
  }

  return (
    <div className="mt-3 border-t border-brand-line pt-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) apply(normalizeSchedule(value) ?? normalizeSchedule({})!, true)
            else apply(sched, false)
          }}
        />
        <span>
          <span className="block text-sm font-extrabold">Pakai jadwal antar otomatis</span>
          <span className="block text-xs text-brand-muted">
            Portal on/off sendiri mengikuti jam di bawah, selama saklar di atas tetap on. Tanpa jadwal, on/off murni manual.
          </span>
        </span>
      </label>
      {enabled && (
        <>
          <div className="mt-2 flex flex-col gap-1.5">{DAY_ORDER.map(dayRow)}</div>
          <button type="button" className="btn-primary mt-3 !min-h-0 !py-2 text-xs" onClick={save} disabled={!dirty}>
            Simpan Jadwal
          </button>
        </>
      )}
    </div>
  )
}

function StoreForm({ settings, onSave }: { settings: Settings; onSave: (v: Settings['store']) => void }): ReactElement {
  const [v, setV] = useState(settings.store)
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(v)
      }}
    >
      <div>
        <label className="lbl" htmlFor="sname">
          Nama toko
        </label>
        <input id="sname" className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
        <p className="mt-1 text-xs text-brand-muted">Tampil di halaman login &amp; sidebar kasir.</p>
      </div>
      <div>
        <label className="lbl" htmlFor="stag">
          Tagline (di bawah nama toko)
        </label>
        <input id="stag" className="input" value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} />
        <p className="mt-1 text-xs text-brand-muted">Baris kecil di bawah nama, tampil di login &amp; sidebar.</p>
      </div>
      <div>
        <label className="lbl" htmlFor="saddr">
          Alamat (tampil di struk)
        </label>
        <input id="saddr" className="input" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
      </div>
      <div>
        <label className="lbl" htmlFor="sphone">
          Telepon
        </label>
        <input id="sphone" className="input" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      </div>
      <div>
        <label className="lbl" htmlFor="sfoot">
          Footer struk
        </label>
        <input id="sfoot" className="input" value={v.footer} onChange={(e) => setV({ ...v, footer: e.target.value })} />
      </div>
      <button type="submit" className="btn-primary">
        Simpan Identitas
      </button>
    </form>
  )
}

function ReceiptForm({ settings, onSave }: { settings: Settings; onSave: (v: Settings['receipt']) => void }): ReactElement {
  const [v, setV] = useState(settings.receipt)
  const updF = (patch: Partial<Settings['receipt']>): void => setV({ ...v, ...patch })
  return (
    <div className="grid max-w-3xl gap-3 lg:grid-cols-2">
      <div className="card p-4">
        <h2 className="mb-2 font-extrabold">Template struk</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="lbl" htmlFor="rwidth">
              Lebar kertas
            </label>
            <select id="rwidth" className="input" value={v.width_mm} onChange={(e) => updF({ width_mm: parseInt(e.target.value, 10) })}>
              <option value={58}>58 mm (thermal kecil)</option>
              <option value={80}>80 mm</option>
            </select>
          </div>
          <div>
            <label className="lbl" htmlFor="rheader">
              Header (nama di struk)
            </label>
            <input id="rheader" className="input" value={v.header} onChange={(e) => updF({ header: e.target.value })} />
          </div>
          <div>
            <label className="lbl" htmlFor="rfooter">
              Footer
            </label>
            <input id="rfooter" className="input" value={v.footer} onChange={(e) => updF({ footer: e.target.value })} />
          </div>
          {(
            [
              ['show_cashier', 'Tampilkan nama kasir'],
              ['show_channel', 'Tampilkan jenis pesanan'],
              ['show_qr', 'Tampilkan QR di struk (perlu struk QR di printer)']
            ] as [keyof Settings['receipt'], string][]
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={Boolean(v[k])} onChange={(e) => updF({ [k]: e.target.checked })} />
              {label}
            </label>
          ))}
          <button type="button" className="btn-primary" onClick={() => onSave(v)}>
            Simpan Template
          </button>
        </div>
      </div>
      <div className="card p-4">
        <h2 className="mb-2 font-extrabold">Pratinjau</h2>
        <div className="overflow-x-auto">
          <div
            style={{ width: v.width_mm >= 80 ? 300 : 220 }}
            className="rounded border-[1.5px] border-dashed border-brand-line p-2 font-mono text-[11px] leading-tight"
          >
            <p className="text-center font-bold uppercase">{v.header || 'SABANA'}</p>
            <p className="text-center">SB260909-0001 09:41</p>
            {v.show_cashier && <p>Kasir: Ridho</p>}
            {v.show_channel && <p>Bungkus</p>}
            <p className="my-1 border-t border-dashed border-black/60" />
            <div className="flex justify-between"><span>Ayam Paha Atas</span><span>2x11.000</span></div>
            <div className="flex justify-between pl-3"><span>2 x 11.000</span><span>22.000</span></div>
            <div className="flex justify-between"><span>Nasi Putih</span><span>1x5.000</span></div>
            <div className="flex justify-between pl-3"><span>1 x 5.000</span><span>5.000</span></div>
            <p className="my-1 border-t border-dashed border-black/60" />
            <div className="flex justify-between font-bold"><span>TOTAL</span><span>27.000</span></div>
            <div className="flex justify-between"><span>Tunai</span><span>50.000</span></div>
            <div className="flex justify-between"><span>Kembali</span><span>23.000</span></div>
            <p className="my-1 border-t border-dashed border-black/60" />
            <p className="text-center">{v.footer}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-brand-muted">Cetak via printer Bluetooth (Chrome/Edge) atau print dialog dari modal struk kasir.</p>
      </div>
    </div>
  )
}
