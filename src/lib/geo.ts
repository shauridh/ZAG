import type { DeliveryZone } from './types'

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Cari ongkir dari jarak. Zone = zona radius tertingkat yang masih menjangkau. */
export function feeForDistance(km: number, zones: DeliveryZone[]): number | null {
  if (zones.length === 0) return null
  const sorted = [...zones].sort((a, b) => a.radius_km - b.radius_km)
  for (const z of sorted) if (km <= z.radius_km) return z.fee
  return null // di luar radius maksimal
}

export function maxRadius(zones: DeliveryZone[]): number {
  return zones.reduce((m, z) => Math.max(m, z.radius_km), 0)
}
