import { describe, expect, it } from 'vitest'
import { cashChips, smallestSufficientDenom } from './cash'

/**
 * Chip pecahan uang kertas di Numpad bayar tunai.
 * Aturan ketuk = menimpa (set) nilai uang diterima, bukan menambah.
 * Chip dipilih adaptif dari pecahan uang asli (2/5/10/20/50/100 ribu).
 */
describe('cashChips (chip pecahan adaptif)', () => {
  it('nota kecil: 4 pecahan terkecil yang menutup total → 5/10/20/50rb', () => {
    expect(cashChips(5000)).toEqual([5000, 10000, 20000, 50000])
  })

  it('nota 10rb: mulai dari 10rb → 10/20/50/100', () => {
    expect(cashChips(10000)).toEqual([10000, 20000, 50000, 100000])
  })

  it('nota 35rb: pecahan pas 50rb ada → 10/20/50/100', () => {
    expect(cashChips(35000)).toEqual([10000, 20000, 50000, 100000])
  })

  it('nota sangat besar (>100rb): padatkan pecahan terbesar + bawahnya', () => {
    expect(cashChips(150000)).toEqual([10000, 20000, 50000, 100000])
  })

  it('nota di atas pecahan terbesar tetap punya 4 chip', () => {
    expect(cashChips(750000)).toEqual([10000, 20000, 50000, 100000])
  })

  it('total nol/negatif tidak meledak', () => {
    expect(cashChips(0)).toEqual([2000, 5000, 10000, 20000])
    expect(cashChips(-1)).toEqual([2000, 5000, 10000, 20000])
  })

  it('smallestSufficientDenom: pecahan terkecil yang menutup total', () => {
    expect(smallestSufficientDenom(8000)).toBe(10000)
    expect(smallestSufficientDenom(20000)).toBe(20000)
    expect(smallestSufficientDenom(200000)).toBeUndefined()
  })
})
