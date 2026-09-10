// Supabase Edge Function: kirim laporan tutup shift ke email pemilik via SMTP Gmail.
// Secrets yang perlu diset (supabase secrets set):
//   SMTP_USER = alamat gmail pengirim
//   SMTP_PASS = App Password gmail (16 karakter, bukan password utama)
// Panggilan dari close_shift (HTTP) dengan body:
//   { subject, html, to }
// @ts-nocheck
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 })
  const { subject, html, to } = await req.json()
  const SMTP_USER = Deno.env.get('SMTP_USER')
  const SMTP_PASS = Deno.env.get('SMTP_PASS')
  if (!SMTP_USER || !SMTP_PASS) return new Response('smtp not configured', { status: 500 })

  const host = 'smtp.gmail.com'
  const port = 465
  const conn = await Deno.connectTls({ hostname: host, port })

  const reader = conn.readable.getReader()
  const writer = conn.writable.getWriter()
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  let buf = ''
  async function readUntil(code: string) {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value)
      if (buf.includes(code)) {
        const out = buf
        buf = ''
        return out
      }
    }
    return buf
  }
  async function send(cmd: string, wait = '250 ') {
    await writer.write(enc.encode(cmd + '\r\n'))
    return await readUntil(wait)
  }

  await readUntil('220 ')
  await send(`EHLO ${host}`, '250 ')
  const b64 = (s: string) => btoa(s)
  await send('AUTH LOGIN', '334 ')
  await send(b64(SMTP_USER), '334 ')
  const authRes = await send(b64(SMTP_PASS), '235 ')
  if (!authRes.includes('235')) return new Response('auth failed', { status: 500 })

  const from = SMTP_USER
  const boundary = 'sbx-' + crypto.randomUUID().slice(0, 12)
  await send(`MAIL FROM:<${from}>`, '250 ')
  await send(`RCPT TO:<${to}>`, '250 ')
  await send('DATA', '354 ')
  const msg = [
    `From: Sabana Kasir <${from}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    `--${boundary}--`,
    ''
  ].join('\r\n')
  const dataRes = await send(msg + '\r\n.', '250 ')
  await send('QUIT', '221 ')
  conn.close()

  if (!dataRes.includes('250')) return new Response('send failed: ' + dataRes, { status: 500 })
  return Response.json({ ok: true })
})
