-- Pruebas de las estadísticas por sesión (migración 8).
begin;

insert into public.clubs (id, slug, name, stats_provider) values
  ('e0000000-0000-0000-0000-000000000000', 'club-e', 'Club E', 'maritimo'),
  ('f0000000-0000-0000-0000-000000000000', 'club-f', 'Club F', 'manual');
insert into public.seasons (id, club_id, name, is_current) values
  ('e5000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000000', 'T1', true);
insert into public.sessions (id, club_id, season_id, played_on, source, external_id, matches_played, wins, draws, losses) values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000000',
   'e5000000-0000-0000-0000-000000000000', '2026-10-20', 'maritimo', 'msg-1', 4, 3, 0, 1),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000000',
   'e5000000-0000-0000-0000-000000000000', '2026-10-21', 'maritimo', 'msg-2', 2, 1, 1, 0);

-- Copia duplicada de msg-2 publicada por el proveedor.
insert into public.sessions (id, club_id, season_id, played_on, source, external_id, matches_played, is_duplicate) values
  ('e1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000000',
   'e5000000-0000-0000-0000-000000000000', '2026-10-21', 'maritimo', 'msg-2-copia', 2, true);

insert into public.player_session_stats
  (id, club_id, session_id, source, source_player_id, source_player_name,
   matches_played, rating, goals, assists, passes_made, passes_attempted, tackles_made, tackles_attempted) values
  ('e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000000',
   'e1000000-0000-0000-0000-000000000001', 'maritimo', 'jug-1', 'Pirlo21', 4, 8.0, 3, 1, 50, 60, 5, 10),
  ('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000000',
   'e1000000-0000-0000-0000-000000000002', 'maritimo', 'jug-1', 'Pirlo21', 2, 6.5, 1, null, 20, 20, 1, 5),
  ('e2000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000000',
   'e1000000-0000-0000-0000-000000000003', 'maritimo', 'jug-1', 'Pirlo21', 2, 6.5, 1, 0, 20, 20, 1, 5);

-- Totales: excluyen la copia duplicada, suman bien y no inventan ceros.
select pg_temp.expect(
  (select sessions = 2 and matches_played = 6 and goals = 4 and assists = 1
     and pass_pct = 87.5 and tackle_pct = 40.0 and avg_rating = 7.50
   from public.v_player_session_season_stats where source_player_id = 'jug-1'),
  'los totales por sesión excluyen duplicados y calculan porcentajes y nota ponderada');

insert into public.player_session_stats (club_id, session_id, source, source_player_id, source_player_name) values
  ('e0000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'maritimo', 'jug-2', 'Sin datos');
select pg_temp.expect(
  (select goals is null and pass_pct is null and avg_rating is null
   from public.v_player_session_season_stats where source_player_id = 'jug-2'),
  'un jugador sin métricas tiene totales NULL, no 0');

-- Aislamiento: estadística del club F apuntando a una sesión del club E.
select pg_temp.expect_error($$
  insert into public.player_session_stats (club_id, session_id, source, source_player_id, source_player_name)
  values ('f0000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'manual', 'x', 'x')
$$, '23503', 'una estadística del club F no puede apuntar a una sesión del club E');

-- Validaciones.
select pg_temp.expect_error($$
  update public.player_session_stats set passes_made = 99 where id = 'e2000000-0000-0000-0000-000000000002'
$$, '23514', 'pases completados no pueden superar los intentados');
select pg_temp.expect_error($$
  update public.player_session_stats set goals_manual = 5 where id = 'e2000000-0000-0000-0000-000000000001'
$$, '23514', 'los goles manuales no pueden superar el total');
select pg_temp.expect_error($$
  update public.sessions set wins = 5 where id = 'e1000000-0000-0000-0000-000000000001'
$$, '23514', 'victorias + empates + derrotas no pueden superar los partidos de la sesión');
select pg_temp.expect_error($$
  insert into public.sessions (club_id, played_on, source, external_id)
  values ('e0000000-0000-0000-0000-000000000000', '2026-10-22', 'maritimo', 'msg-1')
$$, '23505', 'una sesión externa no se importa dos veces');
select pg_temp.expect_error($$
  insert into public.player_session_stats (club_id, session_id, source, source_player_id, source_player_name)
  values ('e0000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000001', 'maritimo', 'jug-1', 'x')
$$, '23505', 'un jugador aparece una sola vez por sesión');

-- Correcciones registradas con motivo y sin necesidad de partido.
select set_config('pirlo.change_reason', 'corrección de asistencias en origen', true);
update public.player_session_stats set assists = 2 where id = 'e2000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  (select session_id = 'e1000000-0000-0000-0000-000000000001' and match_id is null
     and old_value = '1'::jsonb and new_value = '2'::jsonb
   from public.stat_revisions where stat_id = 'e2000000-0000-0000-0000-000000000001' and field = 'assists'),
  'una corrección por sesión queda en el historial');

-- Vinculación posterior: al asignar player_id, los totales pasan a ese jugador.
insert into public.players (id, display_name) values ('e3000000-0000-0000-0000-000000000001', 'Pirlo');
update public.player_session_stats set player_id = 'e3000000-0000-0000-0000-000000000001'
  where source_player_id = 'jug-1';
select pg_temp.expect(
  (select count(*) = 1 from public.v_player_session_season_stats
   where player_id = 'e3000000-0000-0000-0000-000000000001'),
  'al vincular el jugador, sus estadísticas quedan asociadas');

-- Seguridad.
select pg_temp.expect(
  not has_table_privilege('anon', 'public.player_session_stats', 'select')
  and not has_table_privilege('authenticated', 'public.v_player_session_season_stats', 'select'),
  'las claves públicas no acceden a las estadísticas por sesión');

rollback;
