/**
 * Foto menu: pilih file -> gambar terkompresi (resize sisi terpanjang).
 * fileToPreviewBlob dipakai Upload foto ke Storage: data URL kecil utk preview
 * instan di modal, Blob untuk diupload. fileToDataUrl tetap ada utk mode demo
 * (QRIS, dsb.) yang menyimpan data URL apa adanya.
 */
export interface PreviewBlob {
  /** data URL kecil utk preview di modal (JPG, maks ~10KB) */
  preview: string
  /** gambar terkompresi siap upload */
  blob: Blob
  /** ekstensi file hasil kompresi (selalu 'jpg' untuk sekarang) */
  ext: string
}

function drawCompressed(maxSide: number, onOk: (canvas: HTMLCanvasElement) => void, onErr: (e: Error) => void, url: string): void {
  const img = new Image()
  img.onload = () => {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      URL.revokeObjectURL(url)
      onErr(new Error('Canvas tidak tersedia'))
      return
    }
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    onOk(canvas)
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    onErr(new Error('Gambar gagal dimuat'))
  }
  img.src = url
}

/** Data URL terkompresi (pemakaian lama: demo mode, QRIS image). */
export function fileToDataUrl(file: File, maxSide = 320, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File bukan gambar'))
      return
    }
    drawCompressed(
      maxSide,
      (canvas) => resolve(canvas.toDataURL('image/jpeg', quality)),
      reject,
      URL.createObjectURL(file)
    )
  })
}

/**
 * Preview kecil + blob siap upload dalam satu kali kompresi.
 * Preview diperkecil lagi (maks 128px) supaya modal ringan; blob utk
 * Storage tetap maks 640px agar foto menu cukup tajam di layar sentuh.
 */
export function fileToPreviewBlob(file: File, maxSide = 640, quality = 0.82): Promise<PreviewBlob> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File bukan gambar'))
      return
    }
    drawCompressed(
      maxSide,
      (canvas) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Gagal memproses gambar'))
              return
            }
            // preview: versi kecil dari canvas yang sama
            const pw = Math.max(1, Math.round((canvas.width * 128) / Math.max(canvas.width, canvas.height)))
            const ph = Math.max(1, Math.round((canvas.height * 128) / Math.max(canvas.width, canvas.height)))
            const p = document.createElement('canvas')
            p.width = pw
            p.height = ph
            p.getContext('2d')!.drawImage(canvas, 0, 0, pw, ph)
            resolve({ preview: p.toDataURL('image/jpeg', 0.7), blob, ext: 'jpg' })
          },
          'image/jpeg',
          quality
        )
      },
      reject,
      URL.createObjectURL(file)
    )
  })
}
