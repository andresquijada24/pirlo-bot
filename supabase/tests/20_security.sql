-- Pruebas de seguridad: las claves públicas no acceden a nada; el servidor sí.
begin;

select pg_temp.expect(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  'todas las tablas tienen RLS activado');

select pg_temp.expect(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
  ),
  'anon y authenticated no tienen permisos sobre ninguna tabla o vista');

insert into public.clubs (slug, name) values ('club-seguridad', 'Club Seguridad');

set local role anon;
select pg_temp.expect_error($$ select * from public.clubs $$, '42501', 'anon no puede leer clubes');
select pg_temp.expect_error($$ insert into public.clubs (slug, name) values ('x', 'x') $$, '42501',
  'anon no puede crear clubes');
select pg_temp.expect_error($$ select * from public.v_player_season_stats $$, '42501',
  'anon no puede leer las vistas de estadísticas');
reset role;

set local role authenticated;
select pg_temp.expect_error($$ select * from public.player_match_stats $$, '42501',
  'authenticated no puede leer estadísticas');
reset role;

set local role service_role;
select pg_temp.expect(
  (select count(*) from public.clubs where slug = 'club-seguridad') = 1,
  'service_role (servidor del bot) sí puede leer');
reset role;

rollback;
