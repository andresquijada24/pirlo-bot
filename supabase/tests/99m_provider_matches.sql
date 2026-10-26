-- Calendario del proveedor y tipo de partido de las sesiones. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name, stats_provider) values
  ('ac000000-0000-0000-0000-000000000001', 'club-cal', 'Club Calendario', 'maritimo');

-- Día 1: dos partidos de liga y una sesión de 2 partidos → la sesión es de liga.
-- Día 2: un partido de liga y uno amistoso, sesión de 2 → mezcla: sin tipo.
-- Día 3: un partido de copa, pero la sesión tiene 3 partidos → no cuadra: sin tipo.
select public.sync_apply_match('ac000000-0000-0000-0000-000000000001', 'maritimo', m::jsonb) from (values
  ('{"externalId":"p1","competition":"liga","startsAt":"2026-10-01T23:00:00Z","state":"finalizado","goalsFor":2,"goalsAgainst":0,"opponent":"Rival A","name":null,"updatedAt":"2026-10-02T00:00:00Z"}'),
  ('{"externalId":"p2","competition":"liga","startsAt":"2026-10-01T23:30:00Z","state":"finalizado","goalsFor":1,"goalsAgainst":1,"opponent":"Rival B","name":null,"updatedAt":"2026-10-02T00:00:00Z"}'),
  ('{"externalId":"p3","competition":"liga","startsAt":"2026-10-02T23:00:00Z","state":"finalizado","goalsFor":null,"goalsAgainst":null,"opponent":null,"name":null,"updatedAt":"2026-10-03T00:00:00Z"}'),
  ('{"externalId":"p4","competition":"amistoso","startsAt":"2026-10-02T23:30:00Z","state":"finalizado","goalsFor":3,"goalsAgainst":2,"opponent":null,"name":null,"updatedAt":"2026-10-03T00:00:00Z"}'),
  ('{"externalId":"p5","competition":"torneo","startsAt":"2026-10-03T23:00:00Z","state":"finalizado","goalsFor":0,"goalsAgainst":1,"opponent":null,"name":"Copa X","updatedAt":"2026-10-04T00:00:00Z"}'),
  ('{"externalId":"p6","competition":"liga","startsAt":"2026-10-03T23:30:00Z","state":"cancelado","goalsFor":null,"goalsAgainst":null,"opponent":null,"name":null,"updatedAt":"2026-10-04T00:00:00Z"}')
) v(m);

select pg_temp.expect(
  (select status = 'jugado' and goals_for = 2 and match_type = 'leagueMatch' from public.matches where external_id = 'p1'),
  'partido finalizado con marcador: jugado y de liga');
select pg_temp.expect(
  (select status = 'programado' and goals_for is null from public.matches where external_id = 'p3'),
  'finalizado sin marcador: no se inventa el resultado');
select pg_temp.expect(
  (select match_type = 'playoffMatch' from public.matches where external_id = 'p5'),
  'torneo cuenta como copa');
select pg_temp.expect(
  (select status = 'anulado' from public.matches where external_id = 'p6'), 'cancelado: anulado');
select pg_temp.expect(
  public.sync_apply_match('ac000000-0000-0000-0000-000000000001', 'maritimo',
    '{"externalId":"p1","competition":"liga","startsAt":"2026-10-01T23:00:00Z","state":"finalizado","goalsFor":2,"goalsAgainst":0,"opponent":"Rival A","name":null,"updatedAt":"2026-10-02T00:00:00Z"}') = 'sin_cambios',
  'misma versión: sin cambios');

insert into public.sessions (id, club_id, played_on, source, external_id, matches_played) values
  ('ac100000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000001', '2026-10-01', 'maritimo', 's1', 2),
  ('ac100000-0000-0000-0000-000000000002', 'ac000000-0000-0000-0000-000000000001', '2026-10-02', 'maritimo', 's2', 2),
  ('ac100000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000001', '2026-10-03', 'maritimo', 's3', 3);
insert into public.player_session_stats (club_id, session_id, source, source_player_id, source_player_name, matches_played, goals) values
  ('ac000000-0000-0000-0000-000000000001', 'ac100000-0000-0000-0000-000000000001', 'maritimo', 'j1', 'Jugador', 2, 2),
  ('ac000000-0000-0000-0000-000000000001', 'ac100000-0000-0000-0000-000000000002', 'maritimo', 'j1', 'Jugador', 2, 1),
  ('ac000000-0000-0000-0000-000000000001', 'ac100000-0000-0000-0000-000000000003', 'maritimo', 'j1', 'Jugador', 3, 4);

select pg_temp.expect(
  (select match_type = 'leagueMatch' from public.v_session_match_type where session_id = 'ac100000-0000-0000-0000-000000000001'),
  'sesión de un día solo de liga: liga');
select pg_temp.expect(
  not exists (select 1 from public.v_session_match_type where session_id in
    ('ac100000-0000-0000-0000-000000000002', 'ac100000-0000-0000-0000-000000000003')),
  'mezcla o recuento distinto: sin tipo');
select pg_temp.expect(
  (select sum(goals) from public.v_player_session_season_stats where club_id = 'ac000000-0000-0000-0000-000000000001') = 7,
  'sin filtrar, los totales son los de siempre');
select pg_temp.expect(
  (select goals from public.v_player_session_season_stats
    where club_id = 'ac000000-0000-0000-0000-000000000001' and match_type = 'leagueMatch') = 2,
  'liga por separado');

-- Borrado en origen: el partido se anula y deja de contar.
select pg_temp.expect(
  public.sync_apply_deletion('ac000000-0000-0000-0000-000000000001', 'maritimo', 'partido', 'p2'), 'borrado aplicado');
select pg_temp.expect(
  not exists (select 1 from public.v_session_match_type where session_id = 'ac100000-0000-0000-0000-000000000001'),
  'tras el borrado, el día ya no cuadra');

rollback;
