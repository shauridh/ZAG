// Kosongkan SEMUA bahan baku, menu, resep/HPP, paket, fryer + riwayat operasional
// supaya pemilik bisa mengisi ulang secara manual dari nol.
//
// Cara kerja (urutan aman):
//   1. BACKUP semua tabel yang akan terkena ke backup/wipe-<timestamp>/*.json
//   2. Panggil RPC reset_operational_data() (yang sama dipakai go-live):
//      hapus riwayat operasional + master (ingredients, products, recipe_items,
//      ingredient_recipes, bundles, fryers, targets) + reset nomor nota ke 1.
//   3. Bersihkan sisa yang tak dijangkau RPC: stock_adjustments (tabel 0015)
//      dan kategori menu (aman dihapus karena products sudah kosong).
//   4. Verifikasi: semua tabel wajib 0 baris.
//
// Pakai:
//   DRY (backup + hitung saja, TIDAK menghapus):
//     SB_EMAIL=... SB_PASS=... node scripts/wipe-master.js --dry-run
//   EKSEKUSI PENUH (destruktif — backup tetap dibuat dulu):
//     SB_EMAIL=... SB_PASS=... node scripts/wipe-master.js
//
// Tidak tersentuh: profil/akun, pengaturan toko & struk, zona delivery,
// portal customer (customers ikut kosong — bagian data operasional).

import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const URL_ = env.match(/VITE_SUPABASE_URL=(\S+)/)?.[1]
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1]
// Kredensial admin: dari env ATAU dari baris SB_EMAIL= / SB_PASS= di .env.local
// (file sudah di-gitignore — jangan pernah di-commit).
const EMAIL = process.env.SB_EMAIL ?? env.match(/^SB_EMAIL=(.*)$/m)?.[1]?.trim()
const PASS = process.env.SB_PASS ?? env.match(/^SB_PASS=(.*)$/m)?.[1]?.trim()
const DRY = process.argv.includes('--dry-run')
if (!URL_ || !KEY || !EMAIL || !PASS) {
  console.error('Pakai: SB_EMAIL=... SB_PASS=... node scripts/wipe-master.js [--dry-run]')
  process.exit(1)
}

const TABLES = [
  // master: bahan, menu, resep/HPP, paket, peralatan, target
  'ingredients', 'products', 'recipe_items', 'ingredient_recipes',
  'bundles', 'bundle_items', 'categories', 'fryers', 'daily_targets',
  // riwayat operasional
  'stock_movements', 'stock_adjustments', 'purchases', 'purchase_items',
  'production_batches', 'production_batch_items', 'oil_cycles',
  'transactions', 'transaction_items', 'payments', 'shifts', 'held_orders',
  'customers', 'customer_addresses', 'orders', 'order_items',
  'expense_categories', 'expenses', 'other_income'
]

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS })
})
if (!login.ok) { console.error(`Login gagal: ${login.status} — pakai akun admin`); process.exit(1) }
const TOKEN = (await login.json()).access_token
const AUTH = { apikey: KEY, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

/** Ambil semua baris tabel (halaman 1000) supaya backup tidak terpotong. */
async function fetchAll (table) {
  const out = []
  let from = 0
  for (;;) {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, {
      headers: { ...AUTH, Range: `${from}-${from + 999}` }
    })
    if (res.status === 404) return null // tabel belum ada di DB ini: lewati
    if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${(await res.text()).slice(0, 160)}`)
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < 1000) return out
    from += 1000
  }
}

// ============ 1. BACKUP ============
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const DIR = process.env.BACKUP_DIR ?? `backup/wipe-${TS}`
fs.mkdirSync(DIR, { recursive: true })
console.log(`1) backup ke ${DIR}/ ...`)
for (const t of TABLES) {
  const rows = await fetchAll(t)
  if (rows === null) { console.log(`   ${t}: (tabel tidak ada — lewati)`); continue }
  fs.writeFileSync(`${DIR}/${t}.json`, JSON.stringify(rows))
  console.log(`   ${t}: ${rows.length} baris`)
}

// ============ 2. RESET ============
if (DRY) {
  console.log('2) DRY-RUN: reset TIDAK dijalankan — data aman. Jalankan tanpa --dry-run untuk menghapus.')
  process.exit(0)
}
console.log('2) reset_operational_data ...')
const rpcRes = await fetch(`${URL_}/rest/v1/rpc/reset_operational_data`, {
  method: 'POST', headers: AUTH, body: '{}'
})
if (!rpcRes.ok) throw new Error(`reset_operational_data: ${rpcRes.status} ${(await rpcRes.text()).slice(0, 200)}`)
console.log('   ok — master + riwayat dihapus, nomor nota kembali ke 1')

// ============ 3. SISA ============ (aman: stock_adjustments ter-cascade, kategori ditinggalkan RPC)
console.log('3) bersihkan sisa (stock_adjustments, categories) ...')
for (const t of ['stock_adjustments', 'categories']) {
  const res = await fetch(`${URL_}/rest/v1/${t}?id=neq.0`, { method: 'DELETE', headers: AUTH })
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${t}: ${res.status} ${(await res.text()).slice(0, 160)}`)
}
console.log('   ok')

// ============ 4. VERIFIKASI ============
console.log('4) verifikasi semua tabel kosong ...')
let fail = 0
for (const t of TABLES) {
  const rows = await fetchAll(t)
  if (rows === null) { console.log(`   ${t}: (tabel tidak ada — lewati)`); continue }
  if (rows.length !== 0) { fail++; console.log(`   ✗ ${t}: MASIH ${rows.length} baris`) }
}
if (fail > 0) { console.error(`\n✗ ${fail} tabel belum kosong — cek pesan di atas.`); process.exit(1) }
console.log('\n✓ WIPE SELESAI — semua bahan baku, menu, HPP, dan riwayat operasional kosong.')
console.log('  Backup lengkap ada di ' + DIR + ' (bisa dipulihkan kapan pun).')
console.log('  Langkah berikutnya: input manual mulai dari halaman Bahan Baku & HPP.')
