import type { Ingredient, RecipeItem, IngredientRecipe } from './types'
import { fmtQty } from './money'

export interface HppLine {
  ingredientId: number
  name: string
  qty: number
  buyUnit: string
  packContent: number
  unitCost: number // harga per satuan beli
  cost: number // qty * harga per satuan dasar
}

export type IngById = Map<number, Ingredient>
/** Pemanggil kalkulus resep kadang hanya punya bahan terpotong (forecast); yang dipakai hanya id & kind. */
export type IngKindById = Map<number, Pick<Ingredient, 'id' | 'kind'>>
export type RecipeByProduct = Map<number, RecipeItem[]>
export type IngRecipeBy = Map<number, IngredientRecipe[]>

/**
 * Kebutuhan bahan mentah untuk qty unit produk. Resep produk boleh
 * menyusun produk lain (mis. Chicken Bun memakai Ayam Sayap), jadi
 * ekspansi rekursif dengan penghitung kedalaman untuk cek siklus.
 */
export function productNeeds(
  productId: number,
  qty: number,
  recipeByProduct: RecipeByProduct,
  ings: IngKindById
): Map<number, number> {
  const out = new Map<number, number>()
  const visit = (pid: number, q: number, depth: number) => {
    if (depth > 20) throw new Error('Resep bersarang terlalu dalam (kemungkinan siklus)')
    for (const r of recipeByProduct.get(pid) ?? []) {
      const need = q * r.qty
      if (r.kind === 'product') {
        visit(r.component_id, need, depth + 1)
      } else {
        out.set(r.component_id, (out.get(r.component_id) ?? 0) + need)
      }
    }
    // komponen produk yang tidak punya resep sama sekali diabaikan
    if (recipeByProduct.get(pid) === undefined && !ings.has(pid)) {
      // tidak error: produk tanpa resep dianggap tanpa komponen
    }
  }
  visit(productId, qty, 0)
  return out
}

/** Kebutuhan bahan mentah untuk memproduksi qty unit bahan prepared. */
export function ingredientNeeds(
  ingredientId: number,
  qty: number,
  ingRecipes: IngRecipeBy
): Map<number, number> {
  const out = new Map<number, number>()
  const visit = (iid: number, q: number, depth: number) => {
    const rec = ingRecipes.get(iid)
    if (!rec || rec.length === 0) {
      out.set(iid, (out.get(iid) ?? 0) + q)
      return
    }
    if (depth > 20) throw new Error('Resep produksi bersarang terlalu dalam')
    for (const r of rec) visit(r.component_id, q * r.qty, depth + 1)
  }
  visit(ingredientId, qty, 0)
  return out
}

/** Rincian HPP untuk 1 unit produk (tiap baris = bahan mentah). */
export function hppLines(
  productId: number,
  recipeByProduct: RecipeByProduct,
  ingRecipes: IngRecipeBy,
  ings: IngById
): HppLine[] {
  // Bahan prepared (mis. Sambal Geprek) diekspansi lagi ke bahan mentahnya
  // supaya HPP = biaya bahan dasar, persis struktur Excel.
  const raw = rawProductNeeds(productId, 1, recipeByProduct, ingRecipes, ings)
  const lines: HppLine[] = []
  for (const [iid, qty] of raw) {
    const ing = ings.get(iid)
    if (!ing) continue
    // price sudah per satuan dasar (potong/cup/liter/kg); konversi dari
    // harga kemasan terjadi saat pembelian (unit_cost / pack_content).
    lines.push({
      ingredientId: iid,
      name: ing.name,
      qty,
      buyUnit: ing.buy_unit,
      packContent: ing.pack_content || 1,
      unitCost: ing.price,
      cost: qty * ing.price
    })
  }
  return lines.sort((a, b) => b.cost - a.cost)
}

export function hppTotal(lines: HppLine[]): number {
  return lines.reduce((s, l) => s + l.cost, 0)
}

/** Biaya bahan untuk memproduksi 1 unit bahan prepared. */
export function preparedCost(
  ingredientId: number,
  ingRecipes: IngRecipeBy,
  ings: IngById
): number {
  const needs = ingredientNeeds(ingredientId, 1, ingRecipes)
  let total = 0
  for (const [iid, qty] of needs) {
    const ing = ings.get(iid)
    if (ing) total += qty * ing.price
  }
  return total
}

export function maxAvailableQty(
  productId: number,
  recipeByProduct: RecipeByProduct,
  ings: IngById
): number {
  const needs = productNeeds(productId, 1, recipeByProduct, ings)
  let max = Infinity
  for (const [iid, qty] of needs) {
    const ing = ings.get(iid)
    if (!ing) continue
    max = Math.min(max, Math.floor((ing.stock / qty) * 1000) / 1000)
  }
  return max === Infinity ? 999 : Math.max(0, Math.floor(max))
}

export function marginPct(price: number, hpp: number): number {
  if (price <= 0) return 0
  return ((price - hpp) / price) * 100
}

/**
 * Satuan kecil bahan: hasil konversi isi kemasan (mis. pack isi 9 potong -> 'potong').
 * Dipakai resep langsung. Kosong/null = sama dengan satuan beli.
 */
export function smallUnitOf(i: Pick<Ingredient, 'buy_unit' | 'small_unit' | 'pack_content'>): string {
  const s = (i.small_unit ?? '').trim()
  return s || i.buy_unit
}

/** Harga per 1 kemasan utuh = harga per satuan dasar × isi kemasan (untuk tampilan ala price list). */
export function packPriceOf(i: Pick<Ingredient, 'price' | 'pack_content'>): number {
  return Math.round(i.price * (i.pack_content || 1))
}

export const fmtHppQty = (l: HppLine): string =>
  `${fmtQty(l.qty)} ${l.buyUnit}${l.packContent > 1 ? ` (1 ${l.buyUnit} = ${fmtQty(l.packContent)})` : ''}`

/** Indeks bahan berdasar id — derivasi katalog yang sebelumnya ditulis ulang di 9 halaman/modul. */
export function ingIndex(ings: Ingredient[]): IngById {
  return new Map(ings.map((i) => [i.id, i]))
}

/** Kelompokkan baris resep menurut produk — satu struktur RecipeByProduct untuk semua pemanggil. */
export function recipeIndexBy(rows: RecipeItem[]): RecipeByProduct {
  const out = new Map<number, RecipeItem[]>()
  for (const r of rows) {
    const arr = out.get(r.product_id) ?? []
    arr.push(r)
    out.set(r.product_id, arr)
  }
  return out
}

/** Kelompokkan resep produksi menurut bahan — satu struktur IngRecipeBy untuk semua pemanggil. */
export function ingRecipeIndexBy(rows: IngredientRecipe[]): IngRecipeBy {
  const out = new Map<number, IngredientRecipe[]>()
  for (const r of rows) {
    const arr = out.get(r.ingredient_id) ?? []
    arr.push(r)
    out.set(r.ingredient_id, arr)
  }
  return out
}

/**
 * Kebutuhan bahan MENTAH total untuk qty unit produk: resep produk diurai
 * (termasuk produk setengah jadi), lalu bahan prepared diurai lagi ke bahan
 * mentahnya. Inilah satu tempat aturan "produk → bahan mentah"; dipakai HPP
 * nota, ketersediaan kasir, forecast belanja, dan tren stok supaya aturan
 * resep tidak pernah ditulis ulang di pemanggil.
 */
export function rawProductNeeds(
  productId: number,
  qty: number,
  recipeByProduct: RecipeByProduct,
  ingRecipes: IngRecipeBy,
  ings: IngKindById
): Map<number, number> {
  const out = new Map<number, number>()
  for (const [iid, need] of productNeeds(productId, qty, recipeByProduct, ings)) {
    const ing = ings.get(iid)
    if (!ing) continue
    if (ing.kind === 'prepared') {
      for (const [cid, cq] of ingredientNeeds(iid, need, ingRecipes)) {
        out.set(cid, (out.get(cid) ?? 0) + cq)
      }
    } else {
      out.set(iid, (out.get(iid) ?? 0) + need)
    }
  }
  return out
}

/**
 * Total biaya bahan MENTAH untuk qty unit produk: kebutuhan mentah × harga
 * per satuan dasar, dibulatkan per baris (aturan pembulatan nota).
 * Dipakai createTx & editTx supaya aturan biaya hanya ada di satu tempat.
 */
export function rawNeedsCost(
  productId: number,
  qty: number,
  recipeByProduct: RecipeByProduct,
  ingRecipes: IngRecipeBy,
  ings: IngById
): number {
  let total = 0
  for (const [iid, need] of rawProductNeeds(productId, qty, recipeByProduct, ingRecipes, ings)) {
    const ing = ings.get(iid)
    if (ing) total += Math.round(need * ing.price)
  }
  return total
}
