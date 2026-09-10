/** CSV dengan pemisah titik koma + BOM supaya langsung rapi dibuka di Excel Indonesia. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return '\ufeff' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
