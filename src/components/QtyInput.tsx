import type { ReactElement } from 'react'
import { parseNum } from '../lib/money'
import { useNumericDraft } from '../lib/use-numeric-draft'

/**
 * Input qty/desimal 1 baris dgn pola draft ketik (koma tidak tertelan).
 * `draftKey` wajib unik per baris bila dipakai di dalam .map().
 * onChange mengirim ANGKA hasil parse setiap ketikan — draft hanya tampilan.
 */
export function QtyInput({
  value,
  onChange,
  draftKey,
  className = 'input !h-10 text-right',
  ariaLabel,
  placeholder
}: {
  value: number
  onChange: (n: number) => void
  draftKey: string | number
  className?: string
  ariaLabel?: string
  placeholder?: string
}): ReactElement {
  const [display, setDraft, clearDraft] = useNumericDraft(value, String, draftKey)
  return (
    <input
      className={className}
      value={display}
      inputMode="decimal"
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(parseNum(e.target.value))
      }}
      onBlur={clearDraft}
      aria-label={ariaLabel}
      placeholder={placeholder}
    />
  )
}
