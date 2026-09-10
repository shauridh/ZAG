/** Konten QR untuk struk / konfirmasi nominal (QRIS statis di-scan customer). */
export function buildQrisContent(merchant: string, amount: number): string {
  // QRIS statis EMVCo ringkas: cukup identitas merchant + nominal + CRC16.
  const f = (id: string, v: string): string => id + String(v.length).padStart(2, '0') + v
  const payload =
    f('00', '01') +
    f('01', '12') +
    f('52', '5812') +
    f('53', '360') +
    f('54', String(amount)) +
    f('58', 'ID') +
    f('59', merchant.slice(0, 25)) +
    f('60', 'JAKARTA') +
    '6304'
  return payload + crc16(payload)
}

export function crc16(s: string): string {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}
