-- ============ Foto menu pindah ke Supabase Storage ============
-- Foto tidak lagi disimpan sebagai data URL di kolom products.photo (baris &
-- cache katalog offline membengkak). Kini photo menyimpan URL publik objek di
-- bucket 'menu-photos'. Data URL lama tetap tampil (render menerima keduanya)
-- dan dikosongkan bertahap lewat UI edit produk.

insert into storage.buckets (id, name, public)
values ('menu-photos', 'menu-photos', true)
on conflict (id) do nothing;

-- Publik: semua orang boleh baca foto menu (kasir + portal customer tanpa login).
drop policy if exists "menu photos read" on storage.objects;
create policy "menu photos read"
  on storage.objects for select to public
  using (bucket_id = 'menu-photos');

-- Tulis/hapus hanya admin (sama dengan kebijakan tulis master data).
drop policy if exists "menu photos admin write" on storage.objects;
create policy "menu photos admin write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and is_admin());

drop policy if exists "menu photos admin update" on storage.objects;
create policy "menu photos admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'menu-photos' and is_admin())
  with check (bucket_id = 'menu-photos' and is_admin());

drop policy if exists "menu photos admin delete" on storage.objects;
create policy "menu photos admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'menu-photos' and is_admin());

-- Catatan: tidak perlu menyentuh storage.objects; objek baru di bucket publik
-- langsung aktif. (Kolom lama "status" sudah tidak ada di skema storage baru.)
