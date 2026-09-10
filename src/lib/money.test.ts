import { describe, expect, it } from 'vitest'
import { fmtNum, fmtQty, fmtRp, fmtRpPlain, parseNum } from './money'

describe('parseNum', () => {
  it('parses Indonesian thousand separators', () => {
    expect(parseNum('12.500')).toBe(12500)
    expect(parseNum('Rp 1.250.000')).toBe(1250000)
  })

  it('parses comma decimals', () => {
    expect(parseNum('1,5')).toBe(1.5)
    expect(parseNum('0,25')).toBe(0.25)
  })

  it('returns 0 for garbage input', () => {
    expect(parseNum('abc')).toBe(0)
    expect(parseNum('')).toBe(0)
  })
})

describe('fmtRp / fmtRpPlain', () => {
  it('formats rupiah with id-ID separators', () => {
    expect(fmtRp(12500)).toBe('Rp12.500')
    expect(fmtRpPlain(1250000)).toBe('1.250.000')
  })

  it('rounds fractional amounts', () => {
    expect(fmtRp(99.6)).toBe('Rp100')
  })
})

describe('fmtQty / fmtNum', () => {
  it('shows integers without decimals', () => {
    expect(fmtQty(3)).toBe('3')
  })

  it('shows decimals with id-ID separators', () => {
    expect(fmtQty(1.5)).toBe('1,5')
    expect(fmtNum(2.125)).toBe('2,13')
    expect(fmtNum(2.125, 3)).toBe('2,125')
  })
})
