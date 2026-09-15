# DESIGN.md — Sabana Kasir v2

Arah desain untuk aplikasi kasir Sabana Drieischicken — **versi 2 "Hangat Modern"**.
File ini sumber "jiwa" desain. Versi 1 ("nota keras") diganti setelah mockup
`mockup-redesign-v2.html` disetujui pemilik; bahasa visual baru tetap 100% brand Sabana.

## Identitas

**Sabana Drieischicken**: gerai fried chicken kebun sayur khas Sabana. Hangat, ramah,
cepat, jujur menampilkan angka. Aplikasi dipakai sehari penuh di konter yang panas dan
sibuk: desain harus tegas, kontras tinggi, dan enak dipandang jam 8 malam.

## Mood & Kepribadian

- **Hangat dan modern**: merah berani khas kedai, dipakai presisi (aksi utama, strip
  identitas, badge aktif) — bukan dinding. Permukaannya lapang dan tenang.
- **Rapi seperti nota**: angka besar, kolom rata, tanpa dekorasi kosong.
- Ramah anak kembar dua "merah-emas" yang identik dengan brand gerai.

## Palet (2 core + 1 aksen + netral hangat + 2 soft)

| Token | Nilai | Kenapa |
|---|---|---|
| Merah Sabana | `#E11B22` | Warna identitas gerai. Strip identitas, header, badge aktif. |
| Merah tombol | `#C4151B` | Tombol utama; putih di atasnya kontras 5.9:1 (AA). |
| Merah teks | `#A31217` | Teks merah di atas terang. |
| Merah soft ★ | `#FDECEC` | Latar badge merah lembut (refund, kritis, habis). |
| Emas/amber | `#F5A302` | Aksen tunggal: peringatan, tombol cepat numpad, terlaris. |
| Emas soft ★ | `#FEF3DD` | Latar badge peringatan lembut (menipis, selisih pas). |
| Kertas hangat | `#FFF9F4` | Latar utama. |
| Kartu | `#FFFFFF` | Permukaan data, tanpa border tebal — cukup bayangan lembut. |
| Tinta | `#201A16` | Teks utama, kontras sangat tinggi. |
| Abu hangat | `#6E6159` | Teks sekunder, AA di atas kertas. |
| Garis | `#F0E4D8` ★ | Garis tipis hangat 1px — jauh lebih ringan dari v1. |
| Garis tebal | `#E2D2C2` ★ | Penegas (fokus, pembatas kuat). Dipakai hemat. |

★ = token baru v2. Dilarang menambah warna lain di luar sistem ini.

## Tipografi

**Plus Jakarta Sans** tetap untuk semua teks termasuk angka: angkanya tabular,
kolom kasir rapi. v2 menambah: heading & angka besar pakai `tracking-tight`
(rapat, kesan modern), header tabel `uppercase` 11px sebagai label kolom.
Angka nominal tetap tebal 700+ agar terbaca kasir dari jarak siku.

## Bentuk & Elevasi

- Radius: **kartu/modal 16px** (`rounded-card`), **kontrol 12px** (`rounded-ctl`:
  tombol, input, icon-btn), chip 8px. Tidak ada pill untuk semua elemen.
- **Bayangan 3 gaya** — menggantikan bayangan hitam pop v1:
  - `soft` (default `.card`): `0 1px 2px rgba(32,26,22,.05), 0 4px 12px rgba(32,26,22,.06)`
  - `lift` (hover kartu menu, item aktif, toast): `0 2px 4px …, 0 10px 24px …`
  - bayangan **berwarna**: tombol utama merah `0 4px 12px rgba(196,21,27,.35)`,
    tombol gold `rgba(245,163,2,.30)` — tombol terasa "fisik" ala app modern.
- Press: `translateY(1px)` + bayangan hilang (tombol utama & gold).
- Garis pemisah 1px hangat `#F0E4D8` (tabel: baris `#F7EFE6`).
- Tanpa gradien dekoratif, tanpa glassmorphism, tanpa glow.

## Motif Identitas

**"Garis nota dengan strip merah-emas"** — dipertipis jadi aksen 3px + 1px
(dulu 6px + 1px yang berat). Hadir di header kasir, kartu total, kartu ringkasan,
laporan. Motif ini muncul konsisten dan hanya itu.

## Interaksi

- Kartu menu kasir: hover/aktif `lift` + `translateY(-2px)` — feedback sentuh ringan.
- Fokus input: **ring merah 4px** `rgba(196,21,27,.12)` + border merah — terlihat
  jelas di konter terang maupun saat dipakai dengan sarung tangan.
- Animasi hanya yang fungsional: `pulse-new` (badge pesanan baru), `dot-blink`
  (server tersambung). Keduanya dimatikan oleh `prefers-reduced-motion`.

## Dial

`ENERGY 1 / RHYTHM 2 / MOTION 1`

- Kasir bekerja cepat: tanpa animasi tempelan; transisi hanya hover/press (150ms).
- RHYTHM 2: halaman kasir seragam ketat; dashboard boleh memecah ritme dengan
  kartu ringkasan besar + grafik lebar.
- Satu titik fokus per layar: layar kasir = panel total/kembalian; dashboard =
  kartu omzet hari ini; portal = foto-status pesanan.

## Checklist QA (ditegakkan saat review desain)

- Kontras teks ≥ 4.5:1 (putih di #C4151B = 5.9:1 ✓)
- Focus state terlihat (ring merah 4px)
- Target sentuh ≥ 44px di kasir, 40px di aksi tabel
- `prefers-reduced-motion` dihormati
- Responsif 375 / 768 / 1024 / 1440px
- Tanpa emoji sebagai ikon — semua lucide / logo brand
- Chip & badge tidak terpotong saat teks panjang
- Hover/press punya state jelas (lift, translateY)

## Referensi

- Mockup disetujui: `mockup-redesign-v2.html` (9 bagian: design system, Kasir,
  Dashboard, Before/After, Bahan & HPP, Riwayat, modal Edit Barang, Tutup Shift, QA)
- Implementasi token: `src/styles.css` + `tailwind.config.ts`
