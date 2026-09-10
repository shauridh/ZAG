-- ============================================================
-- SABANA KASIR — Data awal (SEED)
-- Sumber: HPP Reguler.xlsx + Price List Sabana Sharing Mitra.pdf
-- Harga bahan memakai price list terbaru (PDF). Semua angka bisa
-- diubah dari aplikasi setelahnya, ini hanya modal awal.
-- Aman dijalankan ulang: id eksplisit pakai OVERRIDING SYSTEM VALUE,
-- sisanya guarded (on conflict / not exists) — tidak bikin duplikat.
-- ============================================================

-- ============ Kategori ============
insert into categories (id, name, sort) overriding system value values
 (1,'Ayam',1),(2,'Nasi & Rice Box',2),(3,'Snack Goreng',3),(4,'Burger & Bun',4),
 (5,'Saos & Sambal',5),(6,'Rice Bowl',6),(7,'Minuman',7),(8,'Paket Hemat',8)
on conflict (id) do nothing;
select setval('categories_id_seq', 8);

-- ============ Bahan mentah ============
-- KONVENSI `price`: harga per 1 SATUAN DASAR = harga beli 1 kemasan / isi kemasan.
-- Contoh: Minyak 2L Rp43.400 -> price 21.700/liter; Sauce Cup (isi 50) Rp15.000 -> price 300/cup.
-- Resep & HPP memakai satuan dasar, jadi HPP per ekor ayam cocok dgn sheet HPP Excel (~Rp63.7rb).
insert into ingredients (id, name, code, kind, buy_unit, pack_content, price, stock, min_stock) overriding system value values
 (1,'Ayam Potong 9','100001','raw','ekor',9,5333,20,10),
 (2,'Ayam Potong 9 SBP','100010','raw','ekor',9,6444,0,5),
 (3,'Tepung Bumbu Fried Chicken','200001','raw','pack',1,23500,3,2),
 (4,'Minyak Goreng Sunco 2L','200002','raw','liter',2,21700,8,4),
 (5,'Gas 3 kg','','raw','tabung',1,23000,1,1),
 (6,'Kemasan Ayam (ikat 100)','200011','raw','pack',100,235,2,1),
 (7,'Kantong Plastik (pack 50)','200023','raw','pack',50,140,2,1),
 (8,'Sauce Cup 35ml (pack 50)','200022','raw','pack',50,300,1,1),
 (9,'Kertas Nasi (pack 100)','200013','raw','pack',100,130,1,1),
 (10,'Box Nasi Standard (pack 100)','200014','raw','pack',100,1250,1,1),
 (11,'Beras Mentik Wangi','100006','raw','kg',1,16500,25,10),
 (12,'Saus Sambal Sabana (pack 125)','200007','raw','pack',125,180,2,1),
 (13,'Sambal Geprek 500g','200019','raw','pouch 500g',1,64000,2,2),
 (14,'Sambal Ijo 500g','200020','raw','pouch 500g',1,53000,2,1),
 (15,'Sambal Hitam 500g','200021','raw','pouch 500g',1,51500,2,1),
 (16,'Saos Buldak 500g','200028','raw','pouch 500g',1,36800,2,1),
 (17,'Saos Keju Mentai 500g','200030','raw','pouch 500g',1,27000,2,1),
 (18,'Saos Extra Pedas Sadas 500g','200033','raw','pouch 500g',1,24500,2,1),
 (19,'Mayonaise 900g','200034','raw','pouch 900g',1,36700,1,1),
 (20,'Saus BBQ (pack 10)','200032','raw','pack 10',10,800,1,1),
 (21,'Roti Burger','200004','raw','pcs',1,2600,20,10),
 (22,'Chicken Patty','200003','raw','pcs',1,4500,10,10),
 (23,'Bakso (pack 50)','200005','raw','pack 50',50,480,1,1),
 (24,'Chicken Roll (pack 10)','200006','raw','pack 10',10,2440,1,1),
 (25,'Chicken Strip (pack 60)','','raw','pack 60',60,997,1,1),
 (26,'Chicken Katsu','200059','raw','pcs',1,4500,10,10),
 (27,'Kentang Simplot','200043','raw','kg',2.72,42279,3,2),
 (28,'Roti Chicken Bun (pack 4)','200047','raw','pack 4',4,2000,2,1),
 (29,'Paper Bowl 650ml (pack 25)','200049','raw','pack 25',25,1650,1,1),
 (30,'Paper Bowl 500ml (pack 25)','200048','raw','pack 25',25,1550,1,1),
 (31,'Box Serbaguna (pack 100)','200016','raw','pack 100',100,850,1,1),
 (32,'Box Kentang (pack 200)','200018','raw','pack 200',200,599,1,1),
 (33,'Box Burger (pack 100)','','raw','pack 100',100,700,1,1),
 (34,'Kemasan Kulit (pack 100)','200012','raw','pack 100',100,150,1,1),
 (35,'Sendok Garpu (pack 50)','200051','raw','pack 50',50,200,1,1),
 (36,'Oregano 25gr','200050','raw','pack 25gr',25,320,1,1),
 (37,'Sayuran (timun/selada)','','raw','porsi',1,1000,30,10),
 (38,'Mentega 200gr','','raw','pouch 200g',1,10000,1,1),
 (39,'Kulit Ayam 500gr','100004','raw','pack 500g',1,20000,2,1),
 (40,'Teh Botol Sosro 250ml','200038','raw','pcs',1,2500,24,12),
 (41,'Fruit Tea 250ml','200035','raw','pcs',1,2500,24,12)
on conflict (id) do nothing;

-- ============ Bahan setengah jadi (diproduksi batch) ============
insert into ingredients (id, name, kind, buy_unit, pack_content, price, stock, min_stock) overriding system value values
 (50,'Ayam Marinasi (per potong)','prepared','potong',1,0,0,9),
 (51,'Ayam SBP Marinasi (per potong)','prepared','potong',1,0,0,0),
 (52,'Sambal Geprek Cup','prepared','cup',1,0,0,5),
 (53,'Sambal Ijo Cup','prepared','cup',1,0,0,5),
 (54,'Sambal Hitam Cup','prepared','cup',1,0,0,0),
 (55,'Saos Buldak Cup','prepared','cup',1,0,0,0),
 (56,'Saos Mentai Cup','prepared','cup',1,0,0,5),
 (57,'Saos Sadas Cup','prepared','cup',1,0,0,0)
on conflict (id) do nothing;
select setval('ingredients_id_seq', 57);

-- Resep produksi bahan setengah jadi (qty per 1 unit output)
-- guard not exists supaya aman dijalankan ulang (tidak ada duplikat resep)
insert into ingredient_recipes (ingredient_id, component_id, qty)
select v.ingredient_id, v.component_id, v.qty
from (values
 (50, 1, 1),                            -- 1 potong marinasi = 1 potong ayam (satuan dasar)
 (51, 2, 1),                            -- SBP
 (52, 13, 0.05), (52, 4, 0.0122), (52, 8, 1),   -- geprek cup: 25gr + minyak 12.2ml + cup
 (53, 14, 0.05), (53, 4, 0.0122), (53, 8, 1),   -- ijo cup
 (54, 15, 0.05), (54, 8, 1),                    -- hitam cup
 (55, 16, 0.05), (55, 8, 1),                    -- buldak cup
 (56, 17, 0.05), (56, 8, 1),                    -- mentai cup
 (57, 18, 0.05), (57, 8, 1)                     -- sadas cup
) as v(ingredient_id, component_id, qty)
where not exists (
  select 1 from ingredient_recipes r
  where r.ingredient_id = v.ingredient_id and r.component_id = v.component_id
);

-- ============ Produk & resep ============
insert into products (id, name, category_id, price, unit, sort) overriding system value values
 (1,'Ayam Dada',1,11000,'potong',1),
 (2,'Ayam Paha Atas',1,11000,'potong',2),
 (3,'Ayam Paha Bawah',1,9000,'potong',3),
 (4,'Ayam Sayap',1,8000,'potong',4),
 (5,'Ayam 1 Ekor (9 potong)',1,89000,'ekor',5),
 (6,'Ayam SBP 1 Ekor',1,89000,'ekor',6),
 (7,'Nasi Putih',2,5000,'porsi',7),
 (8,'Chicken Katsu 650ml',2,8000,'porsi',8),
 (9,'Chicken Roll',3,4000,'porsi',9),
 (10,'Bakso Goreng',3,4000,'porsi',10),
 (11,'Chicken Strip',3,4000,'porsi',11),
 (12,'Kulit Crispy',3,5000,'porsi',12),
 (13,'Kentang Goreng',3,8000,'porsi',13),
 (14,'Chicken Bun',4,10000,'porsi',14),
 (15,'Burger Ayam',4,12000,'porsi',15),
 (16,'Sambal Geprek (cup)',5,4000,'cup',16),
 (17,'Sambal Ijo (cup)',5,4000,'cup',17),
 (18,'Sambal Hitam (cup)',5,4000,'cup',18),
 (19,'Saos Buldak (cup)',5,3000,'cup',19),
 (20,'Saos Mentai (cup)',5,2000,'cup',20),
 (21,'Saos Sadas (cup)',5,3000,'cup',21),
 (22,'Rice Bowl Geprek 650',6,15000,'porsi',22),
 (23,'Rice Bowl BBQ 650',6,15000,'porsi',23),
 (24,'Rice Bowl Katsu Mentai 650',6,15000,'porsi',24),
 (25,'Rice Bowl Geprek 500',6,12000,'porsi',25),
 (26,'Rice Bowl BBQ 500',6,12000,'porsi',26),
 (27,'Teh Botol Sosro',7,5000,'porsi',27),
 (28,'Fruit Tea 250ml',7,5000,'porsi',28)
on conflict (id) do nothing;
select setval('products_id_seq', 28);

-- Resep per potong ayam (dari HPP Excel, dibagi 9)
-- marinasi 1 potong + tepung 1/27 pack + kemasan 1/200 pack + sambal 1 sachet
-- + minyak 22.2ml + plastik 1/225 pack + gas 1/180 tabung
insert into recipe_items (product_id, kind, component_id, qty)
select p.id, 'ingredient', c.component_id, c.qty
from products p,
 (values (50::bigint, 1.0::numeric),(3, 0.03704),(6, 0.005),(12, 0.008),(4, 0.02222),(7, 0.00444),(5, 0.00556)) c(component_id, qty)
where p.id in (1,2,3,4)
  and not exists (select 1 from recipe_items ri where ri.product_id = p.id and ri.component_id = c.component_id);

insert into recipe_items (product_id, kind, component_id, qty)
select p.id, 'ingredient', c.component_id, c.qty
from products p,
 (values (50::bigint, 9.0::numeric),(3, 0.33333),(6, 0.045),(12, 0.072),(4, 0.2),(7, 0.04),(5, 0.05)) c(component_id, qty)
where p.id = 5
  and not exists (select 1 from recipe_items ri where ri.product_id = p.id and ri.component_id = c.component_id);

insert into recipe_items (product_id, kind, component_id, qty)
select p.id, 'ingredient', c.component_id, c.qty
from products p,
 (values (51::bigint, 9.0::numeric),(3, 0.33333),(6, 0.045),(12, 0.072),(4, 0.2),(7, 0.04),(5, 0.05)) c(component_id, qty)
where p.id = 6
  and not exists (select 1 from recipe_items ri where ri.product_id = p.id and ri.component_id = c.component_id);

insert into recipe_items (product_id, kind, component_id, qty)
select v.product_id, v.kind, v.component_id, v.qty
from (values
 (7,'ingredient',11,0.08333),(7,'ingredient',9,0.01),(7,'ingredient',10,0.01),
 (8,'ingredient',26,1),(8,'ingredient',4,0.0191),(8,'ingredient',5,0.00654),(8,'ingredient',12,0.016),(8,'ingredient',7,0.02),(8,'ingredient',6,0.01),
 (9,'ingredient',24,0.1),(9,'ingredient',4,0.03333),(9,'ingredient',6,0.00333),(9,'ingredient',12,0.008),(9,'ingredient',7,0.00667),(9,'ingredient',5,0.00667),
 (10,'ingredient',23,0.1),(10,'ingredient',4,0.03333),(10,'ingredient',6,0.00351),(10,'ingredient',12,0.008),(10,'ingredient',7,0.02),(10,'ingredient',5,0.00667),
 (11,'ingredient',25,0.03333),(11,'ingredient',3,0.01429),(11,'ingredient',4,0.03333),(11,'ingredient',6,0.00333),(11,'ingredient',12,0.008),(11,'ingredient',7,0.01),(11,'ingredient',5,0.00667),
 (12,'ingredient',39,0.1),(12,'ingredient',3,0.01786),(12,'ingredient',4,0.03333),(12,'ingredient',34,0.01),(12,'ingredient',12,0.008),(12,'ingredient',7,0.02),(12,'ingredient',5,0.00667),
 (13,'ingredient',27,0.12),(13,'ingredient',4,0.025),(13,'ingredient',32,0.005),(13,'ingredient',12,0.016),(13,'ingredient',7,0.02),(13,'ingredient',5,0.00667),
 (14,'ingredient',28,0.25),(14,'ingredient',50,0.33333),(14,'ingredient',38,0.015),(14,'ingredient',20,0.33333),(14,'ingredient',12,0.00267),(14,'ingredient',19,0.00889),(14,'ingredient',36,0.015),(14,'ingredient',7,0.02),(14,'ingredient',31,0.01),(14,'ingredient',5,0.00667),
 (15,'ingredient',21,1),(15,'ingredient',22,1),(15,'ingredient',19,0.02222),(15,'ingredient',37,1),(15,'ingredient',38,0.014),(15,'ingredient',12,0.00837),(15,'ingredient',33,0.01),(15,'ingredient',7,0.02),(15,'ingredient',5,0.00667),
 (16,'ingredient',52,1),
 (17,'ingredient',53,1),
 (18,'ingredient',54,1),
 (19,'ingredient',55,1),
 (20,'ingredient',56,1),
 (21,'ingredient',57,1),
 (22,'ingredient',50,1),(22,'ingredient',11,0.091),(22,'ingredient',13,0.06),(22,'ingredient',35,0.02),(22,'ingredient',7,0.02),(22,'ingredient',29,0.04),(22,'ingredient',37,0.5),
 (23,'ingredient',50,1),(23,'ingredient',11,0.091),(23,'ingredient',20,0.2),(23,'ingredient',12,0.016),(23,'ingredient',35,0.02),(23,'ingredient',7,0.02),(23,'ingredient',29,0.04),(23,'ingredient',37,0.5),(23,'ingredient',36,0.0012),
 (24,'ingredient',26,1),(24,'ingredient',4,0.0191),(24,'ingredient',5,0.00654),(24,'ingredient',11,0.1024),(24,'ingredient',17,0.0341),(24,'ingredient',12,0.008),(24,'ingredient',37,0.5),(24,'ingredient',35,0.02),(24,'ingredient',7,0.02),(24,'ingredient',29,0.04),
 (25,'ingredient',50,0.75),(25,'ingredient',11,0.08),(25,'ingredient',13,0.05),(25,'ingredient',35,0.02),(25,'ingredient',7,0.02),(25,'ingredient',30,0.04),(25,'ingredient',37,0.5),
 (26,'ingredient',50,0.75),(26,'ingredient',11,0.08),(26,'ingredient',20,0.1),(26,'ingredient',12,0.008),(26,'ingredient',35,0.02),(26,'ingredient',7,0.02),(26,'ingredient',30,0.04),(26,'ingredient',37,0.5),(26,'ingredient',36,0.0012),
 (27,'ingredient',40,1),
 (28,'ingredient',41,1)
) as v(product_id, kind, component_id, qty)
where not exists (
  select 1 from recipe_items ri
  where ri.product_id = v.product_id and ri.component_id = v.component_id and ri.kind = v.kind
);

-- ============ Paket bundling ============
insert into bundles (id, name, price) overriding system value values
 (1,'Nasi + Teh Sosro',7000),
 (2,'Ayam Sayap + Nasi',12000)
on conflict (id) do nothing;
select setval('bundles_id_seq', 2);
insert into bundle_items (bundle_id, product_id, qty)
select v.bundle_id, v.product_id, v.qty
from (values (1,7,1),(1,27,1),(2,4,1),(2,7,1)) as v(bundle_id, product_id, qty)
where not exists (
  select 1 from bundle_items b where b.bundle_id = v.bundle_id and b.product_id = v.product_id
);

-- ============ Target harian (dari sheet SIMULASI) ============
insert into daily_targets (product_id, qty) values
 (5,12),(7,10),(9,10),(10,10),(11,10),(12,10),(13,5),(8,10),(16,10),(17,10),(20,10),(22,10)
on conflict (product_id) do update set qty = excluded.qty;

-- ============ Zona ongkir & outlet ============
insert into delivery_zones (radius_km, fee, sort)
select v.radius_km, v.fee, v.sort
from (values (1.0::numeric,5000,1),(3.0,10000,2),(5.0,15000,3),(8.0,20000,4)) as v(radius_km, fee, sort)
where not exists (select 1 from delivery_zones z where z.radius_km = v.radius_km);
insert into outlet_settings (id) values (1) on conflict do nothing;

-- ============ Kategori pengeluaran & pengaturan ============
insert into expense_categories (name) values
 ('Gaji'),('Sewa & Kios'),('Listrik & Air'),('Gas'),('Bensin'),('Kemasan'),('Lainnya')
on conflict (name) do nothing;

insert into settings (key, value) values
 ('store', '{"name":"Sabana Drieischicken","address":"","phone":"","footer":"Terima kasih, datang kembali!"}'),
 ('shift', '{"float_cash":350000}'),
 ('channels', '{"gofood":{"fee":10},"grabfood":{"fee":10},"shopeefood":{"fee":10}}'),
 ('oil', '{"max_days":3,"max_fry_count":60}'),
 ('margin', '{"warn_pct":15}'),
 ('receipt', '{"width_mm":58,"show_cashier":true,"show_channel":true,"header":"Sabana Drieischicken","footer":"Terima kasih, datang kembali!","show_qr":false}'),
 ('qris', '{"image":""}'),
 ('portal', '{"secret":"GANTI-RAHASIA-INI-DI-PENGATURAN","outlet_note":"Pesanan diproses setelah kasir mengonfirmasi.","delivery_enabled":true,"delivery_schedule":null}'),
 ('owner_email', '{"email":""}'),
 ('fixed_costs', '[{"name":"Listrik","amount":200000},{"name":"Karyawan","amount":1500000},{"name":"Kios","amount":1500000}]')
on conflict (key) do nothing;
