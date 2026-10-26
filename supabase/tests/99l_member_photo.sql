-- Pruebas de la foto del jugador. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values
  ('aa000000-0000-0000-0000-000000000001', 'club-foto', 'Club Foto'),
  ('aa000000-0000-0000-0000-000000000002', 'club-otro', 'Club Otro');
insert into public.players (id, display_name, discord_user_id) values
  ('aa300000-0000-0000-0000-000000000001', 'Admin', '760000000000000001'),
  ('aa300000-0000-0000-0000-000000000002', 'Jugador', '760000000000000002'),
  ('aa300000-0000-0000-0000-000000000003', 'Otro', '760000000000000003'),
  ('aa300000-0000-0000-0000-000000000004', 'AdminAjeno', '760000000000000004');
insert into public.club_memberships (id, club_id, player_id, role) values
  ('aa400000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'aa300000-0000-0000-0000-000000000001', 'admin'),
  ('aa400000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'aa300000-0000-0000-0000-000000000002', 'jugador'),
  ('aa400000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000001', 'aa300000-0000-0000-0000-000000000003', 'jugador'),
  ('aa400000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000002', 'aa300000-0000-0000-0000-000000000004', 'admin');

select public.set_member_photo('aa000000-0000-0000-0000-000000000001', 'aa400000-0000-0000-0000-000000000002', 'QUJD', '760000000000000002');
select pg_temp.expect(
  (select photo_jpg = 'QUJD' from public.club_memberships where id = 'aa400000-0000-0000-0000-000000000002')
  and exists (select 1 from public.audit_log where action = 'member.photo' and entity_id = 'aa400000-0000-0000-0000-000000000002'),
  'el propio jugador sube su foto y queda auditado');
select pg_temp.expect_error($$
  select public.set_member_photo('aa000000-0000-0000-0000-000000000001', 'aa400000-0000-0000-0000-000000000002', 'QUJD', '760000000000000003')
$$, 'P0001', 'otro jugador no puede');
select pg_temp.expect_error($$
  select public.set_member_photo('aa000000-0000-0000-0000-000000000001', 'aa400000-0000-0000-0000-000000000002', 'QUJD', '760000000000000004')
$$, 'P0001', 'un admin de otro club no puede');
select public.set_member_photo('aa000000-0000-0000-0000-000000000001', 'aa400000-0000-0000-0000-000000000003', 'REVG', '760000000000000001');
select pg_temp.expect(
  (select photo_jpg = 'REVG' from public.club_memberships where id = 'aa400000-0000-0000-0000-000000000003'),
  'un admin del club puede');
select pg_temp.expect_error($$
  select public.set_member_photo('aa000000-0000-0000-0000-000000000002', 'aa400000-0000-0000-0000-000000000002', 'QUJD', '760000000000000004')
$$, 'P0002', 'no se cruzan clubes');
select pg_temp.expect_error($$
  update public.club_memberships set photo_jpg = '<script>' where id = 'aa400000-0000-0000-0000-000000000002'
$$, '23514', 'solo base64');

rollback;
