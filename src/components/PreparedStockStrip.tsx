import { useMemo, type ReactElement } from 'react'
import { smallUnitOf } from '../lib/hpp'
import { fmtQty } from '../lib/money'
import type { Ingredient } from '../lib/types'

/**
 * Strip floating stok siap jual (bahan setengah jadi) di atas Kasir — kasir
 * langsung notice tanpa buka halaman Produksi. Warna status:
 * hijau = aman, kuning/gold = menipis (≤ stok minimum), merah = habis.
 * Bahan tanpa batas (min_stock 0 & stok lega) tetap hijau; dirinci per bahan.
 */
export function PreparedStockStrip({ prepared }: { prepared: Ingredient[] }): ReactElement {
  // urutkan: habis dulu, lalu menipis, lalu aman — yang perlu aksi selalu terlihat
  const sorted = useMemo(
    () =>
      [...prepared].sort((a, b) => {
        const rank = (x: Ingredient): number => (x.stock <= 0 ? 0 : x.stock <= x.min_stock ? 1 : 2)
        return rank(a) - rank(b)
      }),
    [prepared]
  )
  if (prepared.length === 0) return <></>
  const habis = prepared.filter((p) => p.stock <= 0).length
  const menipis = prepared.filter((p) => p.stock > 0 && p.stock <= p.min_stock).length
  const dot = habis > 0 ? 'bg-brand-redtext' : menipis > 0 ? 'bg-brand-gold' : 'bg-[#22aa55]'
  return (
    <div
      className="no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-b-lg border-b-[1.5px] border-brand-line bg-brand-card px-2.5 py-1.5"
      role="status"
      aria-label={`Stok siap jual: ${habis} habis, ${menipis} menipis, ${prepared.length - habis - menipis} aman`}
    >
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="shrink-0 text-[10px] font-extrabold text-brand-muted uppercase">Siap jual</span>
      {sorted.map((p) => {
        const su = smallUnitOf(p)
        const habisSatu = p.stock <= 0
        const menipisSatu = !habisSatu && p.stock <= p.min_stock
        return (
          <span
            key={p.id}
            className={`chip shrink-0 whitespace-nowrap text-[10px] font-extrabold ${
              habisSatu ? 'bg-brand-redtext text-white' : menipisSatu ? 'bg-brand-gold text-brand-ink' : 'bg-[#22aa55]/15 text-[#177a3c]'
            }`}
            title={`${p.name}: ${fmtQty(p.stock)} ${su} siap jual (min ${fmtQty(p.min_stock)})`}
          >
            {p.name} {habisSatu ? 'habis' : `${fmtQty(p.stock)} ${su}`}
          </span>
        )
      })}
    </div>
  )
}
