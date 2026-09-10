import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import { initSync } from './lib/db'
import { applyScreenPrefs } from './lib/screen'
import './styles.css'

// Portal customer (peta Leaflet ~149 KB) hanya terunduh saat /order dibuka —
// jangan bebani muat awal kasir.
const OrderPortal = lazy(() => import('./portal/OrderPortal'))

const router = createBrowserRouter([
  { path: '/order', element: <OrderPortal /> },
  { path: '/order/*', element: <OrderPortal /> },
  { path: '*', element: <App /> }
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>
)

// Sinkronisasi antrean offline: kirim otomatis saat online kembali + berkala.
initSync()

// Wake lock & preferensi layar tablet dari settings.
void applyScreenPrefs()
