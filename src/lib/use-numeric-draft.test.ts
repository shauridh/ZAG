import { describe, expect, it } from 'vitest'
import { createDraftMap } from './use-numeric-draft'

/**
 * Pola draft ketik utk input angka: koma/desimal tidak boleh "tertelan"
 * di tengah ketikan (regresi: ketik "9," tampil "9" lalu "5" jadi "95").
 * createDraftMap = mesin state murni di balik hook useNumericDraft.
 */
describe('createDraftMap (mesin draft ketik)', () => {
  it('koma bertahan selama mengetik 9 → 9, → 9,5', () => {
    const m = createDraftMap()
    expect(m.display('a', 9, String)).toBe('9')
    m.set('a', '9,')
    expect(m.display('a', 9, String)).toBe('9,') // INI regresinya: dulu jadi "9"
    m.set('a', '9,5')
    expect(m.display('a', 9, String)).toBe('9,5')
  })

  it('blur membersihkan draft → kembali ke format kanonik nilai tersimpan', () => {
    const m = createDraftMap()
    m.set('a', '9,5')
    expect(m.display('a', 9.5, String)).toBe('9,5') // masih fokus: draft
    m.clear('a')
    expect(m.display('a', 9.5, String)).toBe('9.5') // blur: format kanonik
  })

  it('multi-baris: draft per key independen', () => {
    const m = createDraftMap()
    m.set('row-0', '2,5')
    expect(m.display('row-0', 1, String)).toBe('2,5')
    expect(m.display('row-1', 7, String)).toBe('7') // baris lain tak terpengaruh
  })

  it('nilai berubah dari luar saat tidak mengetik → tampilan ikut', () => {
    const m = createDraftMap()
    expect(m.display('a', 9, String)).toBe('9')
    expect(m.display('a', 12, String)).toBe('12')
  })

  it('angka 0 dan kosong tetap tampil', () => {
    const m = createDraftMap()
    expect(m.display('a', 0, String)).toBe('0')
    m.set('a', '')
    expect(m.display('a', 0, String)).toBe('')
  })
})
