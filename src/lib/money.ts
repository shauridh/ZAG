export const fmtRp = (n: number): string => 'Rp' + Math.round(n).toLocaleString('id-ID')

export const fmtRpPlain = (n: number): string => Math.round(n).toLocaleString('id-ID')

export const fmtNum = (n: number, digits = 2): string =>
  n.toLocaleString('id-ID', { maximumFractionDigits: digits })

export const fmtQty = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

export const parseNum = (s: string): number => {
  const cleaned = s.replace(/[^\d,-]/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}
