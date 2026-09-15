/**
 * Paket (combo) di kasir & pembuatan combo via wizard.
 *
 * Klik paket = keranjang diisi KOMPONEN-komponennya (bukan satu baris paket)
 * supaya checkout, stok, dan HPP 100% lewat jalur existing: setiap komponen
 * adalah produk asli yang resepnya sudah diekspansi productNeeds (JS & SQL).
 * "Hemat" paket dihitung (total komponen − harga paket) dan dikumpulkan
 * sebagai diskon — tanpa mengubah harga satuan komponen, jadi struk & laporan
 * tetap memakai harga normal per menu.
 */

export interface BundleLine {
  product_id: number
  name: string
  price: number
  qty: number
}

/** Baris keranjang hasil ekspansi paket: komponen + asal paketnya. */
export interface ExpandedCartLine {
  product_id: number
  name: string
  price: number
  qty: number
  via?: string
}

/** Total harga normal seluruh komponen paket (qty × harga satuan). */
export function bundleComponentTotal(items: { product_id: number; qty: number }[], productById: Map<number, { name: string; price: number }>): number {
  return items.reduce((s, it) => s + (productById.get(it.product_id)?.price ?? 0) * it.qty, 0)
}

/** Uang yang dihemat paket: total komponen − harga paket (≥ 0). */
export function bundleSavings(price: number, items: { product_id: number; qty: number }[], productById: Map<number, { name: string; price: number }>): number {
  return Math.max(0, bundleComponentTotal(items, productById) - price)
}

/**
 * Berapa paket bisa ditambah lagi: min(sisa komponen ÷ kebutuhan per paket).
 * maxOf = sisa porsi per produk dari resep × stok (sumber sama dengan kasir).
 */
export function bundleMaxQty(items: { product_id: number; qty: number }[], maxOf: (productId: number) => number): number {
  if (items.length === 0) return 0
  return Math.min(...items.map((it) => Math.floor(maxOf(it.product_id) / Math.max(it.qty, 0.0001))))
}

/** Ringkasan isi paket utk kartu kasir: "2× Paha Bawah + Nasi Putih + …". */
export function bundleSummary(items: { product_id: number; qty: number }[], productById: Map<number, { name: string; price: number }>, maxNames = 3): string {
  const names = items.map((it) => {
    const p = productById.get(it.product_id)
    const nm = p?.name ?? '?'
    return it.qty > 1 ? `${it.qty}× ${nm}` : nm
  })
  if (names.length <= maxNames) return names.join(' + ')
  return `${names.slice(0, maxNames).join(' + ')} +${names.length - maxNames} lain`
}

/**
 * Ekspansi qty paket jadi baris keranjang: setiap komponen × qty paket,
 * ditandai `via` (nama paket) supaya kasir tahu asal barisnya.
 * Menerima bundle (tab Paket Hemat) ATAU produk combo hasil wizard —
 * bentuk yang dipakai hanya nama + harga + daftar komponen.
 */
export function expandBundle(
  b: { name: string; items?: { product_id: number; qty: number }[] },
  paketQty: number
): ExpandedCartLine[] {
  return (b.items ?? []).map((it) => {
    // nama tidak ada di bundle_items — kasir mengisi dari produk; di sini fallback id
    return { product_id: it.product_id, name: `#${it.product_id}`, price: 0, qty: it.qty * paketQty, via: b.name }
  })
}

/**
 * Gabungkan baris baru ke keranjang existing: produk sama → qty dijumlah,
 * max yang dipakai = yang lebih longgar (paket menambah bukan mengganti).
 * Immutable: keranjang state React tidak pernah dimutasi langsung.
 */
export function mergeCartLines<T extends { product_id: number; name: string; qty: number; max: number }>(existing: T[], incoming: (T & { via?: string })[]): { lines: T[]; rejected: string[] } {
  const lines = existing.map((l) => ({ ...l })) as T[]
  const rejected: string[] = []
  for (const inc of incoming) {
    const idx = lines.findIndex((l) => l.product_id === inc.product_id)
    if (idx >= 0) {
      const found = lines[idx]
      if (found.qty + inc.qty > found.max) {
        rejected.push(inc.name)
        lines[idx] = { ...found, qty: found.max }
        continue
      }
      lines[idx] = { ...found, qty: found.qty + inc.qty }
      continue
    }
    lines.push({ ...inc, max: Math.max(inc.max, inc.qty) } as T)
  }
  return { lines, rejected }
}

/**
 * Pecah diskon (mis. hemat paket) pro-rata ke baris berdasarkan nilai, dalam
 * rupiah bulat: baris awal dibulatkan ke bawah, baris terakhir menampung
 * sisa — total diskon tepat, distribusi per menu adil utk laporan.
 */
export function splitDiscount(values: number[], discount: number): number[] {
  const total = values.reduce((s, v) => s + v, 0)
  if (total <= 0 || discount <= 0) return values.map(() => 0)
  const out = values.map((v) => Math.floor((v / total) * discount))
  const diff = discount - out.reduce((s, v) => s + v, 0)
  const lastIdx = out.length - 1
  if (lastIdx >= 0) out[lastIdx] += diff
  return out
}

/** Baris resep utk produk combo: komponen = menu penyusun (kind 'product'). */
export function comboRecipeLines(productId: number, items: { product_id: number; qty?: number }[]): { product_id: number; kind: 'product'; component_id: number; qty: number }[] {
  return items.map((it) => ({ product_id: productId, kind: 'product' as const, component_id: it.product_id, qty: it.qty ?? 1 }))
}
