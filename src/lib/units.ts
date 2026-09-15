import { fmtQty } from './money'

/**
 * Konversi satuan untuk input output batch produksi.
 * Konvensi aplikasi: STOK selalu disimpan dalam SATUAN KECIL (satuan jual/resep).
 * Mode 'buy' (satuan beli/kemasan) hanya cara INPUT dapur: angka dikali isi kemasan.
 */
export type UnitMode = 'small' | 'buy'

/** Angka yang diketik dapur → qty satuan kecil (disimpan ke stok/RPC). */
export function toSmallQty(qty: number, mode: UnitMode, packContent: number): number {
  if (mode === 'buy') return Math.round(qty * (packContent || 1) * 100) / 100
  return qty
}

/** Qty satuan kecil → angka yang ditampilkan di input sesuai mode (pembagian 3 desimal). */
export function fromSmallQty(smallQty: number, mode: UnitMode, packContent: number): number {
  if (mode === 'buy' && packContent > 1) return Math.round((smallQty / packContent) * 1000) / 1000
  return smallQty
}

/**
 * Peringatan komposisi tidak cocok: total pack_breakdown ≠ isi kemasan.
 * Dapur harus tahu SEBELUM simpan batch — kalau komposisi salah, rincian
 * sayap/paha/dada yang tampil di kasir ikut salah.
 */
export function breakdownMismatch(
  breakdown: { qty: number }[] | null | undefined,
  packContent: number
): number | null {
  if (!breakdown || breakdown.length === 0) return null
  const total = breakdown.reduce((s, b) => s + (b.qty || 0), 0)
  return Math.abs(total - packContent) < 0.0001 ? null : total
}

/**
 * Label "satuan asal" untuk audit riwayat batch.
 * Mode buy + isi kemasan > 1 → "1 pack (12 potong)" — dapur lihat cara inputnya,
 * sistem tetap menunjukkan qty kecil yang benar-benar masuk stok.
 * Selain itu (input satuan kecil / isi 1) → "12 potong".
 */
export function originQtyLabel(
  smallQty: number,
  mode: UnitMode | undefined,
  packContent: number,
  smallUnit: string,
  buyUnit?: string
): string {
  if (mode === 'buy' && packContent > 1 && buyUnit) {
    const packs = fmtQty(fromSmallQty(smallQty, 'buy', packContent))
    return `${packs} ${buyUnit} (${fmtQty(smallQty)} ${smallUnit})`
  }
  return `${fmtQty(smallQty)} ${smallUnit}`
}
