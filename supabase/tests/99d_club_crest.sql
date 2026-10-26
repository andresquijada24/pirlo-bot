-- Pruebas del escudo del club. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values ('ad000000-0000-0000-0000-000000000001', 'club-es', 'Club ES');
insert into public.players (id, display_name, discord_user_id) values
  ('ad300000-0000-0000-0000-000000000001', 'Admin', '760000000000000001'),
  ('ad300000-0000-0000-0000-000000000002', 'DT', '760000000000000002');
insert into public.club_memberships (club_id, player_id, role) values
  ('ad000000-0000-0000-0000-000000000001', 'ad300000-0000-0000-0000-000000000001', 'admin'),
  ('ad000000-0000-0000-0000-000000000001', 'ad300000-0000-0000-0000-000000000002', 'dt');

select pg_temp.expect_error($$
  select public.set_club_crest('ad000000-0000-0000-0000-000000000001', 'iVBORw0KGgo=', '760000000000000002')
$$, 'P0001', 'un DT no cambia el escudo');
select public.set_club_crest('ad000000-0000-0000-0000-000000000001', 'iVBORw0KGgo=', '760000000000000001');
select pg_temp.expect(
  (select crest_png = 'iVBORw0KGgo=' from public.clubs where id = 'ad000000-0000-0000-0000-000000000001')
  and (select details ->> 'bytes' = '12' and not (details ? 'png') from public.audit_log
        where club_id = 'ad000000-0000-0000-0000-000000000001' and action = 'club.crest'),
  'el admin guarda el escudo; la auditoría no copia la imagen');
select pg_temp.expect_error($$
  update public.clubs set crest_png = '<svg onload=x>' where id = 'ad000000-0000-0000-0000-000000000001'
$$, '23514', 'solo base64');
select public.set_club_crest('ad000000-0000-0000-0000-000000000001', null, '760000000000000001');
select pg_temp.expect(
  (select crest_png is null from public.clubs where id = 'ad000000-0000-0000-0000-000000000001'),
  'se puede quitar');

rollback;
