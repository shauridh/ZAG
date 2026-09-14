// Go-live mulai dari nol: reset -> impor price list -> pulihkan master dari backup.
// Aman diulang: reset & impor idempoten, restorasi selalu insert id baru.
// Jalankan: SB_EMAIL=... SB_PASS=... BACKUP_DIR=backup/<ts> node scripts/go-live-reset.js
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const URL_ = env.match(/VITE_SUPABASE_URL=(\S+)/)?.[1]
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1]
const EMAIL = process.env.SB_EMAIL
const PASS = process.env.SB_PASS
const BACKUP = process.env.BACKUP_DIR
if (!URL_ || !KEY || !EMAIL || !PASS || !BACKUP) {
  console.error('Pakai: SB_EMAIL=... SB_PASS=... BACKUP_DIR=backup/<ts> node scripts/go-live-reset.js')
  process.exit(1)
}
const B = (t) => JSON.parse(fs.readFileSync(`${BACKUP}/${t}.json`, 'utf8'))

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS })
})
if (!login.ok) { console.error(`Login gagal: ${login.status}`); process.exit(1) }
const TOKEN = (await login.json()).access_token
const AUTH = { apikey: KEY, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

async function rpc (fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: AUTH, body: JSON.stringify(args) })
  const body = await res.text()
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${body.slice(0, 200)}`)
  return body ? JSON.parse(body) : null
}
/** Insert tanpa id (identity server yang kasih), balikin baris hasil. */
async function insertReturning (table, rows) {
  if (!rows.length) return []
  const out = []
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${URL_}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...AUTH, Prefer: 'return=representation' },
      body: JSON.stringify(rows.slice(i, i + 500))
    })
    if (!res.ok) throw new Error(`insert ${table}: ${res.status} ${(await res.text()).slice(0, 200)}`)
    out.push(...(await res.json()))
  }
  return out
}

// ============ 1. RESET ============
console.log('1) reset_operational_data ...')
await rpc('reset_operational_data', {})
console.log('   ok')

// ============ 2. IMPOR PRICE LIST ============
console.log('2) import_price_list ...')
const items = JSON.parse(fs.readFileSync('price-list.json', 'utf8'))
const r = await rpc('import_price_list', { p_items: items, p_replace: false })
console.log(`   dibuat=${r[0].created}, diperbarui=${r[0].updated}`)

// ============ 3. PULIHKAN MASTER DARI BACKUP ============
console.log('3) pulihkan master ...')
const oldIng = B('ingredients')
const ingNew = await (await fetch(`${URL_}/rest/v1/ingredients?select=id,code,name`, { headers: AUTH })).json()
const byCode = new Map(ingNew.filter((i) => i.code).map((i) => [i.code, i.id]))
const byName = new Map(ingNew.map((i) => [i.name.toLowerCase(), i.id]))

// 3a. petakan bahan lama -> baru via kode/nama
const mapIng = new Map()
const recreate = []
for (const o of oldIng) {
  const nid = (o.code && byCode.get(o.code)) || byName.get(o.name.toLowerCase())
  if (nid) mapIng.set(o.id, nid)
  else recreate.push(o)
}
console.log(`   terpetakan via price list: ${mapIng.size}/${oldIng.length}`)

// 3b. bahan tanpa padanan (prepared/kemasan non-price-list) dibuat ulang dgn id baru
const recreated = await insertReturning('ingredients', recreate.map(({ id, stock, created_at, ...i }) => i))
recreated.forEach((n, k) => mapIng.set(recreate[k].id, n.id))
console.log(`   dibuat ulang (tanpa kode price list): ${recreated.length} — ${recreated.map((x) => x.name).join(', ')}`)

// 3c. menu: insert id baru, petakan lama->baru via nama
const oldProd = B('products')
const newProd = await insertReturning('products', oldProd.map(({ id, created_at, ...p }) => p))
const mapProd = new Map(oldProd.map((o, k) => [o.id, newProd[k].id]))
console.log(`   products: ${newProd.length}`)

// 3d. resep (semua kind=ingredient di backup) & resep bahan prepared
const recipes = B('recipe_items')
  .map(({ id, ...x }) => ({ ...x, product_id: mapProd.get(x.product_id), component_id: mapIng.get(x.component_id) }))
  .filter((x) => x.product_id != null && x.component_id != null)
await insertReturning('recipe_items', recipes)
const ingRecipes = B('ingredient_recipes')
  .map(({ id, ...x }) => ({ ...x, ingredient_id: mapIng.get(x.ingredient_id), component_id: mapIng.get(x.component_id) }))
  .filter((x) => x.ingredient_id != null && x.component_id != null)
await insertReturning('ingredient_recipes', ingRecipes)
console.log(`   recipe_items: ${recipes.length}/${B('recipe_items').length}, ingredient_recipes: ${ingRecipes.length}/${B('ingredient_recipes').length}`)

// 3e. paket: id baru, item dipetakan via nama produk
const oldBun = B('bundles')
const newBun = await insertReturning('bundles', oldBun.map(({ id, created_at, ...b }) => b))
const mapBun = new Map(oldBun.map((o, k) => [o.id, newBun[k].id]))
const bundleItems = B('bundle_items')
  .map(({ id, ...x }) => ({ ...x, bundle_id: mapBun.get(x.bundle_id), product_id: mapProd.get(x.product_id) }))
  .filter((x) => x.bundle_id != null && x.product_id != null)
await insertReturning('bundle_items', bundleItems)
console.log(`   bundles: ${newBun.length}, bundle_items: ${bundleItems.length}`)

// 3f. target harian per menu
const targets = B('daily_targets')
  .map(({ id, ...x }) => ({ ...x, product_id: mapProd.get(x.product_id) }))
  .filter((x) => x.product_id != null)
await insertReturning('daily_targets', targets)
console.log(`   daily_targets: ${targets.length}/${B('daily_targets').length}`)

// 3g. kategori pengeluaran (tanpa id)
const cats = await insertReturning('expense_categories', B('expense_categories').map(({ id, ...c }) => c))
console.log(`   expense_categories: ${cats.length}`)

// ============ 4. VERIFIKASI ============
console.log('4) verifikasi ...')
const q = async (t, sel = 'id') => (await (await fetch(`${URL_}/rest/v1/${t}?select=${sel}`, { headers: AUTH })).json())
const vIng = await q('ingredients', 'id,price,name,code')
const vProd = await q('products')
const spot = vIng.find((i) => i.code === '100001')
const sambal = vIng.find((i) => i.name === 'Sambal Geprek Cup')
console.log(`   ingredients=${vIng.length} (harus ${oldIng.length + 62 - mapIng.size + mapIng.size - 0}), products=${vProd.length}`)
console.log(`   spot: Ayam Potong 9 harga/potong=${spot?.price} (target 5333)`)
console.log(`   spot: Sambal Geprek Cup (prepared, dibuat ulang) ada=${sambal ? 'ya' : 'TIDAK'}`)
console.log('\nGO-LIVE SELESAI. Langkah app selanjutnya: Stok → Pembelian untuk isi stok awal.')
