-- Pruebas de las fechas de temporada y la reasignación de sesiones (migración 20261024170000).
begin;

insert into public.clubs (id, slug, name, stats_provider) values
  ('a6000000-0000-0000-0000-000000000000', 'club-t', 'Club T', 'maritimo'),
  ('a6000000-0000-0000-0000-000000000001', 'club-otro', 'Club Otro', 'manual');
-- Temporada creada "hoy" sin fechas, como hace /temporada crear.
insert into public.seasons (id, club_id, name, is_current, created_at) values
  ('a6100000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000000', 'T1', true, '2026-10-24'),
  ('a6100000-0000-0000-0000-000000000009', 'a6000000-0000-0000-0000-000000000001', 'T1', true, '2026-10-24');

-- Sesiones anteriores a la creación de la temporada (sin temporada) y una posterior.
insert into public.sessions (id, club_id, season_id, played_on) values
  ('a6200000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000000', null, '2026-09-17'),
  ('a6200000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000000', null, '2026-09-18'),
  ('a6200000-0000-0000-0000-000000000003', 'a6000000-0000-0000-0000-000000000000', null, '2026-10-23'),
  ('a6200000-0000-0000-0000-000000000004', 'a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000001', '2026-10-25'),
  ('a6200000-0000-0000-0000-000000000009', 'a6000000-0000-0000-0000-000000000001', null, '2026-10-01');

select pg_temp.expect(
  public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000001',
                          '2026-09-18', null, '600000000000000001') = 2,
  'poner inicio 18/09 reasigna las 2 sesiones desde esa fecha');
select pg_temp.expect(
  (select season_id is null from public.sessions where id = 'a6200000-0000-0000-0000-000000000001'),
  'la sesión anterior al inicio sigue sin temporada');
select pg_temp.expect(
  (select count(*) = 3 from public.sessions
    where club_id = 'a6000000-0000-0000-0000-000000000000' and season_id = 'a6100000-0000-0000-0000-000000000001'),
  'las sesiones desde el inicio (incluida la posterior) quedan en la temporada');
select pg_temp.expect(
  (select starts_on = '2026-09-18' and ends_on is null from public.seasons where id = 'a6100000-0000-0000-0000-000000000001'),
  'la temporada guarda su fecha de inicio');
select pg_temp.expect(
  (select season_id is null from public.sessions where id = 'a6200000-0000-0000-0000-000000000009'),
  'no toca las sesiones de otro club');
select pg_temp.expect(
  exists (select 1 from public.audit_log where action = 'season.dates'
            and entity_id = 'a6100000-0000-0000-0000-000000000001' and details ->> 'sesiones_reasignadas' = '2'),
  'el cambio queda en el registro de auditoría');

-- Repetirlo no mueve nada.
select pg_temp.expect(
  public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000001',
                          '2026-09-18', null, '600000000000000001') = 0,
  'repetir las mismas fechas no reasigna nada');

-- Una fecha de fin saca de la temporada lo posterior.
select pg_temp.expect(
  public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000001',
                          '2026-09-18', '2026-10-24', '600000000000000001') = 1,
  'con fecha de fin, la sesión posterior sale de la temporada');

-- Errores.
select pg_temp.expect_error(
  $q$select public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000001',
                                    '2026-10-01', '2026-09-01', '600000000000000001')$q$,
  'P0001', 'el fin no puede ser anterior al inicio');
select pg_temp.expect_error(
  $q$select public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000009',
                                    '2026-09-18', null, '600000000000000001')$q$,
  'P0002', 'no se pueden poner fechas a una temporada de otro club');
insert into public.seasons (id, club_id, name, is_current) values
  ('a6100000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000000', 'T2', false);
select pg_temp.expect_error(
  $q$select public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000002',
                                    '2026-10-01', null, '600000000000000001')$q$,
  'P0001', 'dos temporadas con fechas no pueden solaparse');
select pg_temp.expect(
  public.set_season_dates('a6000000-0000-0000-0000-000000000000', 'a6100000-0000-0000-0000-000000000002',
                          '2026-10-25', null, '600000000000000001') = 1,
  'una temporada que empieza tras el fin de la anterior recibe sus sesiones');

-- Permisos: solo el servidor del bot.
select pg_temp.expect(
  not has_function_privilege('anon', 'public.set_season_dates(uuid, uuid, date, date, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_season_dates(uuid, uuid, date, date, text)', 'execute')
  and has_function_privilege('service_role', 'public.set_season_dates(uuid, uuid, date, date, text)', 'execute'),
  'solo service_role puede ejecutar set_season_dates');

rollback;
