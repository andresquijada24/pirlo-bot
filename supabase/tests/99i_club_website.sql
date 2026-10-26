-- Pruebas del sitio web del club. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values ('ad000000-0000-0000-0000-000000000001', 'club-sitio', 'Club Sitio');
insert into public.players (id, display_name, discord_user_id) values
  ('ad300000-0000-0000-0000-000000000001', 'Admin', '770000000000000001'),
  ('ad300000-0000-0000-0000-000000000002', 'DT', '770000000000000002');
insert into public.club_memberships (club_id, player_id, role) values
  ('ad000000-0000-0000-0000-000000000001', 'ad300000-0000-0000-0000-000000000001', 'admin'),
  ('ad000000-0000-0000-0000-000000000001', 'ad300000-0000-0000-0000-000000000002', 'dt');

select pg_temp.expect_error($$
  select public.set_club_website('ad000000-0000-0000-0000-000000000001', 'https://club.example', '770000000000000002')
$$, 'P0001', 'un DT no lo cambia');
select public.set_club_website('ad000000-0000-0000-0000-000000000001', 'https://www.club.example/inicio', '770000000000000001');
select pg_temp.expect(
  (select website_url = 'https://www.club.example/inicio' from public.clubs where id = 'ad000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.audit_log where club_id = 'ad000000-0000-0000-0000-000000000001' and action = 'club.website'),
  'el admin lo guarda y queda auditado');
select pg_temp.expect_error($$
  select public.set_club_website('ad000000-0000-0000-0000-000000000001', 'javascript:alert(1)', '770000000000000001')
$$, '23514', 'solo https');
select pg_temp.expect_error($$
  select public.set_club_website('ad000000-0000-0000-0000-000000000001', 'http://club.example', '770000000000000001')
$$, '23514', 'http no');
select public.set_club_website('ad000000-0000-0000-0000-000000000001', null, '770000000000000001');
select pg_temp.expect(
  (select website_url is null from public.clubs where id = 'ad000000-0000-0000-0000-000000000001'),
  'se puede quitar');

rollback;
