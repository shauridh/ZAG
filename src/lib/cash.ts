/**
 * Chip pecahan uang kertas untuk Numpad bayar tunai.
 * Aturan ketuk = "pembeli menyerahkan lembaran ini" (menimpa nilai, bukan menambah),
 * jadi chip diambil dari PECAHAN UANG ASLI Indonesia (2/5/10/20/50/100 ribu).
 *
 * Pemilihan adaptif mengikuti total nota (lihat cashChips):
 *  - 3 pecahan terkecil yang >= total (pembeli biasanya bayar dengan lembaran
 *    yang cukup atau lebih besar), lalu pecahan berikutnya sebagai cadangan;
 *  - nota yang tidak terjangkau pecahan terkecil tetap menampilkan pecahan
 *    terkecil itu (kasir mengetik sisanya di papan angka, mis. 2 lembar 2rb);
 *  - chip "Pas" (persis total) selalu tersedia terpisah.
 */

export const DENOMS = [2000, 5000, 10000, 20000, 50000, 100000]

/** Pecahan uang terkecil yang >= total (undefined bila semua lebih kecil). */
export function smallestSufficientDenom(total: number): number | undefined {
  return DENOMS.find((d) => d >= total)
}

/** 4 chip pecahan adaptif untuk total nota tertentu (urut kecil→besar). */
export function cashChips(total: number): number[] {
  const t = Math.max(0, Math.floor(total))
  const i = DENOMS.findIndex((d) => d >= t)
  // Nota di atas pecahan terbesar: pecahan nyata yg wajar dipakai bayar.
  const picks = i === -1 ? [100000, 50000, 20000, 10000] : DENOMS.slice(i, i + 4)
  // Kalau kurang dari 4 (nota besar), lengkapi dengan pecahan di bawahnya.
  for (let j = (i === -1 ? DENOMS.length : i) - 1; j >= 0 && picks.length < 4; j--) picks.push(DENOMS[j])
  return picks.sort((a, b) => a - b)
}
