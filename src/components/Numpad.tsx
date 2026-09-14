import { useEffect } from 'react'
import { fmtRp } from '../lib/money'

/**
 * Numpad kasir: tombol besar utk input nominal cepat.
 * Kembali string angka murni (tanpa titik) supaya parsing tidak ambigu.
 * Saat tunai melebihi total, kembalian ditampilkan besar & menonjol.
 */
export function Numpad({
  value,
  onChange,
  onSubmit,
  submitLabel,
  quick = [20000, 50000, 100000],
  total
}: {
  value: number
  onChange: (n: number) => void
  onSubmit?: () => void
  submitLabel?: string
  quick?: number[]
  total?: number
}) {
  const push = (s: string): void => {
    const cur = String(value)
    const next = (cur === '0' ? '' : cur) + s
    const n = parseInt(next, 10)
    if (String(n) === next.replace(/^0+(?=\d)/, '')) onChange(n)
  }
  // Keyboard fisik: digit, Backspace (hapus 1 angka), C (bersih), Enter (simpan).
  // Abaikan bila sedang mengetik di input/select asli supaya tidak dobel.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key >= '0' && e.key <= '9') push(e.key)
      else if (e.key === 'Backspace') onChange(Math.floor(value / 10))
      else if (e.key.toLowerCase() === 'c') onChange(0)
      else if (e.key === 'Enter' && onSubmit && !(total !== undefined && value < total)) onSubmit()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  const exact = total !== undefined && value === total
  const hasChange = total !== undefined && value > total

  return (
    <div>
      <div
        className={`mb-2 rounded-lg border-[1.5px] px-3 py-1.5 text-right ${
          hasChange ? 'border-brand-btn bg-brand-gold/30' : 'border-brand-line bg-brand-paper'
        }`}
      >
        <div className="text-xl font-extrabold tabular-nums">{fmtRp(value)}</div>
        {total !== undefined && (
          <div
            className={`font-extrabold ${hasChange ? 'text-lg text-brand-btn' : 'text-xs text-brand-muted'}`}
            aria-live="polite"
          >
            {exact ? 'uang pas' : hasChange ? `Kembalian ${fmtRp(value - total)}` : `kurang ${fmtRp(total - value)}`}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" className="btn-ghost !py-2 text-lg" onClick={() => push(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="btn-ghost !py-2 text-sm font-extrabold" onClick={() => onChange(0)} aria-label="Bersihkan">
          C
        </button>
        <button type="button" className="btn-ghost !py-2 text-lg" onClick={() => push('0')}>
          0
        </button>
        <button type="button" className="btn-ghost !py-2 text-lg" onClick={() => onChange(Math.floor(value / 10))} aria-label="Hapus satu angka">
          ⌫
        </button>
        {quick.map((q) => (
          <button key={q} type="button" className="btn-gold !py-2 text-xs" onClick={() => onChange(value + q)}>
            +{q / 1000}rb
          </button>
        ))}
        {total !== undefined && (
          <button type="button" className="btn-gold !py-2 text-xs" onClick={() => onChange(total)}>
            Uang Pas
          </button>
        )}
      </div>
      {onSubmit && (
        <button
          type="button"
          className="btn-primary mt-2 w-full !py-2.5 text-sm"
          disabled={total !== undefined && value < total}
          onClick={onSubmit}
        >
          {submitLabel ?? 'Simpan'}
        </button>
      )}
    </div>
  )
}
