// Cetak ke printer thermal Bluetooth via Web Bluetooth (Chrome/Edge di Android,
// Windows, macOS). Safari/iOS belum mendukung: otomatis fallback print dialog.
// Printer yang dipilih DISIMPAN (localStorage) dan dipakai ulang tanpa dialog.

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
  getPrimaryService(service: string | number): Promise<BtService>
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

const PRINTER_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000ff00-0000-1000-8000-00805f9b34fb']

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

async function getCharacteristic(device: BtDevice): Promise<BtCharacteristic> {
  if (!device.gatt) throw new Error('GATT tidak tersedia')
  for (const svc of PRINTER_SERVICES) {
    try {
      const service = await device.gatt.getPrimaryService(svc)
      const chars = await service.getCharacteristics()
      const c = chars.find((x) => x.properties.write || x.properties.writeWithoutResponse)
      if (c) return service.getCharacteristic(c.uuid)
    } catch {
      // coba service berikutnya
    }
  }
  throw new Error('Karakteristik printer tidak ditemukan')
}

async function writeBytes(ch: BtCharacteristic, bytes: number[]): Promise<void> {
  // kirim per 180 byte, beberapa printer patah di paket besar
  for (let i = 0; i < bytes.length; i += 180) {
    await ch.writeValue(new Uint8Array(bytes.slice(i, i + 180)))
    await new Promise((r) => setTimeout(r, 40))
  }
}

async function printToDevice(device: BtDevice, text: string): Promise<void> {
  if (!device.gatt) throw new Error('gatt missing')
  await device.gatt.connect()
  const ch = await getCharacteristic(device)
  const bytes = [...initCmd(), ...Array.from(encoder.encode(text)), ...feedCut()]
  await writeBytes(ch, bytes)
}

/**
 * Cetak teks ke printer tersimpan. Bila belum ada yang tersimpan (atau gagal
 * sambung ulang), buka dialog pilih perangkat lalu simpan pilihannya.
 * Return 'bt' bila sukses via bluetooth, 'fallback' bila perlu print dialog.
 */
export async function printTextBluetooth(text: string): Promise<'bt' | 'fallback'> {
  try {
    const bt = (navigator as unknown as { bluetooth: BtApi }).bluetooth
    const saved = getSavedPrinter()

    // 1) coba sambung ulang printer tersimpan tanpa dialog
    if (saved && bt.getDevices) {
      const devices = await bt.getDevices()
      const found = devices.find((d) => d.id === saved.id)
      if (found) {
        await printToDevice(found, text)
        return 'bt'
      }
    }

    // 2) minta pilih perangkat (sekali), lalu simpan
    const device = await bt.requestDevice({
      filters: [{ services: [PRINTER_SERVICES[0]] }, { services: [PRINTER_SERVICES[1]] }, { services: [PRINTER_SERVICES[2]] }],
      optionalServices: PRINTER_SERVICES
    })
    await printToDevice(device, text)
    savePrinter({ id: device.id, name: device.name ?? 'Printer Bluetooth' })
    return 'bt'
  } catch {
    // user batal atau printer tak didukung: fallback ke print dialog
    return 'fallback'
  }
}

/** Pilih & simpan printer tanpa mencetak. Dipakai di Pengaturan. */
export async function pickAndSavePrinter(): Promise<SavedPrinter> {
  const bt = (navigator as unknown as { bluetooth: BtApi }).bluetooth
  const device = await bt.requestDevice({
    filters: [{ services: [PRINTER_SERVICES[0]] }, { services: [PRINTER_SERVICES[1]] }, { services: [PRINTER_SERVICES[2]] }],
    optionalServices: PRINTER_SERVICES
  })
  // tes koneksi langsung supaya user tahu printer-nya benar
  await device.gatt!.connect()
  await getCharacteristic(device)
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
