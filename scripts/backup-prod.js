// Backup semua tabel Supabase produksi -> backup/*.json (paginasi 1000 baris).
// WAJIB login dulu (token authenticated) supaya RLS tidak memfilter baris:
//   SB_EMAIL=... SB_PASS=... node scripts/backup-prod.js
// File backup berisi data bisnis: folder backup/ sengaja di-gitignore.
import fs from 'fs'
import path from 'path'

const env = fs.readFileSync('.env.local', 'utf8')
const URL_ = env.match(/VITE_SUPABASE_URL=(\S+)/)?.[1]
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1]
const EMAIL = process.env.SB_EMAIL
const PASS = process.env.SB_PASS
if (!URL_ || !KEY || !EMAIL || !PASS) {
  console.error('Pakai: SB_EMAIL=... SB_PASS=... node scripts/backup-prod.js')
  process.exit(1)
}

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS })
})
if (!login.ok) {
  console.error(`Login gagal: ${login.status} ${await login.text()}`)
  process.exit(1)
}
const TOKEN = (await login.json()).access_token
console.log('✓ login ok, token didapat')

const AUTH = { apikey: KEY, Authorization: `Bearer ${TOKEN}` }

const TABLES = [
  'products', 'categories', 'ingredients', 'recipe_items', 'ingredient_recipes',
  'bundles', 'bundle_items', 'daily_targets', 'fryers', 'settings',
  'expense_categories', 'shifts', 'transactions', 'transaction_items', 'payments',
  'orders', 'order_items', 'customers', 'customer_addresses',
  'purchases', 'purchase_items', 'stock_movements',
  'production_batches', 'production_batch_items', 'oil_cycles',
  'expenses', 'other_income', 'profiles'
]

const dir = path.join('backup', new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'))
fs.mkdirSync(dir, { recursive: true })

async function fetchAll (table) {
  const all = []
  let from = 0
  for (;;) {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, {
      headers: { ...AUTH, Range: `${from}-${from + 999}` }
    })
    if (!res.ok && res.status !== 206) {
      const body = await res.text()
      throw new Error(`${res.status} ${body.slice(0, 120)}`)
    }
    const rows = await res.json()
    all.push(...rows)
    if (rows.length < 1000) break
    from += 1000
  }
  return all
}

let failed = 0
for (const t of TABLES) {
  try {
    const rows = await fetchAll(t)
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 1))
    console.log(`✓ ${t}: ${rows.length} baris`)
  } catch (e) {
    failed++
    console.error(`✗ ${t}: ${e.message}`)
  }
}
console.log(failed ? `\n${failed} tabel gagal — JANGAN lanjut reset sebelum beres` : `\nSemua tabel tersimpan di ${dir}`)
process.exit(failed ? 1 : 0)
