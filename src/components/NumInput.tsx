import { useState, type ReactElement } from 'react'
import { parseNum } from '../lib/money'

/**
 * Input angka yang aman diketik (controlled tanpa "menelan" ketikan):
 * - selama fokus, TEKS MENTAH yang ditampilkan (koma/titik tidak hilang di tengah jalan)
 * - tiap ketikan: teks penuh diparse -> angka dikirim ke parent (parse dipanggil
 *   pada teks utuh, bukan bertahap, jadi pembagian/pembulatan tidak menumpuk error)
 * - saat blur, tampilan kembali diformat lewat `format`
 * - `format` default angka polos; utk field rupiah pakai fmtRpPlain
 *   (ketik "15000" atau "15.000" — sama saja, non-digit dibuang saat parse)
 */
export function NumInput({
  value,
  onChange,
  format = String,
  parse = parseNum,
  className,
  id,
  ariaLabel,
  placeholder,
  required,
  autoFocus,
  disabled,
  onBlur
}: {
  value: number
  onChange: (n: number) => void
  format?: (n: number) => string
  parse?: (s: string) => number
  className?: string
  id?: string
  ariaLabel?: string
  placeholder?: string
  required?: boolean
  autoFocus?: boolean
  disabled?: boolean
  onBlur?: () => void
}): ReactElement {
  const [raw, setRaw] = useState<string | null>(null)
  return (
    <input
      id={id}
      className={className}
      inputMode="decimal"
      value={raw ?? format(value)}
      placeholder={placeholder}
      required={required}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        setRaw(e.target.value)
        onChange(parse(e.target.value))
      }}
      onBlur={() => {
        setRaw(null)
        onBlur?.()
      }}
      onFocus={(e) => e.currentTarget.select()}
    />
  )
}
