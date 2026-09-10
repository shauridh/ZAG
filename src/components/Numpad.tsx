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
  const exact = total !== undefined && value === total
  const hasChange = total !== undefined && value > total

  return (
    <div>
      <div
        className={`mb-3 rounded-lg border-[1.5px] px-3 py-2 text-right ${
          hasChange ? 'border-brand-btn bg-brand-gold/30' : 'border-brand-line bg-brand-paper'
        }`}
      >
        <div className="text-2xl font-extrabold tabular-nums">{fmtRp(value)}</div>
        {total !== undefined && (
          <div
            className={`font-extrabold ${hasChange ? 'text-lg text-brand-btn' : 'text-xs text-brand-muted'}`}
            aria-live="polite"
          >
            {exact ? 'uang pas' : hasChange ? `Kembalian ${fmtRp(value - total)}` : `kurang ${fmtRp(total - value)}`}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" className="btn-ghost !py-3 text-xl" onClick={() => push(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="btn-ghost !py-3 text-sm font-extrabold" onClick={() => onChange(0)} aria-label="Bersihkan">
          C
        </button>
        <button type="button" className="btn-ghost !py-3 text-xl" onClick={() => push('0')}>
          0
        </button>
        <button type="button" className="btn-ghost !py-3 text-xl" onClick={() => onChange(Math.floor(value / 10))} aria-label="Hapus satu angka">
          ⌫
        </button>
        {quick.map((q) => (
          <button key={q} type="button" className="btn-gold !py-3 text-sm" onClick={() => onChange(value + q)}>
            +{q / 1000}rb
          </button>
        ))}
        {total !== undefined && (
          <button type="button" className="btn-gold !py-3 text-sm" onClick={() => onChange(total)}>
            Uang Pas
          </button>
        )}
      </div>
      {onSubmit && (
        <button
          type="button"
          className="btn-primary mt-3 w-full !py-3 text-base"
          disabled={total !== undefined && value < total}
          onClick={onSubmit}
        >
          {submitLabel ?? 'Simpan'}
        </button>
      )}
    </div>
  )
}
