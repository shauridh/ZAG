import { useState } from 'react'

/**
 * Mesin state murni di balik hook useNumericDraft — dipisah agar bisa
 * di-unit-test tanpa renderer React.
 */
export function createDraftMap(): {
  display: (key: string | number, value: number, format: (n: number) => string) => string
  set: (key: string | number, teks: string) => void
  clear: (key: string | number) => void
} {
  const rawMap = new Map<string, string>()
  return {
    /** Teks yang harus ditampilkan input: draft ketikan bila ada, kalau tidak `format(value)`. */
    display(key, value, format) {
      return rawMap.get(`${key}`) ?? format(value)
    },
    set(key, teks) {
      rawMap.set(`${key}`, teks)
    },
    clear(key) {
      // hapus (bukan isi '') supaya display kembali ke format(value)
      rawMap.delete(`${key}`)
    }
  }
}

/**
 * Pola draft ketik untuk input angka (agar koma/desimal tidak "tertelan"):
 * - selama fokus, tampilkan TEKS MENTAH yang diketik (state `raw`)
 * - `onChange` menerima teks apa adanya — parent mem-parse dgn `parseNum`
 * - saat blur, draft dibuang → tampilan kembali `format(nilai tersimpan)`
 *
 * Return: [nilaiTampil, setDraft, bersihkanDraft]
 * - `setDraft(teks)` dipanggil di onChange input
 * - `bersihkanDraft()` dipanggil di onBlur
 *
 * Dipakai input multi-baris (array) via `draftKey`: setiap baris key unik sendiri.
 * Komponen <NumInput> memakai pola yang sama utk kasus input tunggal.
 */
export function useNumericDraft(
  value: number,
  format: (n: number) => string = String,
  draftKey: string | number = ''
): [string, (teks: string) => void, () => void] {
  const fullKey = `${draftKey}`
  const [rawMap, setRawMap] = useState<Record<string, string>>({})
  const raw = rawMap[fullKey]

  const setDraft = (teks: string): void => setRawMap((m) => ({ ...m, [fullKey]: teks }))
  const clearDraft = (): void =>
    setRawMap((m) => {
      // hapus (bukan isi '') supaya tampilan kembali ke format(value)
      if (!(fullKey in m)) return m
      const next = { ...m }
      delete next[fullKey]
      return next
    })
  return [raw ?? format(value), setDraft, clearDraft]
}
