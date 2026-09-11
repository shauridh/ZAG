import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { loadCatalog, loadTransactions, loadFinance, loadSettings, loadFryers, type Catalog } from '../lib/db'
import { totalsOf, byChannel, byItem, byHour, byPayment, methodLabel } from '../lib/reports'
import { fmtRp, fmtQty } from '../lib/money'
import { todayISO, addDaysISO, dayStart, dayEnd, fmtDate, localDateISO } from '../lib/dates'
import type { Expense, OtherIncome, Settings, Transaction, OilCycle } from '../lib/types'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts'

const CHAN_LABEL: Record<string, string> = {
  dinein: 'Makan di tempat',
  takeaway: 'Bungkus',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  delivery: 'Delivery sendiri'
}

type Period = 'today' | 'yesterday' | 'month' | 'all' | 'custom'

const PERIODS: [Period, string][] = [
  ['today', 'Hari ini'],
  ['yesterday', 'Kemarin'],
  ['month', 'Bulan ini'],
  ['all', 'All time'],
  ['custom', 'Pilih tanggal']
]

/** Rentang [fromISO, toISO] hari kalender utk filter created_at. */
function rangeOf(p: Period, customFrom: string, customTo: string): { from: string; to: string; label: string } {
  const today = todayISO()
  switch (p) {
    case 'today':
      return { from: today, to: today, label: 'Hari ini' }
    case 'yesterday':
      return { from: addDaysISO(today, -1), to: addDaysISO(today, -1), label: 'Kemarin' }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today, label: 'Bulan ini' }
    case 'all':
      return { from: '2000-01-01', to: today, label: 'All time' }
    case 'custom': {
      const from = customFrom || today
      const to = customTo || from
      const label = from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`
      return { from, to, label }
    }
  }
}

/** Jumlah hari kalender dalam rentang [from, to] inklusif. */
function spanDays(from: string, to: string): number {
  return Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1
}

/**
 * Deret omzet & laba per hari kalender dari `from`..`to`; hari kosong = 0.
 * Dipakai untuk tren periode terpilih dan deret pembanding (sejajar hari kerja).
 */
function dailySeriesOf(txs: Transaction[], from: string, to: string): { hari: string; omzet: number; laba: number }[] {
  const buckets = new Map<string, { omzet: number; laba: number }>()
  for (const t of txs) {
    // bukan slice UTC: transaksi jam 19+ tergeser ke hari sebelumnya
    const iso = localDateISO(t.created_at)
    const b = buckets.get(iso) ?? { omzet: 0, laba: 0 }
    b.omzet += t.total
    b.laba += t.total - t.hpp - t.channel_fee
    buckets.set(iso, b)
  }
  const out: { hari: string; omzet: number; laba: number }[] = []
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  let guard = 0
  while (d <= end && guard < 400) {
    const iso = localDateISO(d)
    const b = buckets.get(iso) ?? { omzet: 0, laba: 0 }
    out.push({ hari: fmtDate(iso).slice(0, 6), omzet: b.omzet, laba: b.laba })
    d.setDate(d.getDate() + 1)
    guard++
  }
  // all time panjang: tampilkan 31 hari terakhir saja biar grafik terbaca
  return out.length > 31 ? out.slice(-31) : out
}

// Warna metode pembayaran sesuai palet: tunai merah identitas, QRIS emas aksen, transfer abu hangat
const PAY_COLOR: Record<string, string> = { cash: '#c4151b', qris: '#f5a302', transfer: '#6e6159' }

/**
 * Periode pembanding: sama panjang dan SEJAJAR HARI KERJA (Senin vs Senin).
 * Digeser mundur kelipatan 7 hari yang ≥ panjang periode, sehingga setiap hari
 * dalam periode dipasangkan dengan weekday yang sama persis.
 * Contoh: Hari ini Sel 9 Sep → pembanding Sel 2 Sep. Kemarin Sen 8 Sep → Sen 1 Sep.
 * Rentang 8–14 hari digeser 2 minggu, dst. All time tidak punya pembanding.
 */
function compareRangeOf(from: string, to: string, period: Period): { from: string; to: string; label: string } | null {
  if (period === 'all') return null
  const days = spanDays(from, to)
  const shift = 7 * Math.max(1, Math.ceil(days / 7))
  const cFrom = addDaysISO(from, -shift)
  const cTo = addDaysISO(to, -shift)
  const label =
    cFrom === cTo
      ? `${WD[new Date(cFrom + 'T00:00:00').getDay()]}, ${fmtDate(cFrom)}`
      : `${WD[new Date(cFrom + 'T00:00:00').getDay()]} ${fmtDate(cFrom)} – ${WD[new Date(cTo + 'T00:00:00').getDay()]} ${fmtDate(cTo)}`
  return { from: cFrom, to: cTo, label }
}

const WD = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

export default function Dashboard(): ReactElement {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [period, setPeriod] = useState<Period>('today')
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  const [txs, setTxs] = useState<Transaction[]>([])
  const [fin, setFin] = useState<{ expenses: Expense[]; otherIncome: OtherIncome[] } | null>(null)
  const [cycles, setCycles] = useState<OilCycle[]>([])
  const [err, setErr] = useState('')

  const { from, to, label } = useMemo(() => rangeOf(period, customFrom, customTo), [period, customFrom, customTo])
  const cmp = useMemo(() => compareRangeOf(from, to, period), [from, to, period])

  const reload = useCallback(async () => {
    try {
      const today = todayISO()
      const [c, s, tSel, , f, fr, tCmp] = await Promise.all([
        loadCatalog(),
        loadSettings(),
        loadTransactions(dayStart(from), dayEnd(to)),
        loadTransactions(dayStart(today.slice(0, 8) + '01'), dayEnd(today)),
        loadFinance(today.slice(0, 8) + '01', today),
        loadFryers(),
        cmp ? loadTransactions(dayStart(cmp.from), dayEnd(cmp.to)) : Promise.resolve([])
      ])
      setCatalog(c)
      setSettings(s)
      setTxs(tSel)
      setFin(f)
      setCycles(fr.cycles)
      setTxsCmp(tCmp)
      // pembanding bulan berjalan utk kartu laba bersih (tetap tampil di semua periode)
      void loadTransactions(dayStart(today.slice(0, 8) + '01'), dayEnd(today)).then(setTxsMonth)
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [from, to, cmp])

  const [txsMonth, setTxsMonth] = useState<Transaction[]>([])
  const [txsCmp, setTxsCmp] = useState<Transaction[]>([])

  useEffect(() => {
    void reload()
    const iv = window.setInterval(() => void reload(), 30000)
    return () => window.clearInterval(iv)
  }, [reload])

  const sum = useMemo(() => totalsOf(txs), [txs])
  const sumMonth = useMemo(() => totalsOf(txsMonth), [txsMonth])
  const sumCmp = useMemo(() => totalsOf(txsCmp), [txsCmp])

  /** Selisih % omzet vs periode pembanding (sejajar hari kerja). */
  const revDelta = useMemo(() => {
    if (!cmp || !txsCmp) return null
    const a = sum.revenue
    const b = sumCmp.revenue
    if (b === 0) return a > 0 ? { pct: 100, prev: 0 } : { pct: 0, prev: 0 }
    return { pct: Math.round(((a - b) / b) * 100), prev: b }
  }, [cmp, sum.revenue, sumCmp.revenue])

  // tren harian mengikuti periode terpilih (maks 31 titik terakhir)
  const dailySeries = useMemo(() => dailySeriesOf(txs, from, to), [txs, from, to])
  const cmpSeries = useMemo(() => (cmp ? dailySeriesOf(txsCmp, cmp.from, cmp.to) : []), [txsCmp, cmp])
  // pasangkan indeks: dua deret sama-sama urut penuh per hari, jadi posisi ke-i sejajar hari kerja
  const pairedDaily = useMemo(
    () => dailySeries.map((d, i) => ({ hari: d.hari, omzet: d.omzet, lalu: cmpSeries[i]?.omzet ?? 0 })),
    [dailySeries, cmpSeries]
  )

  const chans = useMemo(() => byChannel(txs), [txs])
  const pays = useMemo(() => byPayment(txs), [txs])
  const topItems = useMemo(() => byItem(txs).slice(0, 6), [txs])
  const hours = useMemo(() => byHour(txs).filter((h) => h.revenue > 0), [txs])

  const targets = useMemo(() => {
    if (!catalog || period !== 'today') return []
    return catalog.products
      .filter((p) => (catalog.targets.get(p.id) ?? 0) > 0)
      .map((p) => {
        const target = catalog.targets.get(p.id) ?? 0
        const sold = txs.reduce((s, t) => s + (t.items ?? []).filter((i) => i.name === p.name).reduce((a, i) => a + i.qty, 0), 0)
        return { name: p.name, sold, target }
      })
  }, [catalog, txs, period])

  const lowStock = useMemo(() => (catalog?.ingredients ?? []).filter((i) => i.active && i.stock <= i.min_stock), [catalog])

  if (!catalog || !settings || !fin) {
    return <div className="p-6 text-sm font-bold text-brand-muted">Memuat dashboard...</div>
  }

  const pieColors = ['#c4151b', '#f5a302', '#1a1512', '#8a5a44', '#e8d9cd', '#6e6159']
  const netMonth = totalsOf(txsMonth).gross - fin.expenses.reduce((s, e) => s + e.amount, 0) - settings.fixed_costs.reduce((s, f) => s + f.amount, 0) + fin.otherIncome.reduce((s, i) => s + i.amount, 0)
  const oilAlert = cycles.filter(
    (c) =>
      c.status === 'aktif' &&
      (Math.floor((Date.now() - new Date(c.started_at).getTime()) / 86400000) >= settings.oil.max_days ||
        c.fry_count >= settings.oil.max_fry_count)
  )

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">Dashboard</h1>
        {oilAlert.length > 0 && (
          <Link to="/produksi" className="chip h-9 bg-brand-gold px-3">
            ⚠ {oilAlert.length} fryer wajib ganti minyak
          </Link>
        )}
        {lowStock.length > 0 && (
          <Link to="/stok" className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">
            {lowStock.length} bahan menipis
          </Link>
        )}
        {/* Pemilih periode: di kanan header, bukan kartu sendiri */}
        <div className="ml-auto flex flex-wrap justify-end gap-1" role="tablist" aria-label="Periode">
          {PERIODS.map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={period === k}
              className={`chip h-9 px-3 ${period === k ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
              onClick={() => setPeriod(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {period === 'custom' && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <input type="date" className="input !h-9 !w-40" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); if (customTo < e.target.value) setCustomTo(e.target.value) }} aria-label="Dari tanggal" />
          <span className="text-xs font-bold text-brand-muted">s/d</span>
          <input type="date" className="input !h-9 !w-40" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} aria-label="Sampai tanggal" />
        </div>
      )}
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {/* Gerai baru / sebelum buka: arahkan ke langkah nyata berikutnya */}
      {period === 'today' && sum.count === 0 && (
        <div className="card strip mb-3 flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-base font-extrabold">Belum ada transaksi hari ini</p>
            <p className="text-sm text-brand-muted">Buka shift lalu mulai jualan di Kasir. Transaksi pertama langsung muncul di dashboard ini.</p>
          </div>
          <Link to="/kasir" className="btn-primary shrink-0">
            Buka Kasir
          </Link>
        </div>
      )}

      {/* Ringkasan periode terpilih */}
      <div className="card strip mb-3 grid grid-cols-1 gap-3 p-4 min-[480px]:grid-cols-2 sm:grid-cols-4">
        <div>
          <p className="text-xs font-bold text-brand-muted">Omzet · {label}</p>
          <p className="text-2xl font-extrabold tabular-nums">{fmtRp(sum.revenue)}</p>
          <p className="text-xs font-bold text-brand-muted">
            {sum.count} transaksi · rata-rata {fmtRp(sum.avg)}
          </p>
          {revDelta && cmp && (
            <p className={`mt-0.5 text-xs font-extrabold ${revDelta.pct > 0 ? 'text-emerald-700' : revDelta.pct < 0 ? 'text-brand-redtext' : 'text-brand-muted'}`}>
              {revDelta.pct > 0 ? '▲' : revDelta.pct < 0 ? '▼' : '■'} {Math.abs(revDelta.pct)}% vs {cmp.label} ({fmtRp(revDelta.prev)})
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-bold text-brand-muted">Laba kotor · {label}</p>
          <p className="text-2xl font-extrabold tabular-nums">{fmtRp(sum.gross)}</p>
          <p className="text-xs font-bold text-brand-muted">HPP {fmtRp(sum.hpp)}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-brand-muted">Komisi channel · {label}</p>
          <p className="text-2xl font-extrabold tabular-nums">{fmtRp(sum.fee)}</p>
          <p className="text-xs font-bold text-brand-muted">GoFood / GrabFood / ShopeeFood</p>
        </div>
        <div>
          <p className="text-xs font-bold text-brand-muted">Estimasi laba bersih bulan ini</p>
          <p className={`whitespace-nowrap text-2xl font-extrabold tabular-nums ${netMonth < 0 ? 'text-brand-redtext' : ''}`}>{fmtRp(netMonth)}</p>
          <p className="text-xs font-bold text-brand-muted">omzet bulan ini {fmtRp(sumMonth.revenue)}</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Tren harian sesuai periode */}
        <div className="card p-3 lg:col-span-2">
          <h2 className="mb-2 font-extrabold">Omzet & laba kotor · {label}</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySeries} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#e8d9cd" vertical={false} />
                <XAxis dataKey="hari" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v))} tickLine={false} width={44} />
                <Tooltip formatter={(v: number) => fmtRp(v)} />
                <Area type="monotone" dataKey="omzet" stroke="#c4151b" fill="#c4151b" fillOpacity={0.85} name="Omzet" />
                <Area type="monotone" dataKey="laba" stroke="#1a1512" fill="#fff8f2" fillOpacity={1} name="Laba kotor" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mix channel sesuai periode */}
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Channel penjualan · {label}</h2>
          {chans.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-muted">Belum ada penjualan pada periode ini.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chans} dataKey="revenue" nameKey="key" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                    {chans.map((c, i) => (
                      <Cell key={c.key} fill={pieColors[i % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtRp(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="mt-1 text-xs font-bold">
            {chans.map((c, i) => (
              <li key={c.key}>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: pieColors[i % pieColors.length] }} />
                {CHAN_LABEL[c.key] ?? c.key}: {fmtRp(c.revenue)}
                {c.fee > 0 && <span className="font-normal text-brand-muted"> (komisi {fmtRp(c.fee)})</span>}
              </li>
            ))}
          </ul>
        </div>

        {/* Terlaris */}
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Menu terlaris · {label}</h2>
          {topItems.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-muted">Belum ada data.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} tickLine={false} />
                  <Tooltip formatter={(v: number) => fmtRp(v)} />
                  <Bar dataKey="revenue" fill="#c4151b" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Jam sibuk */}
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Jam sibuk · {label}</h2>
          {hours.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-muted">Belum ada transaksi pada periode ini.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ left: 8, right: 8 }}>
                  <XAxis dataKey="hour" tickFormatter={(h: number) => `${h}`} tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v))} tickLine={false} width={44} />
                  <Tooltip formatter={(v: number) => fmtRp(v)} labelFormatter={(h: number) => `Jam ${h}.00`} />
                  <Bar dataKey="revenue" fill="#f5a302" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Metode pembayaran: uang di drawer vs QRIS/transfer */}
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Metode pembayaran · {label}</h2>
          {pays.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-muted">Belum ada pembayaran pada periode ini.</p>
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pays} dataKey="amount" nameKey="method" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                      {pays.map((p) => (
                        <Cell key={p.method} fill={PAY_COLOR[p.method] ?? '#8a5a44'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtRp(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-1 text-xs font-bold">
                {pays.map((p) => (
                  <li key={p.method} className="flex justify-between">
                    <span>
                      <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: PAY_COLOR[p.method] ?? '#8a5a44' }} />
                      {methodLabel(p.method)}
                    </span>
                    <span className="tabular-nums">{fmtRp(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Target vs aktual */}
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Target hari ini</h2>
          <ul className="flex flex-col gap-2">
            {targets.map((t) => {
              const pct = Math.min(100, Math.round((t.sold / t.target) * 100))
              return (
                <li key={t.name}>
                  <div className="flex justify-between text-xs font-bold">
                    <span>{t.name}</span>
                    <span className="tabular-nums">
                      {t.sold}/{t.target} ({pct}%)
                    </span>
                  </div>
                  <div className="mt-0.5 h-2.5 rounded border border-brand-line bg-brand-paper">
                    <div className={`h-full rounded ${pct >= 100 ? 'bg-brand-gold' : 'bg-brand-btn'}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </li>
              )
            })}
            {targets.length === 0 && <li className="text-sm text-brand-muted">Atur target di halaman Menu & Paket, tab Target Harian.</li>}
          </ul>
        </div>

        {/* Omzet vs periode pembanding (sejajar hari kerja) */}
        <div className="card p-3 lg:col-span-2">
          <h2 className="mb-2 font-extrabold">Omzet vs periode lalu · {label}</h2>
          {!cmp ? (
            <p className="py-10 text-center text-sm text-brand-muted">Pilih Hari ini, Kemarin, Bulan ini, atau tanggal tertentu untuk perbandingan.</p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pairedDaily} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid stroke="#e8d9cd" vertical={false} />
                    <XAxis dataKey="hari" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v))} tickLine={false} width={44} />
                    <Tooltip formatter={(v: number) => fmtRp(v)} />
                    <Bar dataKey="omzet" name="Periode ini" fill="#c4151b" radius={[4, 4, 0, 0]} barSize={10} />
                    <Bar dataKey="lalu" name="Periode lalu" fill="#6e6159" radius={[4, 4, 0, 0]} barSize={10} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-1 flex flex-wrap gap-3 text-xs font-bold">
                <li>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand-btn align-middle" />
                  Periode ini
                </li>
                <li>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: '#6e6159' }} />
                  Periode lalu · {cmp.label}
                </li>
              </ul>
            </>
          )}
        </div>

        {/* Peringatan stok: kartu per bahan, habis didahulukan */}
        <div className="card p-3 lg:col-span-3">
          <h2 className="mb-2 font-extrabold">Bahan menipis / habis</h2>
          {lowStock.length === 0 ? (
            <p className="text-sm text-brand-muted">Semua stok bahan di atas minimum. Aman.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {[...lowStock]
                .sort((a, b) => {
                  const ra = a.stock <= 0 ? -1 : a.min_stock > 0 ? a.stock / a.min_stock : 0
                  const rb = b.stock <= 0 ? -1 : b.min_stock > 0 ? b.stock / b.min_stock : 0
                  return ra - rb
                })
                .map((i) => {
                  const habis = i.stock <= 0
                  const pct = Math.min(100, Math.round((Math.max(i.stock, 0) / Math.max(i.min_stock, 1)) * 100))
                  return (
                    <div key={i.id} className="rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-2.5">
                      <div className="flex items-start justify-between gap-1">
                        <p className="line-clamp-2 text-xs font-bold leading-snug">{i.name}</p>
                        <span className={`chip shrink-0 text-[10px] ${habis ? 'bg-brand-redtext text-white' : 'bg-brand-gold'}`}>
                          {habis ? 'Habis' : 'Menipis'}
                        </span>
                      </div>
                      <p className="mt-1 text-lg font-extrabold tabular-nums">
                        {fmtQty(i.stock)} <span className="text-[10px] font-bold text-brand-muted">{i.buy_unit}</span>
                      </p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-brand-line">
                        <div className={`h-full rounded ${habis ? 'bg-brand-redtext' : 'bg-brand-gold'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] font-bold text-brand-muted">min {fmtQty(i.min_stock)} {i.buy_unit}</p>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
