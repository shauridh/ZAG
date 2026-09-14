import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { loadCatalog, loadTransactions, loadFinance, loadSettings, loadFryers, loadPortalOrders, upsertProduct, saveRecipe, type Catalog } from '../lib/db'
import { totalsOf, byChannel, byItem, byHour, byPayment, methodLabel } from '../lib/reports'
import { stockTrendsFrom } from '../lib/stock-trend'
import { auditRecipeHealth, bundleIdeas, bundleRecipeLines, type BundleIdea } from '../lib/menu-ideas'
import { ingIndex, maxAvailableQty } from '../lib/hpp'
import { useToast } from '../components/Toast'
import { downloadCsv } from '../lib/csv'
import { fmtRp, fmtRpPlain, fmtQty } from '../lib/money'
import { todayISO, addDaysISO, dayStart, dayEnd, fmtDate, localDateISO } from '../lib/dates'
import type { Expense, OtherIncome, Settings, Transaction, OilCycle, Category } from '../lib/types'
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
  Bar,
  LineChart,
  Line
} from 'recharts'

const CHAN_LABEL: Record<string, string> = {
  dinein: 'Makan di tempat',
  takeaway: 'Bungkus',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  delivery: 'Delivery sendiri'
}

type Period = 'today' | 'yesterday' | 'week7' | 'month' | 'all' | 'custom'

const PERIODS: [Period, string][] = [
  ['today', 'Hari ini'],
  ['yesterday', 'Kemarin'],
  ['week7', '7 hari'],
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
    case 'week7':
      return { from: addDaysISO(today, -6), to: today, label: '7 hari' }
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

/** ISO tanggal ke-i (0-based) dari rentang yang berawal `from` — sejajar dailySeries. */
function dailyDateISO(from: string, i: number): string {
  const d = new Date(from + 'T00:00:00')
  d.setDate(d.getDate() + i)
  return localDateISO(d)
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

/* ===== Toggle tampil/sembunyi tiap kartu dashboard (persist di localStorage) ===== */
type WidgetKey =
  | 'summary'
  | 'actions'
  | 'recipeIssues'
  | 'dailyTrend'
  | 'channelMix'
  | 'channelTable'
  | 'topItems'
  | 'busyHours'
  | 'paymentMix'
  | 'targets'
  | 'bestSellers'
  | 'revCompare'
  | 'stockTrend'
  | 'preparedStock'
  | 'ideas'
  | 'lowStock'
  | 'txPerDay'
  | 'catMix'
  | 'avgTicket'

const WIDGET_DEFS: { key: WidgetKey; label: string; def: boolean }[] = [
  { key: 'summary', label: 'Ringkasan omzet & laba', def: true },
  { key: 'actions', label: 'Perlu tindakan', def: true },
  { key: 'recipeIssues', label: 'Peringatan resep rusak', def: true },
  { key: 'dailyTrend', label: 'Tren omzet & laba harian', def: true },
  { key: 'txPerDay', label: 'Jumlah transaksi per hari (baru)', def: true },
  { key: 'channelMix', label: 'Channel penjualan (donat)', def: true },
  { key: 'channelTable', label: 'Tabel penerimaan channel', def: true },
  { key: 'topItems', label: 'Menu terlaris (bar)', def: true },
  { key: 'busyHours', label: 'Jam sibuk', def: true },
  { key: 'catMix', label: 'Omzet per kategori (donat, baru)', def: true },
  { key: 'avgTicket', label: 'Rata-rata nota harian (baru)', def: true },
  { key: 'paymentMix', label: 'Metode pembayaran', def: true },
  { key: 'targets', label: 'Target menu hari ini', def: true },
  { key: 'bestSellers', label: 'Best seller vs target + sisa porsi', def: true },
  { key: 'revCompare', label: 'Omzet vs periode lalu', def: true },
  { key: 'stockTrend', label: 'Tren stok bahan kritis', def: true },
  { key: 'preparedStock', label: 'Stok siap jual', def: true },
  { key: 'ideas', label: 'Ide menu paket', def: true },
  { key: 'lowStock', label: 'Bahan menipis / habis', def: true }
]

const WIDGET_STORE = 'sabana-dash-widgets-v1'

/** Set key aktif; key yang belum pernah disimpan mengikuti default-nya. */
function loadWidgets(): Set<WidgetKey> {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDGET_STORE) ?? '{}') as Record<string, boolean>
    return new Set(WIDGET_DEFS.filter((d) => raw[d.key] ?? d.def).map((d) => d.key))
  } catch {
    return new Set(WIDGET_DEFS.filter((d) => d.def).map((d) => d.key))
  }
}

export default function Dashboard(): ReactElement {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [period, setPeriod] = useState<Period>('today')
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  const [txs, setTxs] = useState<Transaction[]>([])
  const [fin, setFin] = useState<{ expenses: Expense[]; otherIncome: OtherIncome[] } | null>(null)
  const [cycles, setCycles] = useState<OilCycle[]>([])
  const [pendingOrders, setPendingOrders] = useState(0)
  const [err, setErr] = useState('')
  const [creatingIdea, setCreatingIdea] = useState<string | null>(null)
  const [widgets, setWidgets] = useState<Set<WidgetKey>>(loadWidgets)
  const [widgetsOpen, setWidgetsOpen] = useState(false)
  const { toast } = useToast()

  const { from, to, label } = useMemo(() => rangeOf(period, customFrom, customTo), [period, customFrom, customTo])
  const cmp = useMemo(() => compareRangeOf(from, to, period), [from, to, period])

  const reload = useCallback(async () => {
    try {
      const today = todayISO()
      const [c, s, tSel, , f, fr, tCmp, orders] = await Promise.all([
        loadCatalog(),
        loadSettings(),
        loadTransactions(dayStart(from), dayEnd(to)),
        loadTransactions(dayStart(today.slice(0, 8) + '01'), dayEnd(today)),
        loadFinance(today.slice(0, 8) + '01', today),
        loadFryers(),
        cmp ? loadTransactions(dayStart(cmp.from), dayEnd(cmp.to)) : Promise.resolve([]),
        loadPortalOrders().catch(() => [])
      ])
      setCatalog(c)
      setSettings(s)
      setTxs(tSel)
      setFin(f)
      setCycles(fr.cycles)
      setTxsCmp(tCmp)
      setPendingOrders(orders.filter((o) => o.status === 'menunggu' || o.status === 'menunggu_verifikasi').length)
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

  /** Jumlah transaksi & rata-rata nota per hari (dari deret harian yang sudah ada). */
  const txPerDay = useMemo(
    () =>
      dailySeries.map((d, i) => ({
        hari: d.hari,
        trx: (txs ?? []).filter((t) => localDateISO(t.created_at) === dailyDateISO(from, i)).length,
        avg: 0
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailySeries, txs, from]
  )
  // isi avg di iterasi kedua agar bisa pakai omzet deret yang sama
  const avgTicket = useMemo(
    () => dailySeries.map((d, i) => ({ hari: d.hari, avg: d.omzet / Math.max(1, txPerDay[i]?.trx ?? 0) })),
    [dailySeries, txPerDay]
  )

  /** Omzet per kategori menu: paket tanpa kategori digabung sbg "Paket". */
  const catMix = useMemo(() => {
    if (!catalog) return []
    const catName = new Map<number, string>(catalog.categories.map((c: Category) => [c.id, c.name]))
    const m = new Map<string, number>()
    for (const t of txs)
      for (const it of t.items ?? []) {
        const p = catalog.products.find((x) => x.name === it.name)
        const label = p ? (p.category_id != null ? (catName.get(p.category_id) ?? 'Lainnya') : 'Paket') : 'Lainnya'
        m.set(label, (m.get(label) ?? 0) + it.qty * it.price)
      }
    return [...m.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [catalog, txs])

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

  /** Best seller vs target (pindahan Laporan): qty terjual, omzet, pencapaian target bila ada + sisa porsi live. */
  const bestSellers = useMemo(() => {
    if (!catalog) return []
    const ingById = ingIndex(catalog.ingredients)
    return byItem(txs)
      .map((i) => {
        const pid = catalog.products.find((p) => p.name === i.name)?.id
        const target = pid ? (catalog.targets.get(pid) ?? 0) : 0
        // target adalah per-hari; utk rentang panjang dikali jumlah hari
        const targetTotal = target * (period === 'today' ? 1 : Math.min(spanDays(from, to), 31))
        // sisa porsi live dari resep × stok bahan (sumber sama dgn kasir)
        const sisa = pid ? maxAvailableQty(pid, catalog.recipeByProduct, ingById) : null
        return { name: i.name, qty: i.qty, revenue: i.revenue, target: targetTotal, pid, sisa }
      })
      .slice(0, 8)
      .sort((a, b) => b.qty - a.qty)
  }, [catalog, txs, period, from, to])

  /** Wujudkan ide paket jadi menu baru + resep (komponen = menu penyusun, bahan utama saja). */
  const createBundle = async (idea: BundleIdea): Promise<void> => {
    setCreatingIdea(idea.name)
    setErr('')
    try {
      await upsertProduct({
        name: idea.name,
        category_id: null,
        price: idea.suggestedPrice,
        unit: 'paket',
        is_active: true,
        sort: 90
      })
      const fresh = await loadCatalog()
      // menu baru = id terbesar (identity) — nama bisa sama dg paket lama yang nonaktif
      const created = fresh.products.reduce((a, b) => (b.id > a.id ? b : a), fresh.products[0])
      if (!created || created.name !== idea.name) throw new Error('Menu paket tidak ditemukan setelah disimpan')
      await saveRecipe(created.id, bundleRecipeLines(created.id, idea.items))
      setCatalog(fresh)
      toast(`Menu "${idea.name}" dibuat lengkap dengan resep ${idea.items.length} komponen.`)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setCreatingIdea(null)
    }
  }

  const lowStock = useMemo(() => (catalog?.ingredients ?? []).filter((i) => i.active && i.stock <= i.min_stock), [catalog])
  // kesehatan resep: bahan nonaktif yang masih dipakai → resep diam-diam rusak
  const recipeIssues = useMemo(() => (catalog ? auditRecipeHealth(catalog) : []), [catalog])
  // ide menu PAKET: kombinasi menu existing dengan harga bundling diskon
  const ideas = useMemo(() => (catalog ? bundleIdeas(catalog) : []), [catalog])
  // stok siap jual = bahan setengah jadi hasil batch produksi
  const preparedStock = useMemo(() => (catalog?.ingredients ?? []).filter((i) => i.kind === 'prepared' && i.active), [catalog])

  /** Tren stok 7 hari bahan kritis (estimasi rekonstruksi dari resep transaksi). */
  const stockTrend = useMemo(() => {
    if (!catalog || lowStock.length === 0) return []
    return stockTrendsFrom(
      // pakai transaksi 30 hari terakhir sebagai dasar pemakaian
      txs.length > 0 ? txs : [],
      catalog.products,
      lowStock,
      catalog.recipeByProduct,
      catalog.ingRecipes
    )
  }, [catalog, lowStock, txs])

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

  const downloadReport = (): void =>
    downloadCsv(`laporan-${from}_${to}.csv`, [
      ['Ringkasan', `${from} s.d. ${to}`],
      ['Omzet', sum.revenue],
      ['HPP', sum.hpp],
      ['Komisi channel', sum.fee],
      ['Laba kotor', sum.gross],
      ['Jumlah transaksi', sum.count],
      [],
      ['Per channel', 'Omzet', 'Trx', 'Komisi', 'Bersih'],
      ...chans.map((c) => [CHAN_LABEL[c.key] ?? c.key, c.revenue, c.count, c.fee, c.revenue - c.fee]),
      [],
      ['Per metode bayar', 'Jumlah'],
      ...pays.map((p) => [methodLabel(p.method), p.amount]),
      [],
      ['Item', 'Qty', 'Omzet', 'Margin'],
      ...byItem(txs).map((i) => [i.name, i.qty, i.revenue, i.margin])
    ])

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">Dashboard</h1>
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
          <button type="button" className="btn-ghost !min-h-0 !h-9 !px-3" onClick={downloadReport}>
            Unduh CSV
          </button>
          <button
            type="button"
            className={`chip h-9 px-3 ${widgetsOpen ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
            aria-expanded={widgetsOpen}
            aria-haspopup="dialog"
            title="Pilih kartu yang tampil di dashboard"
            onClick={() => setWidgetsOpen((v) => !v)}
          >
            ⚙ Widget
          </button>
        </div>
      </div>

      {/* Panel toggle kartu dashboard: tersimpan per perangkat */}
      {widgetsOpen && (
        <div className="card mb-3 p-3" role="dialog" aria-label="Atur tampilan dashboard">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-extrabold">Kartu yang ditampilkan</h2>
            <div className="flex gap-1">
              <button type="button" className="btn-ghost !min-h-0 !py-1 text-[11px]" onClick={() => setWidgets(new Set(WIDGET_DEFS.map((d) => d.key)))}>
                Tampilkan semua
              </button>
              <button type="button" className="btn-ghost !min-h-0 !py-1 text-[11px]" onClick={() => setWidgets(new Set())}>
                Sembunyikan semua
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
            {WIDGET_DEFS.map((d) => (
              <label key={d.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs font-bold hover:bg-brand-paper">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#c4151b]"
                  checked={widgets.has(d.key)}
                  onChange={(e) =>
                    setWidgets((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(d.key)
                      else next.delete(d.key)
                      const rec: Record<string, boolean> = {}
                      WIDGET_DEFS.forEach((w) => (rec[w.key] = next.has(w.key)))
                      localStorage.setItem(WIDGET_STORE, JSON.stringify(rec))
                      return next
                    })
                  }
                />
                {d.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-brand-muted">Pilihan tersimpan otomatis di perangkat ini.</p>
        </div>
      )}
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
      {widgets.has('summary') && (
      <div className="card strip mb-3 grid grid-cols-1 gap-3 p-4 min-[480px]:grid-cols-2 sm:grid-cols-4">
        <div>
          <p className="text-xs font-bold text-brand-muted">Omzet · {label}</p>
          <p className="text-2xl font-extrabold tabular-nums">{fmtRp(sum.revenue)}</p>
          <p className="text-xs font-bold text-brand-muted">
            {sum.count} transaksi · rata-rata {fmtRp(sum.avg)}
          </p>
          {revDelta && cmp && (
            <p className={`mt-0.5 text-xs font-extrabold ${revDelta.pct > 0 ? 'text-brand-ink' : revDelta.pct < 0 ? 'text-brand-redtext' : 'text-brand-muted'}`}>
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
      )}

      {/* ===== Perlu tindakan: satu kolom kartu aksi urut urgensi ===== */}
      {widgets.has('actions') && (pendingOrders > 0 || lowStock.length > 0 || oilAlert.length > 0) && (
        <div className="card mb-3 p-3">
          <h2 className="mb-2 font-extrabold">Perlu tindakan</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {pendingOrders > 0 && (
              <Link to="/pesanan" className="flex items-center gap-2.5 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3 hover:border-brand-btn">
                <span className="chip h-7 bg-brand-gold px-2 text-sm">{pendingOrders}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">Pesanan online menunggu</span>
                  <span className="block text-xs text-brand-muted">verifikasi / proses sekarang</span>
                </span>
                <span className="text-xs font-extrabold text-brand-btn">Proses →</span>
              </Link>
            )}
            {lowStock.length > 0 && (
              <Link to="/stok" className="flex items-center gap-2.5 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3 hover:border-brand-btn">
                <span className="chip h-7 bg-brand-redtext px-2 text-sm text-white">{lowStock.length}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">Bahan di bawah minimum</span>
                  <span className="block truncate text-xs text-brand-muted">{lowStock.slice(0, 3).map((i) => i.name).join(' · ')}</span>
                </span>
                <span className="text-xs font-extrabold text-brand-btn">Stok →</span>
              </Link>
            )}
            {oilAlert.length > 0 && (
              <Link to="/produksi" className="flex items-center gap-2.5 rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3 hover:border-brand-btn">
                <span className="chip h-7 bg-brand-gold px-2 text-sm">🍟</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">{oilAlert.length} fryer wajib ganti minyak</span>
                  <span className="block text-xs text-brand-muted">batas {settings.oil.max_days} hari / {settings.oil.max_fry_count} gorengan</span>
                </span>
                <span className="text-xs font-extrabold text-brand-btn">Cek →</span>
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Peringatan resep rusak: bahan nonaktif masih dipakai resep — taruh paling atas grid supaya terlihat */}
        {widgets.has('recipeIssues') && recipeIssues.length > 0 && (
          <div className="card strip p-3 lg:col-span-3" style={{ borderColor: 'var(--c-redtext)' }}>
            <h2 className="mb-1 font-extrabold">⚠ Resep memakai bahan nonaktif</h2>
            <p className="mb-2 text-xs font-bold text-brand-muted">
              HPP &amp; ketersediaan menu ini bisa melompat / batch produksi bisa gagal. Aktifkan lagi bahan di halaman Bahan, atau ganti komponen resepnya.
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {recipeIssues.map((x) => (
                <li key={x.ingredientId} className="rounded-lg bg-brand-paper px-3 py-2">
                  <b>{x.name}</b>
                  {x.products.length > 0 && (
                    <span className="text-brand-muted"> — dipakai menu: {x.products.map((p) => p.name).join(', ')}</span>
                  )}
                  {x.preparedUsedBy.length > 0 && (
                    <span className="text-brand-muted"> — dipakai resep produksi: {x.preparedUsedBy.map((p) => p.name).join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
            <Link to="/bahan" className="btn-ghost mt-2 !min-h-0 !py-1.5 inline-flex text-xs">Periksa di Bahan Baku →</Link>
          </div>
        )}

        {/* Tren harian sesuai periode */}
        {widgets.has('dailyTrend') && (
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
        )}

        {/* NEW: jumlah transaksi per hari */}
        {widgets.has('txPerDay') && (
          <div className="card p-3">
            <h2 className="mb-2 font-extrabold">Transaksi per hari · {label}</h2>
            {txPerDay.every((d) => d.trx === 0) ? (
              <p className="py-10 text-center text-sm text-brand-muted">Belum ada transaksi pada periode ini.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={txPerDay} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid stroke="#e8d9cd" vertical={false} />
                    <XAxis dataKey="hari" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} width={32} />
                    <Tooltip formatter={(v: number) => `${v} transaksi`} />
                    <Bar dataKey="trx" name="Transaksi" fill="#8a5a44" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Mix channel sesuai periode */}
        {widgets.has('channelMix') && (
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
        )}

        {/* ===== Pindahan Laporan: tabel penerimaan per channel (bersih) ===== */}
        {widgets.has('channelTable') && (
        <div className="card p-3 lg:col-span-2">
          <h2 className="mb-2 font-extrabold">Penerimaan per channel · {label}</h2>
          {chans.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-muted">Belum ada penjualan pada periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="text-right">Omzet</th>
                    <th className="text-right">Komisi</th>
                    <th className="text-right">Bersih</th>
                    <th className="text-right">Trx</th>
                  </tr>
                </thead>
                <tbody>
                  {chans.map((c) => (
                    <tr key={c.key}>
                      <td className="font-bold">{CHAN_LABEL[c.key] ?? c.key}</td>
                      <td className="text-right tabular-nums">{fmtRpPlain(c.revenue)}</td>
                      <td className="text-right tabular-nums text-brand-muted">{c.fee > 0 ? `-${fmtRpPlain(c.fee)}` : '—'}</td>
                      <td className="text-right font-extrabold tabular-nums">{fmtRpPlain(c.revenue - c.fee)}</td>
                      <td className="text-right tabular-nums">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-brand-muted">Bersih = omzet − komisi channel. Beban tetap bulanan {fmtRp(settings.fixed_costs.reduce((s, f) => s + f.amount, 0))} tidak dihitung di sini; lihat Keuangan.</p>
        </div>
        )}

        {/* Terlaris */}
        {widgets.has('topItems') && (
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
        )}

        {/* NEW: omzet per kategori (donat) */}
        {widgets.has('catMix') && (
          <div className="card p-3">
            <h2 className="mb-2 font-extrabold">Omzet per kategori · {label}</h2>
            {catMix.length === 0 ? (
              <p className="py-10 text-center text-sm text-brand-muted">Belum ada penjualan pada periode ini.</p>
            ) : (
              <>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={catMix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                        {catMix.map((c, i) => (
                          <Cell key={c.name} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtRp(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-1 text-xs font-bold">
                  {catMix.map((c, i) => (
                    <li key={c.name}>
                      <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: pieColors[i % pieColors.length] }} />
                      {c.name}: {fmtRp(c.value)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Jam sibuk */}
        {widgets.has('busyHours') && (
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
        )}

        {/* NEW: rata-rata nota per hari (line) */}
        {widgets.has('avgTicket') && (
          <div className="card p-3">
            <h2 className="mb-2 font-extrabold">Rata-rata nota harian · {label}</h2>
            {avgTicket.every((d) => d.avg === 0) ? (
              <p className="py-10 text-center text-sm text-brand-muted">Belum ada transaksi pada periode ini.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={avgTicket} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid stroke="#e8d9cd" vertical={false} />
                    <XAxis dataKey="hari" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v))} tickLine={false} width={44} />
                    <Tooltip formatter={(v: number) => fmtRp(v)} />
                    <Line type="monotone" dataKey="avg" name="Rata-rata nota" stroke="#f5a302" strokeWidth={2.5} dot={{ r: 3, fill: '#f5a302' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Metode pembayaran: uang di drawer vs QRIS/transfer */}
        {widgets.has('paymentMix') && (
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
        )}

        {/* Target vs aktual */}
        {widgets.has('targets') && (
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
        )}

        {/* ===== Pindahan Laporan: best seller vs target (tabel) ===== */}
        {widgets.has('bestSellers') && (
        <div className="card p-3 lg:col-span-2">
          <h2 className="mb-2 font-extrabold">Best seller vs target · {label}</h2>
          {bestSellers.length === 0 ? (
            <p className="py-6 text-center text-sm text-brand-muted">Belum ada penjualan pada periode ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Menu</th>
                    <th className="text-right">Terjual</th>
                    <th className="text-right">Target</th>
                    <th>Pencapaian</th>
                    <th className="text-right">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {bestSellers.map((b) => {
                    const pct = b.target > 0 ? Math.min(100, Math.round((b.qty / b.target) * 100)) : null
                    const sisa = b.sisa
                    return (
                      <tr key={b.name}>
                        <td className="font-bold">
                          {b.name}
                          {/* sisa porsi live dari resep × stok — kasir tahu mana yang hampir habis */}
                          {sisa !== null && (
                            <span
                              className={`chip ml-1.5 align-middle text-[10px] ${
                                sisa <= 0 ? 'bg-brand-redtext text-white' : sisa <= 5 ? 'bg-brand-gold' : 'bg-brand-gold/30'
                              }`}
                              title="Sisa porsi dari resep × stok bahan saat ini"
                            >
                              {sisa <= 0 ? 'habis' : `sisa ${sisa}`}
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{b.qty}</td>
                        <td className="text-right tabular-nums text-brand-muted">{b.target > 0 ? b.target : '—'}</td>
                        <td style={{ minWidth: 120 }}>
                          {pct === null ? (
                            <span className="text-xs text-brand-muted">tanpa target</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 flex-1 rounded border border-brand-line bg-brand-paper">
                                <div className={`h-full rounded ${pct >= 100 ? 'bg-brand-btn' : 'bg-brand-gold'}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                              </div>
                              <span className="w-10 text-right text-xs font-bold tabular-nums">{pct}%</span>
                            </div>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{fmtRpPlain(b.revenue)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {/* Omzet vs periode pembanding (sejajar hari kerja) */}
        {widgets.has('revCompare') && (
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Omzet vs periode lalu</h2>
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
        )}

        {/* ===== Tren stok bahan kritis 7 hari (estimasi dari resep) ===== */}
        {widgets.has('stockTrend') && stockTrend.length > 0 && (
          <div className="card p-3 lg:col-span-3">
            <h2 className="mb-2 font-extrabold">
              Stok bahan kritis — 7 hari <span className="text-xs font-bold text-brand-muted">(estimasi dari resep transaksi; garis putus = minimum)</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {stockTrend.map((t) => {
                const chipCls = t.habis ? 'bg-brand-redtext text-white' : 'bg-brand-gold'
                const stocks = t.points.map((p) => p.stock)
                const max = Math.max(...stocks, t.ingredient.min_stock) || 1
                const minY = Math.min(...stocks, 0)
                const linePts = t.points.map((p, i) => `${(i / Math.max(1, t.points.length - 1)) * 100},${40 - ((p.stock - minY) / (max - minY || 1)) * 36}`).join(' ')
                const minLine = 40 - ((t.ingredient.min_stock - minY) / (max - minY || 1)) * 36
                return (
                  <div key={t.ingredient.id} className="rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-extrabold">{t.ingredient.name}</p>
                      <span className={`chip shrink-0 ${chipCls}`}>
                        {fmtQty(t.ingredient.stock)} / min {fmtQty(t.ingredient.min_stock)} {t.ingredient.buy_unit}
                      </span>
                    </div>
                    <svg viewBox="0 0 100 44" className="mt-1 h-12 w-full" preserveAspectRatio="none" aria-hidden>
                      {t.ingredient.min_stock > 0 && <line x1="0" y1={minLine} x2="100" y2={minLine} stroke="#e8d9cd" strokeWidth="1" strokeDasharray="3 2" />}
                      <polyline points={linePts} fill="none" stroke={t.habis ? '#a31217' : '#8a6400'} strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <p className="mt-1 text-xs font-bold text-brand-muted">
                      {t.daysLeft === Infinity
                        ? 'belum terpakai minggu ini'
                        : t.daysLeft <= 0
                          ? 'habis — catat pembelian sekarang'
                          : `habis ±${Math.floor(t.daysLeft)} hari pada ritme ini`}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Stok siap jual (hasil produksi) + ide menu baru dari stok */}
        {widgets.has('preparedStock') && (
        <div className="card p-3">
          <h2 className="mb-2 font-extrabold">Stok siap jual</h2>
          {preparedStock.length === 0 ? (
            <p className="text-sm text-brand-muted">Belum ada bahan setengah jadi. Hasil batch produksi tampil di sini.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {preparedStock.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-brand-paper px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-bold">{i.name}</span>
                  <span className="shrink-0 text-base font-extrabold tabular-nums">
                    {fmtQty(i.stock)} <span className="text-[10px] font-bold text-brand-muted">{i.buy_unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/produksi" className="mt-2 inline-flex text-xs font-extrabold text-brand-btn">Ke Produksi →</Link>
        </div>
        )}

        {widgets.has('ideas') && (
        <div className="card p-3 lg:col-span-2">
          <h2 className="mb-1 font-extrabold">Ide menu paket</h2>
          <p className="mb-2 text-xs font-bold text-brand-muted">
            Kombinasi menu yang sudah ada → harga bundling diskon {ideas[0]?.discountPct ?? 10}% + HPP gabungan. Satu klik jadi menu & resep (komponen paket, bahan utama saja).
          </p>
          {ideas.length === 0 ? (
            <p className="text-sm text-brand-muted">Belum ada kombinasi layak — pastikan ada minimal 2 menu aktif yang tersedia (stok resep masih ada).</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ideas.map((idea) => (
                <li key={idea.name} className="rounded-lg border-[1.5px] border-brand-line bg-brand-paper p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <span className="text-sm font-extrabold">{idea.name}</span>
                    <span className="text-base font-extrabold tabular-nums">{fmtRp(idea.suggestedPrice)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-bold text-brand-muted">
                    Normal {fmtRp(idea.normalTotal)} · HPP {fmtRp(idea.hpp)} · margin {idea.marginPct.toFixed(0)}% · cukup untuk {idea.maxPortions} paket
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-primary !min-h-0 !py-1.5 text-xs"
                      disabled={creatingIdea !== null}
                      onClick={() => void createBundle(idea)}
                    >
                      {creatingIdea === idea.name ? 'Membuat…' : '＋ Jadikan Menu'}
                    </button>
                    <span className="text-[10px] font-bold text-brand-muted">menu baru + resep {idea.items.length} komponen terpasang otomatis</span>
                  </div>              </li>
            ))}
            </ul>
          )}
        </div>
        )}

        {/* Peringatan stok: kartu per bahan, habis didahulukan */}
        {widgets.has('lowStock') && (
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
        )}
      </div>
    </div>
  )
}
