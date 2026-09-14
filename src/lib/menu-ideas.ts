import type { Catalog } from './db'
import type { Ingredient, RecipeItem } from './types'
import { hppLines, hppTotal, maxAvailableQty, type IngById } from './hpp'

/**
 * Dua analisis master-data dari satu katalog:
 *
 * 1. auditRecipeHealth — bahan NONAKTIF yang masih dipakai di resep produk /
 *    resep produksi. Tanpa ini, resep bisa diam-diam rusak: HPP berubah,
 *    ketersediaan menu melompat, batch produksi gagal, tanpa ada yang tahu
 *    penyebabnya.
 *
 * 2. bundleIdeas — ide MENU PAKET (kombinasi menu yang SUDAH ADA): pasangan /
 *    trio menu dengan harga bundling diskon, HPP gabungan nyata, sisa porsi
 *    gabungan, dan skor kelayakan. Bukan ide dari bahan mentah — melainkan
 *    "menu A + menu B + menu C dijual satu paket".
 */

export interface RecipeHealthIssue {
  /** id bahan nonaktif */
  ingredientId: number
  name: string
  /** menu yang resepnya memakai bahan ini (nama + id) */
  products: { id: number; name: string }[]
  /** bahan prepared yang resep produksinya memakai bahan ini */
  preparedUsedBy: { id: number; name: string }[]
}

/** Kumpulkan bahan nonaktif yang masih direferensikan resep mana pun. */
export function auditRecipeHealth(catalog: Catalog): RecipeHealthIssue[] {
  const byId = new Map<number, Ingredient>(catalog.ingredients.map((i) => [i.id, i]))
  const issues = new Map<number, RecipeHealthIssue>()
  const touch = (iid: number): RecipeHealthIssue => {
    let x = issues.get(iid)
    if (!x) {
      const ing = byId.get(iid)
      x = { ingredientId: iid, name: ing?.name ?? `#${iid}`, products: [], preparedUsedBy: [] }
      issues.set(iid, x)
    }
    return x
  }

  for (const r of catalog.recipeByProduct.values()) {
    for (const line of r) {
      if (line.kind !== 'ingredient') continue
      const ing = byId.get(line.component_id)
      // hanya bahan yang benar-benar nonaktif yang jadi masalah
      if (!ing || ing.active) continue
      const productId = line.product_id
      const p = catalog.products.find((x) => x.id === productId)
      const issue = touch(line.component_id)
      if (!issue.products.some((x) => x.id === productId)) {
        issue.products.push({ id: productId, name: p?.name ?? `#${productId}` })
      }
    }
  }
  for (const [preparedId, lines] of catalog.ingRecipes) {
    for (const line of lines) {
      const ing = byId.get(line.component_id)
      if (!ing || ing.active) continue
      const prepared = byId.get(preparedId)
      const issue = touch(line.component_id)
      if (!issue.preparedUsedBy.some((x) => x.id === preparedId)) {
        issue.preparedUsedBy.push({ id: preparedId, name: prepared?.name ?? `#${preparedId}` })
      }
    }
  }
  return [...issues.values()]
}

export interface BundleIdea {
  /** nama usulan: "Paket A + B (+ C)" — bebas diubah saat dijadikan menu */
  name: string
  /** menu penyusun paket (qty 1 per item) */
  items: { productId: number; name: string; price: number }[]
  /** total harga normal bila dibeli terpisah */
  normalTotal: number
  /** harga paket disarankan = total normal − diskon bundling, dibulatkan ke 500 */
  suggestedPrice: number
  /** diskon bundling % yang diterapkan */
  discountPct: number
  /** HPP gabungan dari resep semua menu penyusun */
  hpp: number
  /** margin % pada harga paket */
  marginPct: number
  /** porsi paket maksimum = sisa porsi menu penyusun yang paling sempit */
  maxPortions: number
  /** skor kelayakan: kombinasi lintas kategori + stok lega + harga ramah */
  score: number
}

const BUNDLE_DISCOUNT = 0.1 // diskon bundling 10% dari total normal
const MIN_MARGIN = 0.2 // paket dengan margin < 20% dibuang
const POOL_CAP = 8 // batasi pool supaya kombinasi tetap kecil & relevan

/**
 * Ide paket dari menu aktif yang tersedia (stok resep > 0). Kombinasi 2–3 menu
 * beda kategori lebih diutamakan (paket nasi + ayam + teh lebih masuk akal
 * daripada tiga minuman). Kombinasi yang sudah jadi paket aktif dilewati.
 */
export function bundleIdeas(catalog: Catalog, limit = 6): BundleIdea[] {
  const ingById: IngById = new Map(catalog.ingredients.map((i) => [i.id, i]))
  const round500 = (n: number): number => Math.max(1000, Math.round(n / 500) * 500)
  const availOf = (pid: number): number => maxAvailableQty(pid, catalog.recipeByProduct, ingById)
  const hppOf = (pid: number): number =>
    hppTotal(hppLines(pid, catalog.recipeByProduct, catalog.ingRecipes, ingById))

  // Hanya menu DAUN yang boleh jadi komponen paket: resepnya bahan, bukan produk.
  // Tanpa ini, menu paket yang baru dibuat ikut jadi bahan paket baru (paket-dari-paket).
  const isLeaf = (pid: number): boolean => {
    const lines = catalog.recipeByProduct.get(pid)
    return !lines || lines.every((l) => l.kind === 'ingredient')
  }
  // pool: menu aktif berharga, tersedia, punya HPP terhitung, dan bukan paket
  const pool = catalog.products
    .filter((p) => p.is_active && p.price > 0 && availOf(p.id) > 0 && isLeaf(p.id))
    .sort((a, b) => availOf(b.id) - availOf(a.id))
    .slice(0, POOL_CAP)
  if (pool.length < 2) return []

  // set item paket aktif yang sudah ada → kombinasi identik dilewati
  const existingSets = catalog.bundles
    .filter((b) => b.is_active)
    .map((b) => new Set((b.items ?? []).map((i) => i.product_id)))
  // Paket yang sudah dibuat lewat "Jadikan Menu" adalah PRODUK dengan resep
  // berisi komponen produk — bukan baris tabel bundles. Tanpa ini, kombinasi
  // yang sama terus diusulkan lagi setiap kali dashboard dimuat.
  for (const [pid, lines] of catalog.recipeByProduct) {
    if (!lines.some((l) => l.kind === 'product')) continue
    const prod = catalog.products.find((p) => p.id === pid)
    if (!prod || !prod.is_active) continue
    existingSets.push(new Set(lines.filter((l) => l.kind === 'product').map((l) => l.component_id)))
  }
  const isExisting = (ids: number[]): boolean =>
    existingSets.some((s) => s.size === ids.length && ids.every((id) => s.has(id)))

  const ideas: BundleIdea[] = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const build = (k = -1): void => {
        const picks = k >= 0 ? [pool[i], pool[j], pool[k]] : [pool[i], pool[j]]
        const ids = picks.map((p) => p.id)
        if (isExisting(ids)) return
        const normalTotal = picks.reduce((s, p) => s + p.price, 0)
        const hpp = picks.reduce((s, p) => s + hppOf(p.id), 0)
        const price = round500(normalTotal * (1 - BUNDLE_DISCOUNT))
        const margin = (price - hpp) / price
        if (hpp <= 0 || margin < MIN_MARGIN) return
        const maxPortions = Math.min(...picks.map((p) => availOf(p.id)))
        if (maxPortions < 1) return
        // paket menggabungkan kategori berbeda lebih menarik (lauk + nasi + minuman)
        const distinctCats = new Set(picks.map((p) => p.category_id ?? 0)).size
        const score =
          distinctCats * 8 +
          Math.log2(maxPortions + 1) * 4 +
          Math.max(0, 25 - price / 1000) +
          (picks.length - 2) * 2
        ideas.push({
          name: 'Paket ' + picks.map((p) => p.name).join(' + '),
          items: picks.map((p) => ({ productId: p.id, name: p.name, price: p.price })),
          normalTotal,
          suggestedPrice: price,
          discountPct: BUNDLE_DISCOUNT * 100,
          hpp,
          marginPct: margin * 100,
          maxPortions,
          score
        })
      }
      build()
      for (let k = j + 1; k < pool.length; k++) build(k)
    }
  }
  return ideas.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Baris resep utk menu paket baru: semua komponen sbg produk (bahan utama saja). */
export function bundleRecipeLines(
  productId: number,
  items: { productId: number; qty?: number }[]
): RecipeItem[] {
  return items.map((it) => ({ product_id: productId, kind: 'product' as const, component_id: it.productId, qty: it.qty ?? 1 }))
}
