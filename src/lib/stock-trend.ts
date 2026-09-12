/**
 * Tren stok 7 hari untuk dashboard: rekonstruksi estimasi stok harian bahan
 * dari pemakaian resep transaksi (bahan yang terpakai saat jualan). Ini
 * estimasi pembukuan, bukan snapshot DB — pembelian/opname/waste manual di
 * luar transaksi tidak diketahui, jadi kartu grafik diberi label "estimasi".
 *
 * Titik terakhir deret = stok asli DB (angka yang benar-benar terlihat kasir),
 * hari-hari sebelumnya = stok asli + pemakaian yang sudah terjadi setelahnya.
 *
 * Return per bahan kritis (stock <= min_stock): titik stok estimasi per hari,
 * daysLeft dari pemakaian rata-rata harian, dan chip status.
 */
import type { Ingredient, Transaction } from './types'
import { rawProductNeeds, type RecipeByProduct, type IngRecipeBy } from './hpp'
import { localDateISO } from './dates'

export interface StockTrendPoint {
  iso: string
  /** label pendek utk tooltip/sumbu, mis. "5/9" */
  label: string
  stock: number
}

export interface StockTrend {
  ingredient: Ingredient
  points: StockTrendPoint[]
  /** rata-rata pemakaian satuan dasar per hari (hanya hari dengan transaksi dihitung) */
  dailyUse: number
  /** hari tersisa sebelum habis pada ritme pemakaian ini (Infinity = tidak pernah terpakai) */
  daysLeft: number
  habis: boolean
}

export function stockTrends(
  txs: Transaction[],
  ingredients: Ingredient[],
  recipeByProduct: RecipeByProduct,
  ingRecipes: IngRecipeBy,
  productIdsByName: Map<string, number>,
  days = 7
): StockTrend[] {
  const ingById = new Map(ingredients.map((i) => [i.id, i]))

  // pemakaian bahan mentah per hari kalender (produk → resep → bahan; prepared diekspansi)
  const usedPerDay = new Map<string, Map<number, number>>()
  for (const t of txs) {
    if ((t.status ?? 'normal') === 'batal') continue // nota batal: stok sudah dikembalikan
    const iso = localDateISO(t.created_at)
    const day = usedPerDay.get(iso) ?? new Map<number, number>()
    for (const item of t.items ?? []) {
      // items hanya menyimpan nama; pemetaan nama → product_id dari katalog
      const pid = productIdsByName.get(item.name)
      if (pid === undefined) continue
      for (const [iid, need] of rawProductNeeds(pid, item.qty, recipeByProduct, ingRecipes, ingById)) {
        day.set(iid, (day.get(iid) ?? 0) + need)
      }
    }
    if (day.size > 0) usedPerDay.set(iso, day)
  }

  // daftar bahan kritis: stok ≤ minimum (termasuk habis), hanya yang aktif
  const critical = ingredients
    .filter((i) => i.active && i.stock <= i.min_stock)
    .sort((a, b) => {
      const ra = a.stock <= 0 ? -1 : a.min_stock > 0 ? a.stock / a.min_stock : 0
      const rb = b.stock <= 0 ? -1 : b.min_stock > 0 ? b.stock / b.min_stock : 0
      return ra - rb
    })
    .slice(0, 6)

  const today = new Date()
  const out: StockTrend[] = []
  for (const ing of critical) {
    const points: StockTrendPoint[] = []
    let stock = ing.stock
    let usedOnSaleDays = 0
    let saleDays = 0
    // jalan mundur dari hari ini: stok kemarin = stok hari ini + pemakaian hari ini
    for (let i = 0; i < days; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const iso = localDateISO(d)
      points.unshift({
        iso,
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        stock: Math.round(stock * 1000) / 1000
      })
      const used = usedPerDay.get(iso)?.get(ing.id) ?? 0
      if (used > 0) {
        usedOnSaleDays += used
        saleDays++
      }
      stock += used
    }
    const dailyUse = saleDays > 0 ? usedOnSaleDays / Math.max(saleDays, 1) : 0
    out.push({
      ingredient: ing,
      points,
      dailyUse,
      daysLeft: dailyUse > 0 ? ing.stock / dailyUse : Infinity,
      habis: ing.stock <= 0
    })
  }
  return out
}

/**
 * Versi mudah dipakai dari React: pemanggil punya daftar transaksi + katalog.
 * Pemetaan nama item → product_id dibuat dari daftar produk katalog.
 */
export function stockTrendsFrom(
  txs: Transaction[],
  products: { id: number; name: string }[],
  ingredients: Ingredient[],
  recipeByProduct: RecipeByProduct,
  ingRecipes: IngRecipeBy,
  days = 7
): StockTrend[] {
  const byName = new Map(products.map((p) => [p.name, p.id]))
  return stockTrends(txs, ingredients, recipeByProduct, ingRecipes, byName, days)
}
