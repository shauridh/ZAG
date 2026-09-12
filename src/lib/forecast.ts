/**
 * Forecast pembelian bahan baku.
 *
 * Ide: dari transaksi historis kita tahu rata-rata pemakaian bahan per hari.
 * Untuk N hari ke depan, kebutuhan = pemakaian harian × N. Bandingkan dengan
 * stok sekarang → "belanja berapa" = kebutuhan − stok (per satuan beli).
 * Bahan prepared diekspansi ke bahan mentahnya (sambal cup → geprek+cup+minyak).
 *
 * Weekend-aware: rata-rata pemakaian dipisah hari kerja vs Sabtu/Minggu, dan
 * proyeksi dijumlahkan per hari kalender ke depan (bukan flat × N) supaya
 * horizon yang memuat lebih banyak weekend menghasilkan kebutuhan lebih besar.
 * Bila sampel weekend/kerja kurang dari 2 hari, profil itu jatuh ke rata-rata
 * keseluruhan (proyeksi kembali flat — jujur pada data yang ada).
 */
import type { Transaction } from './types'
import { rawProductNeeds, type RecipeByProduct, type IngRecipeBy } from './hpp'
import { fmtQty } from './money'

export interface BuySuggestion {
  ingredientId: number
  name: string
  /** rata-rata pemakaian per hari keseluruhan (satuan dasar) */
  dailyUse: number
  /** stok sekarang (satuan dasar) */
  stock: number
  /** kebutuhan N hari ke depan (satuan dasar, hasil proyeksi per kalender) */
  need: number
  /** kekurangan = kebutuhan − stok, dibulatkan ke atas per satuan beli */
  buyQty: number
  buyUnit: string
  /** estimasi biaya belanja bahan ini (Rp) */
  cost: number
  /** hari tersisa sebelum stok habis memakai rata-rata keseluruhan */
  daysLeft: number
}

export interface BuyPlan {
  days: number
  /** jumlah hari kalender historis yang dipakai sebagai dasar */
  daysWithSales: number
  /** rasio pemakaian weekend vs hari kerja (1 = data kurang / tidak beda) */
  weekendRatio: number
  items: BuySuggestion[]
  totalCost: number
}

type IngLite = { id: number; name: string; kind: 'raw' | 'prepared'; stock: number; buy_unit: string; pack_content: number; price: number }

/** tanggal ISO (hari) → product_id → qty terjual */
export type DailySales = Map<string, Map<number, number>>

const isWeekend = (iso: string): boolean => {
  const day = new Date(iso + 'T00:00:00').getDay()
  return day === 0 || day === 6
}

/** Ambil penjualan per produk per hari dari transaksi (item dicocokkan ke product_id via nama). */
export function dailySalesOf(
  txs: Transaction[],
  productIds: number[],
  productNames: Map<number, string>
): DailySales {
  const byName = new Map<string, number>()
  for (const p of productIds) byName.set(productNames.get(p) ?? '', p)
  const out: DailySales = new Map()
  for (const t of txs) {
    const iso = t.created_at.slice(0, 10)
    let day = out.get(iso)
    if (!day) {
      day = new Map()
      out.set(iso, day)
    }
    for (const it of t.items ?? []) {
      const pid = byName.get(it.name)
      if (pid === undefined) continue
      day.set(pid, (day.get(pid) ?? 0) + it.qty)
    }
  }
  return out
}

/**
 * Rasio rata-rata qty weekend vs hari kerja (level penjualan produk).
 * Return ratio 1 bila salah satu profil kurang dari 2 hari sampel.
 */
export function weekendRatioOf(daily: DailySales): { ratio: number; wkdayAvg: number; wkendAvg: number } {
  const wkday: number[] = []
  const wkend: number[] = []
  for (const [iso, prods] of daily) {
    const qty = [...prods.values()].reduce((s, x) => s + x, 0)
    if (isWeekend(iso)) wkend.push(qty)
    else wkday.push(qty)
  }
  const avg = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  const wkdayAvg = avg(wkday)
  const wkendAvg = avg(wkend)
  if (wkday.length < 2 || wkend.length < 2 || wkdayAvg <= 0) return { ratio: 1, wkdayAvg, wkendAvg }
  return { ratio: Math.min(3, Math.max(0.3, wkendAvg / wkdayAvg)), wkdayAvg, wkendAvg }
}

/**
 * Rencana belanja untuk `days` hari ke depan dari penjualan harian per produk
 * selama `coveredDays` hari kalender terakhir.
 */
export function buyPlanFromSales(
  daily: DailySales,
  days: number,
  coveredDays: number,
  ingredients: IngLite[],
  recipeByProduct: RecipeByProduct,
  ingRecipes: IngRecipeBy,
  /** basis kalender (default hari ini) — diinjeksikan agar test deterministik */
  base: Date = new Date()
): BuyPlan {
  // IngLite assignable ke IngKindById (rawProductNeeds hanya pakai id & kind);
  // map penuh tetap dipakai di bawah utk stok, harga, dan satuan beli.
  const ingById = new Map(ingredients.map((i) => [i.id, i]))

  // ekspansi resep: penjualan produk hari itu → pemakaian bahan mentah
  const expand = (daySales: Map<number, number>): Map<number, number> => {
    const used = new Map<number, number>()
    for (const [pid, soldQty] of daySales) {
      for (const [iid, q] of rawProductNeeds(pid, soldQty, recipeByProduct, ingRecipes, ingById)) {
        used.set(iid, (used.get(iid) ?? 0) + q)
      }
    }
    return used
  }

  // pemakaian per hari kalender dalam rentang historis (hari tanpa jualan = 0)
  const span = Math.max(1, coveredDays)
  const perDay: { iso: string; weekend: boolean; used: Map<number, number> }[] = []
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    perDay.push({ iso, weekend: isWeekend(iso), used: expand(daily.get(iso) ?? new Map()) })
  }

  // agregat: total, dan rata-rata per profil hari
  const total = new Map<number, number>()
  const wkdaySum = new Map<number, number>()
  const wkendSum = new Map<number, number>()
  let nWkday = 0
  let nWkend = 0
  for (const d of perDay) {
    for (const [iid, q] of d.used) {
      total.set(iid, (total.get(iid) ?? 0) + q)
      if (d.weekend) wkendSum.set(iid, (wkendSum.get(iid) ?? 0) + q)
      else wkdaySum.set(iid, (wkdaySum.get(iid) ?? 0) + q)
    }
    if (d.weekend) nWkend++
    else nWkday++
  }
  const avgOf = (m: Map<number, number>, n: number) => {
    const out = new Map<number, number>()
    for (const [iid, q] of m) out.set(iid, q / Math.max(1, n))
    return out
  }
  const overallAvg = avgOf(total, span)
  const wkdayAvg = avgOf(wkdaySum, Math.max(1, nWkday))
  const wkendAvg = avgOf(wkendSum, Math.max(1, nWkend))

  // proyeksi per hari kalender ke depan; profil tanpa cukup sampel pakai rata-rata umum
  const enoughWkday = nWkday >= 2
  const enoughWkend = nWkend >= 2
  const profileOf = (weekend: boolean): Map<number, number> =>
    weekend && enoughWkend ? wkendAvg : !weekend && enoughWkday ? wkdayAvg : overallAvg

  const need = new Map<number, number>()
  for (let i = 1; i <= days; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    const iso = d.toISOString().slice(0, 10)
    const prof = profileOf(isWeekend(iso))
    for (const [iid, q] of prof) need.set(iid, (need.get(iid) ?? 0) + q)
  }

  const items: BuySuggestion[] = []
  for (const [iid, needQty] of need) {
    const ing = ingById.get(iid)
    if (!ing || needQty <= 0) continue
    const buyBase = needQty - ing.stock
    if (buyBase <= 0) continue
    const pack = ing.pack_content > 0 ? ing.pack_content : 1
    const buyQty = Math.ceil(buyBase / pack)
    const dailyUse = overallAvg.get(iid) ?? 0
    items.push({
      ingredientId: iid,
      name: ing.name,
      dailyUse,
      stock: ing.stock,
      need: needQty,
      buyQty,
      buyUnit: ing.buy_unit,
      cost: buyQty * pack * ing.price,
      daysLeft: dailyUse > 0 ? ing.stock / dailyUse : Infinity
    })
  }
  items.sort((a, b) => b.cost - a.cost)

  const wr = weekendRatioOf(daily)
  return {
    days,
    daysWithSales: span,
    weekendRatio: wr.ratio,
    items,
    totalCost: items.reduce((s, i) => s + i.cost, 0)
  }
}

/** Baris ringkas untuk teks WhatsApp: "• Tepung Bumbu: 2 pack (±Rp47.000)". */
export function buyPlanToText(plan: BuyPlan): string {
  const lines = plan.items.map(
    (i) => `• ${i.name}: ${fmtQty(i.buyQty)} ${i.buyUnit} (±Rp${Math.round(i.cost).toLocaleString('id-ID')})`
  )
  const wr =
    plan.weekendRatio !== 1
      ? ` (proyeksi weekend-aware, rasio akhir pekan ×${plan.weekendRatio.toFixed(1)})`
      : ''
  return (
    `Rencana belanja ${plan.days} hari (data ${plan.daysWithSales} hari terakhir)${wr}:\n` +
    lines.join('\n') +
    `\nTotal ±Rp${Math.round(plan.totalCost).toLocaleString('id-ID')}`
  )
}
