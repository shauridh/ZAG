# DESIGN.md — Sabana Kasir

Arah desain untuk aplikasi kasir Sabana Drieischicken. File ini sumber "jiwa" desain;
aturan filter ada di `.agents/skills/antislop/SKILL.md` (murni filter, bukan penentu gaya).

## Identitas

**Sabana Drieischicken**: gerai fried chicken kebun sayur khas Sabana. Hangat, ramah,
cepat, jujur menampilkan angka. Aplikasi dipakai sehari penuh di konter yang panas dan
sibuk: desain harus tegas, kontras tinggi, dan enak dipandang jam 8 malam.

## Mood & Kepribadian

- **Hangat dan tegas** seperti spanduk kedai: merah berani, bukan biru korporat.
- **Rapi seperti nota**: angka besar, garis pemisah tegas, tanpa dekorasi kosong.
- Ramah anak kembar dua "merah-emas" yang identik dengan brand gerai.

## Palet (2 core + 1 aksen + netral)

| Token | Nilai | Kenapa |
|---|---|---|
| Merah Sabana | `#E11B22` | Warna identitas gerai (arah pengguna: merah Ferrari). Dipakai di header kasir, tombol utama, badge aktif. |
| Merah gelap (teks/hover) | `#B3151B` | Turunan merah untuk teks di atas terang dan hover, menjaga kontras AA. |
| Emas/amber | `#F5A302` | Aksen tunggal: peringatan stok/minyak, bintang produk terlaris. Tidak dipakai di tempat lain. |
| Kertas hangat | `#FFF8F2` | Latar utama. Hangat seperti dinding kedai, bukan putih steril. |
| Kartu | `#FFFFFF` | Permukaan data dengan garis 1.5px coklat tua, bayangan "pop" 2px: nuansa nota/kupon. |
| Tinta | `#1A1512` | Teks utama, kontras sangat tinggi di atas kertas. |
| Abu hangat | `#8A7B72` | Teks sekunder, dipakai minimal (selalu di atas kertas, lolos AA untuk teks kecil non-kritis). |

Dilarang menambah warna lain di luar sistem ini (R-29).

## Tipografi

**Plus Jakarta Sans** (Google Fonts) untuk semua teks termasuk angka:
perancang Indonesia, cocok untuk produk lokal, angkanya tabular jadi kolom kasir rapi.
Tidak ada font monospace untuk gaya; angka nominal pakai ketebalan 700 agar mudah
dibaca kasir dari jarak siku.

## Bentuk & Tekstur

- Radius: kartu 10px, input 8px, tombol utama 8px, badge 4px. Tidak ada pill untuk semua
  elemen (R-11); badge kecil memakai radius kecil agar terbaca sebagai label status.
- Bayangan hanya satu gaya: `0 2px 0 rgba(26,21,18,0.9)` di elemen yang ditekan/utama
  (tombol utama, kartu total). Fungsinya memberi sensasi tombol fisik kasir.
- Garis pemisah 1.5px warna coklat tua (`#E8D9CD`) seperti garis nota.
- Tanpa gradien dekoratif, tanpa glassmorphism, tanpa glow. Merah penuh di header kasir
  adalah identitas, bukan ornamen (R-01: warna brand, alasan tertulis di sini).

## Motif Identitas

**"Garis nota dengan strip merah-emas"**: setiap permukaan data (kartu total, struk,
header tabel laporan) punya strip horizontal merah di atas dan garis tipis emas di
bawahnya, mengulang bahasa spanduk kedai. Motif ini muncul konsisten dan hanya itu.

## Dial

`ENERGY 1 / RHYTHM 2 / MOTION 1`

- Kasir bekerja cepat: tanpa animasi tempelan, transisi hanya hover/press (MOTION 1).
- RHYTHM 2: halaman kasir seragam ketat (efisiensi); dashboard boleh memecah ritme
  dengan kartu ringkasan besar + grafik lebar, karena tugasnya lain (melihat, bukan
  mengetuk).
- Satu titik fokus per layar: layar kasir = panel total/kembalian; dashboard = kartu
  omzet hari ini; portal = foto-status pesanan (teks status besar).
