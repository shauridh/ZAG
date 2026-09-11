// PostgREST punya jebakan: UPDATE/DELETE yang diblokir RLS tidak error,
// tapi "sukses" dengan 0 baris terdampak. Akibatnya foto menu / data master
// tampak tersimpan padahal tidak. Fungsi di sini bikin kegagalan semacam itu
// terlihat dengan pesan yang bisa ditindaklanjuti admin.

export function assertRowsAffected(count: number | null, what: string): void {
  if (count === 0) {
    throw new Error(`${what} gagal: data tidak ditemukan atau akses ditolak.`)
  }
}

/**
 * Guard khusus tulis tabel master (produk, kategori, bahan).
 * Kebijakan RLS hanya mengizinkan user dengan profiles.role = 'admin'.
 * Kalau 0 baris terdampak, jelaskan persis cara memperbaikinya.
 */
export function ensureAdminWrite(count: number | null, isUpdate: boolean): void {
  if (count !== 0) return
  if (isUpdate) {
    throw new Error(
      'Tidak tersimpan: 0 baris terdampak. Akun ini tidak punya akses admin (profiles.role = admin) di server, atau data sudah dihapus orang lain.'
    )
  }
  throw new Error(
    'Tidak tersimpan: akses ditolak server. Akun ini belum punya peran admin. Jalankan: update profiles set role = \'admin\' where id = (select id from auth.users where email = \'...\');'
  )
}
