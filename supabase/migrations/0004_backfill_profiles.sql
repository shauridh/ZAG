-- ============ Perbaikan: profile hilang ============
-- Trigger on_auth_user_created() hanya jalan untuk user yang dibuat SETELAH
-- migrasi dipasang. User lama (dibuat sebelum trigger ada) tidak punya baris
-- profiles, akibatnya is_admin() selalu false: tulis produk/kategori/bahan
-- (termasuk upload foto menu) ditolak RLS secara diam-diam.
-- Migrasi ini mengisi baris yang hilang; role default 'kasir', admin tetap
-- diset manual lewat SQL editor:
--   update profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'email-anda');

insert into profiles (id, name, role)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)),
       'kasir'
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);
