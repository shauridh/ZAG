// Mesin filter & agregasi utk halaman Laporan Detail.
// Prinsip: SEMUA filter dihitung di klien dari data yang sama dengan Dashboard
// (loadTransactions rentang tanggal), supaya angka selalu konsisten antar halaman.
import type { Transaction } from './types'
import { totalsOf } from './reports'
import { localDateISO } from './dates'

/** ISO tanggal dari Date, zona lokal (bukan UTC — jam 07.00 WIB bergeser sehari). */
function isoOf(d: Date): string {
  return localDateISO(d)
}

/** Rentang preset waktu + kustom (sama semantiknya dg Dashboard). */
export type DetailPeriod = 'today' | 'yesterday' | 'week7' | 'month' | 'all' | 'custom'

export interface DetailFilters {
  period: DetailPeriod
  /** utk period 'custom': ISO tanggal awal & akhir (inklusif) */
  customFrom: string
  customTo: string
  /** channel kosong = semua */
  channel: string
  /** metode bayar kosong = semua; nota dianggap cocok bila MEMILIKI payment metode itu */
  method: string
  /** status kosong = semua yang tampak (normal+refund) */
  status: '' | 'normal' | 'refund'
  /** id menu kosong = semua; nota cocok bila memuat menu ini */
  productId: number | null
  /** id kategori kosong = semua; nota cocok bila memuat menu dari kategori ini */
  categoryId: number | null
  /** shift kosong = semua */
  shiftId: number | null
  /** cari nomor nota (case-insensitive, substring) */
  q: string
}

export const CHANNELS: { key: string; label: string }[] = [
  { key: 'dinein', label: 'Makan di tempat' },
  { key: 'takeaway', label: 'Bungkus' },
  { key: 'gofood', label: 'GoFood' },
  { key: 'grabfood', label: 'GrabFood' },
  { key: 'shopeefood', label: 'ShopeeFood' },
  { key: 'delivery', label: 'Delivery sendiri' }
]

export const METHODS: { key: string; label: string }[] = [
  { key: 'cash', label: 'Tunai' },
  { key: 'qris', label: 'QRIS' },
  { key: 'transfer', label: 'Transfer' }
]

/** Rentang [fromISO, toISO] hari kalender — sama rumusnya dengan Dashboard. */
export function detailRangeOf(f: Pick<DetailFilters, 'period' | 'customFrom' | 'customTo'>, today: string): { from: string; to: string } {
  switch (f.period) {
    case 'today': return { from: today, to: today }
    case 'yesterday': {
      const d = new Date(today + 'T00:00:00')
      d.setDate(d.getDate() - 1)
      const iso = isoOf(d)
      return { from: iso, to: iso }
    }
    case 'week7': {
      const d = new Date(today + 'T00:00:00')
      d.setDate(d.getDate() - 6)
      return { from: isoOf(d), to: today }
    }
    case 'month': return { from: today.slice(0, 8) + '01', to: today }
    case 'all': return { from: '2000-01-01', to: today }
    case 'custom': return { from: f.customFrom || today, to: f.customTo || f.customFrom || today }
  }
}

interface MatchCtx {
  /** nama menu per id (resolve item nota yang hanya menyimpan nama) */
  productName: (name: string) => number | null
  /** kategori per nama menu */
  productCategory: (name: string) => number | null
}

/** Satu transaksi lolos filter? (semua kondisi AND) */
function matches(
  t: Transaction,
  f: DetailFilters,
  range: { from: string; to: string },
  ctx: MatchCtx
): boolean {
  const iso = localDateISO(t.created_at)
  if (iso < range.from || iso > range.to) return false
  if (f.channel && t.order_type !== f.channel) return false
  if (f.method && !(t.payments ?? []).some((p) => p.method === f.method)) return false
  const st = t.status ?? 'normal'
  if (f.status === 'normal' && st !== 'normal') return false
  if (f.status === 'refund' && st !== 'refund') return false
  if (f.shiftId != null && t.shift_id !== f.shiftId) return false
  if (f.q && !(t.receipt_no ?? String(t.id)).toLowerCase().includes(f.q.toLowerCase())) return false
  if (f.productId != null) {
    const hit = (t.items ?? []).some((i) => ctx.productName(i.name) === f.productId)
    if (!hit) return false
  }
  if (f.categoryId != null) {
    const hit = (t.items ?? []).some((i) => ctx.productCategory(i.name) === f.categoryId)
    if (!hit) return false
  }
  return true
}

export interface DetailRow {
  tx: Transaction
  /** qty baris ter-filter saja (kosong bila filter menu/kategori tidak aktif) */
  scopedItems: { name: string; qty: number; price: number }[] | null
  /** total ter-filter: porsi nota yg berasal dari menu/kategori ter-filter */
  scopedTotal: number
}

export interface DetailResult {
  rows: DetailRow[]
  /** ringkasan seluruh nota lolos filter (nota utuh, utk konsistensi dgn Dashboard) */
  totals: ReturnType<typeof totalsOf>
  /** omzet ter-filter: scopedTotal bila filter menu/kategori aktif, else total nota */
  filteredRevenue: number
  filteredCount: number
}

/** Terapkan filter ke daftar transaksi; urut terbaru dulu. */
export function applyDetailFilters(
  txs: Transaction[],
  f: DetailFilters,
  range: { from: string; to: string },
  nameToId: Map<string, number>,
  idToCategory: Map<number, number | null>
): DetailResult {
  const ctx: MatchCtx = {
    productName: (n) => nameToId.get(n) ?? null,
    productCategory: (n) => {
      const pid = nameToId.get(n)
      return pid != null ? (idToCategory.get(pid) ?? null) : null
    }
  }
  const scoped = f.productId != null || f.categoryId != null
  const rows: DetailRow[] = []
  for (const t of [...txs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!matches(t, f, range, ctx)) continue
    let scopedItems: DetailRow['scopedItems'] = null
    let scopedTotal = t.total
    if (scoped) {
      scopedItems = (t.items ?? [])
        .filter((i) => {
          const pid = ctx.productName(i.name)
          if (f.productId != null && pid !== f.productId) return false
          if (f.categoryId != null && ctx.productCategory(i.name) !== f.categoryId) return false
          return true
        })
        .map((i) => ({ name: i.name, qty: i.qty, price: i.price }))
      scopedTotal = (scopedItems ?? []).reduce((s, i) => s + i.qty * i.price, 0)
    }
    rows.push({ tx: t, scopedItems, scopedTotal })
  }
  const passing = rows.map((r) => r.tx)
  const totals = totalsOf(passing)
  const filteredRevenue = scoped ? rows.reduce((s, r) => s + r.scopedTotal, 0) : totals.revenue
  return { rows, totals, filteredRevenue, filteredCount: rows.length }
}

/** Baris CSV laporan detail: satu baris per nota ter-filter. */
export function detailCsv(rows: DetailRow[], scoped: boolean): (string | number)[][] {
  const head = scoped
    ? ['Nota', 'Tanggal', 'Jam', 'Channel', 'Metode', 'Status', 'Menu (ter-filter)', 'Qty', 'Subtotal ter-filter', 'Total nota']
    : ['Nota', 'Tanggal', 'Jam', 'Channel', 'Metode', 'Status', 'Total']
  const out: (string | number)[][] = [head]
  for (const r of rows) {
    const t = r.tx
    const date = localDateISO(t.created_at)
    const time = t.created_at.slice(11, 16)
    const channel = t.order_type
    const method = (t.payments ?? []).map((p) => p.method).join('+') || '-'
    const st = t.status ?? 'normal'
    if (scoped && r.scopedItems) {
      for (const it of r.scopedItems) {
        out.push([t.receipt_no ?? `#${t.id}`, date, time, channel, method, st, it.name, it.qty, it.qty * it.price, t.total])
      }
    } else {
      out.push([t.receipt_no ?? `#${t.id}`, date, time, channel, method, st, t.total])
    }
  }
  return out
}
