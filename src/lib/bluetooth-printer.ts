// Cetak ke printer thermal Bluetooth via Web Bluetooth (Chrome/Edge di Android,
// Windows, macOS). Safari/iOS belum mendukung: otomatis fallback print dialog.
// Printer yang dipilih DISIMPAN (localStorage) dan dipakai ulang.
//
// Kenapa kadang muncul dialog pair lagi padahal printer tersimpan?
// navigator.bluetooth.getDevices() (daftar perangkat yang sudah diberi izin,
// dipakai untuk sambung-ulang diam-diam) MASIH DI BELAKANG FLAG eksperimental
// di Chrome stabil (chrome://flags/#enable-experimental-web-platform-features;
// status Sep 2026). Jadi di Chrome biasa jalur tanpa-dialog tidak tersedia,
// dan aplikasi jatuh ke requestDevice(): dialog muncul sekali per sesi,
// user tinggal ketuk printer yang sama. Itu keterbatasan browser, bukan
// printer rusak. Tanpa dialog total: pakai RawBT (lihat Pengaturan → Printer).

interface BtCharacteristic {
  writeValue(value: BufferSource): Promise<void>
}

interface BtCharInfo {
  uuid: string
  properties: { write: boolean; writeWithoutResponse: boolean }
}

interface BtService {
  getCharacteristic(c: string | number): Promise<BtCharacteristic>
  getCharacteristics(): Promise<BtCharInfo[]>
}

interface BtServer {
  connect(): Promise<BtServer>
  disconnect?(): void
  connected?: boolean
  getPrimaryService(service: string | number): Promise<BtService>
  getPrimaryServices(): Promise<BtService[]>
}

interface BtDevice {
  id: string
  name?: string
  gatt?: BtServer
}

interface BtApi {
  requestDevice(o: object): Promise<BtDevice>
  getDevices?(): Promise<BtDevice[]>
}

// Service UUID yang dipakai mayoritas printer thermal murah (ESC/POS).
// Makin panjang daftar, makin besar peluang printer terdeteksi di dialog pair.
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000fee7-0000-1000-8000-00805f9b34fb'
]

/**
 * Opsi requestDevice. Mode 'strict' hanya menampilkan printer dgn service dikenal;
 * mode 'all' menampilkan SEMUA perangkat Bluetooth di sekitar — dipakai kalau
 * printer tak muncul di dialog (nama/UUID-nya tidak standar).
 */
function requestOpts(mode: 'strict' | 'all'): object {
  return mode === 'all'
    ? { acceptAllDevices: true, optionalServices: PRINTER_SERVICES }
    : {
        // tiap filter: { services: [uuid] } — Web Bluetooth mensyaratkan array,
        // string polos dilempar "cannot be converted to a sequence"
        filters: PRINTER_SERVICES.map((services) => ({ services: [services] })),
        optionalServices: PRINTER_SERVICES
      }
}

const LS_PRINTER = 'sabana-printer'

export interface SavedPrinter {
  id: string
  name: string
}

const encoder = new TextEncoder()
const ESC = 0x1b

function initCmd(): number[] {
  return [ESC, 0x40] // ESC @ reset
}

function feedCut(n = 3): number[] {
  return [0x1d, 0x56, 0x42, 0x00, 0x1b, 0x64, n] // cut + feed
}

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function getSavedPrinter(): SavedPrinter | null {
  try {
    const raw = localStorage.getItem(LS_PRINTER)
    return raw ? (JSON.parse(raw) as SavedPrinter) : null
  } catch {
    return null
  }
}

function savePrinter(p: SavedPrinter): void {
  localStorage.setItem(LS_PRINTER, JSON.stringify(p))
}

export function forgetPrinter(): void {
  localStorage.removeItem(LS_PRINTER)
}

/**
 * Cari karakteristik tulis dengan memindai SEMUA service yang boleh diakses.
 * Dulu hanya dicek 3 UUID standar — printer dengan UUID tidak standar konek
 * GATT tapi gagal di tahap ini, sehingga keliru dilaporkan "tidak terjangkau".
 */
async function getCharacteristic(device: BtDevice): Promise<BtCharacteristic> {
  if (!device.gatt) throw new Error('GATT tidak tersedia')
  const services = await device.gatt.getPrimaryServices()
  for (const service of services) {
    try {
      const chars = await service.getCharacteristics()
      const c = chars.find((x) => x.properties.write || x.properties.writeWithoutResponse)
      if (c) return service.getCharacteristic(c.uuid)
    } catch {
      // service ini tak bisa dibaca, lanjut ke service berikutnya
    }
  }
  throw new Error('Tidak menemukan karakteristik tulis — printer mungkin bukan model ESC/POS')
}

async function writeBytes(ch: BtCharacteristic, bytes: number[]): Promise<void> {
  // kirim per 180 byte, beberapa printer patah di paket besar
  for (let i = 0; i < bytes.length; i += 180) {
    await ch.writeValue(new Uint8Array(bytes.slice(i, i + 180)))
    await new Promise((r) => setTimeout(r, 40))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Sambung ulang printer tersimpan TANPA dialog lewat getDevices() — hanya
 * mungkin bila browser menyediakan API ini (Chrome stabil: masih di belakang
 * flag, jadi umumnya null). Bluetooth printer sering menolak koneksi pertama
 * setelah idle/tidur, jadi dicoba beberapa kali dengan jeda sebelum menyerah.
 */
async function findSavedDevice(bt: BtApi, saved: SavedPrinter): Promise<BtDevice | null> {
  if (!bt.getDevices) return null
  // percobaan 1 langsung, sisanya memberi printer waktu bangun dari mode tidur
  const delays = [0, 800, 2500, 5000]
  let lastErr: unknown = null
  for (const wait of delays) {
    if (wait) await sleep(wait)
    try {
      const devices = await bt.getDevices()
      const found = devices.find((d) => d.id === saved.id)
      if (!found) {
        lastErr = new Error('Printer tidak terdaftar di browser')
        continue
      }
      await connectDevice(found) // tes sambung tanpa mencetak
      return found
    } catch (ex) {
      lastErr = ex
    }
  }
  console.warn('Sambung ulang printer gagal:', lastErr)
  return null
}

async function printToDevice(device: BtDevice, text: string): Promise<void> {
  const ch = await connectDevice(device)
  const bytes = [...initCmd(), ...Array.from(encoder.encode(text)), ...feedCut()]
  await writeBytes(ch, bytes)
}

/** Sambung + siapkan karakteristik tulis. Boleh dipanggil ulang, GATT connect idempoten. */
async function connectDevice(device: BtDevice): Promise<BtCharacteristic> {
  if (!device.gatt) throw new Error('GATT tidak tersedia')
  if (device.gatt.connected !== true) await device.gatt.connect()
  return getCharacteristic(device)
}

/**
 * Cek printer tersimpan masih bisa disambung TANPA dialog (tanpa mencetak).
 * Hanya bisa kalau getDevices() tersedia; di Chrome stabil umumnya false —
 * itu bukan tanda printer rusak. Status jujur untuk Pengaturan.
 */
export async function canReconnectSaved(): Promise<boolean> {
  const saved = getSavedPrinter()
  if (!saved) return false
  const bt = (navigator as unknown as { bluetooth: BtApi }).bluetooth
  return (await findSavedDevice(bt, saved)) !== null
}

/**
 * Cetak teks ke printer tersimpan, dengan rantai fallback yang jujur:
 * 1) getDevices() tanpa dialog (browser dgn flag/dukungan penuh),
 * 2) requestDevice() — dialog pair muncul; di Chrome stabil ini jalur normal.
 *
 * Hasil dibedakan per tahap supaya pesan UI tidak menyesatkan:
 * - 'bt'              : terkirim
 * - 'reconnect-gagal' : printer tak terjangkau / dialog ditolak / dibatalkan
 * - 'print-gagal'     : printer TERpilih & TERsambung tapi data gagal terkirim
 * - 'fallback'        : browser tak mendukung / belum ada printer tersimpan → dialog
 */
export async function printTextBluetooth(text: string): Promise<'bt' | 'fallback' | 'reconnect-gagal' | 'print-gagal'> {
  const bt = (navigator as unknown as { bluetooth: BtApi }).bluetooth
  const saved = getSavedPrinter()

  if (saved) {
    // 1) jalur tanpa dialog — sebagian besar browser tidak punya getDevices()
    const found = await findSavedDevice(bt, saved)
    if (found) {
      try {
        await printToDevice(found, text)
        return 'bt'
      } catch (ex) {
        console.warn('Print bluetooth gagal:', ex)
        return 'print-gagal'
      }
    }

    // 2) fallback: buka dialog pair (butuh gerakan user; dari auto-print tanpa
    //    tap akan ditolak browser → 'reconnect-gagal', kasir tinggal ketuk Cetak)
    let device: BtDevice
    try {
      device = await bt.requestDevice(requestOpts('strict'))
    } catch (ex) {
      // dibatalkan, tidak ada printer cocok di sekitar, atau ditolak tanpa gesture
      console.warn('Sambung ulang via dialog dibatalkan/gagal:', ex)
      return 'reconnect-gagal'
    }
    if (device.id !== saved.id) savePrinter({ id: device.id, name: device.name ?? saved.name })
    try {
      await printToDevice(device, text)
      return 'bt'
    } catch (ex) {
      console.warn('Print bluetooth gagal:', ex)
      return 'print-gagal'
    }
  }

  try {
    // belum ada printer tersimpan: minta pilih perangkat (sekali), lalu simpan
    const device = await bt.requestDevice(requestOpts('strict'))
    await printToDevice(device, text)
    savePrinter({ id: device.id, name: device.name ?? 'Printer Bluetooth' })
    return 'bt'
  } catch (ex) {
    console.warn('Pilih printer dibatalkan/gagal:', ex)
    // user batal atau printer tak didukung: fallback ke print dialog
    return 'fallback'
  }
}

/** Pilih & simpan printer tanpa mencetak. Dipakai di Pengaturan. */
export async function pickAndSavePrinter(mode: 'strict' | 'all' = 'strict'): Promise<SavedPrinter> {
  const bt = (navigator as unknown as { bluetooth: BtApi }).bluetooth
  const device = await bt.requestDevice(requestOpts(mode))
  // tes koneksi langsung supaya user tahu printer-nya benar
  await connectDevice(device)
  const saved = { id: device.id, name: device.name ?? 'Printer Bluetooth' }
  savePrinter(saved)
  return saved
}

/** Kirim halaman HTML ke print dialog (fallback browser). */
export function printHtmlFallback(html: string): void {
  const win = window.open('', '_blank', 'width=320,height=600')
  if (!win) return
  win.document.write(
    `<html><head><title>Struk</title><style>@media print{body{margin:0}}@page{margin:3mm}</style></head><body>${html}<script>window.onload=()=>{window.print()}<\\/script></body></html>`
  )
  win.document.close()
}
