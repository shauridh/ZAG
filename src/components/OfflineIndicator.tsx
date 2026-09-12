// Indikator koneksi & status antrean offline.
// Hijau "Online": tersambung. Emas "Offline — N antre": jualan tetap jalan,
// transaksi masuk antrean dan terkirim otomatis saat online kembali.
import { useEffect, useState, type ReactElement } from 'react'
import { currentOnline, flushQueue, onSyncStateChange, QUEUE_EVENT, queueCount } from '../lib/db'

export function OfflineIndicator({ className = '' }: { className?: string }): ReactElement {
  const [online, setOnline] = useState(currentOnline())
  const [pending, setPending] = useState(queueCount())
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const off = onSyncStateChange(setOnline)
    const onQueue = (): void => setPending(queueCount())
    window.addEventListener(QUEUE_EVENT, onQueue)
    return () => {
      off()
      window.removeEventListener(QUEUE_EVENT, onQueue)
    }
  }, [])

  if (online && pending === 0) {
    return (
      <span className={`chip bg-brand-paper text-[11px] font-bold text-brand-muted ${className}`} role="status" title="Tersambung ke server">
        <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-ink" />
        Online
      </span>
    )
  }

  const doSync = async (): Promise<void> => {
    setSyncing(true)
    await flushQueue()
    setPending(queueCount())
    setSyncing(false)
  }

  return (
    <button
      type="button"
      className={`chip bg-brand-gold text-[11px] font-bold text-brand-ink ${className}`}
      onClick={() => void doSync()}
      disabled={syncing}
      title={online ? 'Kirim transaksi tertahan ke server sekarang' : 'Jualan tetap jalan — transaksi terkirim otomatis saat online kembali'}
    >
      <span aria-hidden className={`mr-1 inline-block h-2 w-2 rounded-full ${online ? 'bg-brand-ink' : 'bg-brand-redtext'}`} />
      {online ? (syncing ? 'Sinkron...' : `${pending} antre — kirim`) : `Offline${pending ? ` — ${pending} antre` : ''}`}
    </button>
  )
}
