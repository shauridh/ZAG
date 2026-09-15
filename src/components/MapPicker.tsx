import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'

/** Peta pemilih titik (Leaflet + OpenStreetMap, tanpa API key). */
export function MapPicker({
  lat,
  lng,
  outlet,
  onChange
}: {
  lat: number | null
  lng: number | null
  outlet: { lat: number | null; lng: number | null }
  onChange: (lat: number, lng: number) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let dead = false
    void (async () => {
      const L = await import('leaflet')
      if (dead || !ref.current || mapRef.current) return
      const center: [number, number] = [outlet.lat ?? -6.2, outlet.lng ?? 106.816666]
      const map = L.map(ref.current).setView(center, outlet.lat ? 15 : 12)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
      }).addTo(map)
      if (outlet.lat && outlet.lng) {
        L.marker([outlet.lat, outlet.lng], { title: 'Outlet' }).addTo(map)
      }
      const place = (la: number, ln: number): void => {
        if (markerRef.current) markerRef.current.remove()
        markerRef.current = L.marker([la, ln], { draggable: true }).addTo(map)
        markerRef.current.on('dragend', () => {
          const p = markerRef.current.getLatLng()
          onChange(p.lat, p.lng)
        })
        onChange(la, ln)
      }
      map.on('click', (e: { latlng: { lat: number; lng: number } }) => place(e.latlng.lat, e.latlng.lng))
      if (lat && lng) place(lat, lng)
      mapRef.current = map
      setReady(true)
    })()
    return () => {
      dead = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reaksi perubahan dari luar (GPS)
  useEffect(() => {
    if (!ready || !mapRef.current || !lat || !lng) return
    mapRef.current.setView([lat, lng], 16)
    if (!markerRef.current) {
      void import('leaflet').then((L) => {
        if (!mapRef.current) return
        markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current)
        markerRef.current.on('dragend', () => {
          const p = markerRef.current.getLatLng()
          onChange(p.lat, p.lng)
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, ready])

  return (
    <div>
      <div ref={ref} className="h-64 w-full rounded-lg border border-brand-line" />
      <p className="mt-2 text-xs text-brand-muted">Ketuk peta untuk menandai lokasi, geser penanda untuk memperbaiki.</p>
    </div>
  )
}
