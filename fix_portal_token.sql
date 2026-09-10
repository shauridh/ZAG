create or replace function portal_token(p_cid bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare payload text; sig text; secret text;
begin
  secret := coalesce(get_setting('portal','{"secret":"ubah-ini-di-pengaturan"}') ->> 'secret', 'ubah-ini-di-pengaturan');
  -- convert_to butuh encoding karakter (utf8); base64 adalah format encode().
  -- Padding '=' dibuang dulu (rtrim) supaya karakter '_' di base64url tidak ambigu.
  payload := translate(rtrim(encode(convert_to(json_build_object('cid',p_cid,'exp',(extract(epoch from now())+2592000)::bigint)::text,'utf8'),'base64'), '='), '+/', '-_');
  -- hmac() -> bytea, encode ke base64 text, lalu ubah ke base64url
  -- (rtrim: encode base64 selalu menambah baris baru di akhir)
  sig := encode(hmac(convert_to(payload,'utf8'), convert_to(secret,'utf8'), 'sha256'), 'base64');
  sig := translate(rtrim(sig, chr(10)), '+/=', '-_');
  return payload || '.' || sig;
end $$;

create or replace function portal_verify(p_token text) returns bigint
language plpgsql stable security definer set search_path = public, extensions as $$
declare payload text; sig text; expect text; secret text; cid bigint; exp bigint; j jsonb; v_b64 text;
begin
  if p_token is null or position('.' in p_token) = 0 then return null; end if;
  payload := split_part(p_token, '.', 1);
  sig := split_part(p_token, '.', 2);
  secret := coalesce(get_setting('portal','{"secret":"ubah-ini-di-pengaturan"}') ->> 'secret', 'ubah-ini-di-pengaturan');
  expect := encode(hmac(convert_to(payload,'utf8'), convert_to(secret,'utf8'), 'sha256'), 'base64');
  expect := translate(rtrim(expect, chr(10)), '+/=', '-_');
  if sig <> expect then return null; end if;
  -- base64url -> base64 standar, lalu kembalikan padding '=' (dibuang saat generate)
  v_b64 := translate(payload, '-_', '+/');
  if length(v_b64) % 4 = 2 then v_b64 := v_b64 || '==';
  elsif length(v_b64) % 4 = 3 then v_b64 := v_b64 || '='; end if;
  j := convert_from(decode(v_b64, 'base64'), 'utf8')::jsonb;
  exp := (j->>'exp')::bigint;
  if exp < extract(epoch from now()) then return null; end if;
  cid := (j->>'cid')::bigint;
  if not exists (select 1 from customers where id = cid) then return null; end if;
  return cid;
end $$;

