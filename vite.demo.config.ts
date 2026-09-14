// Config khusus instance DEMO (tanpa Supabase): envDir menunjuk folder kosong
// supaya .env.local di root tidak ikut termuat. Dipakai test e2e Python.
// Jalankan: npm run dev -- --config vite.demo.config.ts --port 5199 --strictPort
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(
  base,
  defineConfig({
    envDir: './demo-env-empty'
  })
)
