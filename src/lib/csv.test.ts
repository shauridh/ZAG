import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('joins with semicolons and CRLF, prefixed with BOM', () => {
    const csv = toCsv([
      ['Nama', 'Harga'],
      ['Ayam Reguler', 89000]
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('Nama;Harga\r\nAyam Reguler;89000')
  })

  it('quotes values containing separators or quotes', () => {
    const csv = toCsv([['Sambal; Geprek', 'dengan "-extra"']])
    expect(csv.slice(1)).toBe('"Sambal; Geprek";"dengan ""-extra"""')
  })

  it('renders null and undefined as empty cells', () => {
    expect(toCsv([[null, undefined, 5]]).slice(1)).toBe(';;5')
  })
})
