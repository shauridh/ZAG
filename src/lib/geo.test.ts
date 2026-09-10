import { describe, expect, it } from 'vitest'
import type { DeliveryZone } from './types'
import { feeForDistance, haversineKm, maxRadius } from './geo'

const zones: DeliveryZone[] = [
  { id: 2, radius_km: 5, fee: 8000 },
  { id: 1, radius_km: 2, fee: 5000 },
  { id: 3, radius_km: 10, fee: 15000 }
]

describe('haversineKm', () => {
  it('computes a plausible city-to-city distance', () => {
    const km = haversineKm(-6.2, 106.816, -6.914, 107.607) // Jakarta–Bandung
    expect(km).toBeGreaterThan(100)
    expect(km).toBeLessThan(140)
  })

  it('is ~0 for identical points', () => {
    expect(haversineKm(1, 1, 1, 1)).toBeCloseTo(0)
  })
})

describe('feeForDistance', () => {
  it('picks the smallest zone that still reaches the distance', () => {
    expect(feeForDistance(1.5, zones)).toBe(5000)
    expect(feeForDistance(4, zones)).toBe(8000)
    expect(feeForDistance(9, zones)).toBe(15000)
  })

  it('returns null outside the maximum radius', () => {
    expect(feeForDistance(11, zones)).toBeNull()
  })

  it('returns null without zones', () => {
    expect(feeForDistance(1, [])).toBeNull()
  })
})

describe('maxRadius', () => {
  it('returns the largest radius', () => {
    expect(maxRadius(zones)).toBe(10)
    expect(maxRadius([])).toBe(0)
  })
})
