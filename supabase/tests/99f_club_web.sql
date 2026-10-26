-- Pruebas de la página pública del club. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values ('af000000-0000-0000-0000-000000000001', 'club-web', 'Club Web');
insert into public.players (id, display_name, discord_user_id) values
  ('af300000-0000-0000-0000-000000000001', 'Admin', '780000000000000001'),
  ('af300000-0000-0000-0000-000000000002', 'DT', '780000000000000002');
insert into public.club_memberships (club_id, player_id, role) values
  ('af000000-0000-0000-0000-000000000001', 'af300000-0000-0000-0000-000000000001', 'admin'),
  ('af000000-0000-0000-0000-000000000001', 'af300000-0000-0000-0000-000000000002', 'dt');

select pg_temp.expect(
  (select not web_public from public.clubs where id = 'af000000-0000-0000-0000-000000000001'),
  'la página empieza desactivada');
select pg_temp.expect_error($$
  select public.set_club_web('af000000-0000-0000-0000-000000000001', true, '780000000000000002')
$$, 'P0001', 'un DT no la activa');
select public.set_club_web('af000000-0000-0000-0000-000000000001', true, '780000000000000001');
select pg_temp.expect(
  (select web_public from public.clubs where id = 'af000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.audit_log where club_id = 'af000000-0000-0000-0000-000000000001' and action = 'club.web'),
  'el admin la activa y queda auditado');

rollback;
