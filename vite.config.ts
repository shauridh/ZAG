import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          maps: ['leaflet'],
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'Sabana Kasir',
        short_name: 'Sabana',
        description: 'Kasir, stok, produksi, dan pesanan online Sabana Drieischicken',
        theme_color: '#E11B22',
        background_color: '#FFF8F2',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/order/],
        // Chunk vendor di-precache (hash URL) via cache-first; font Google
        // (cross-origin, tanpa hash) via StaleWhileRevalidate agar offline tetap jalan.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }): boolean =>
              url.origin === 'https://fonts.gstatic.com' ||
              url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
