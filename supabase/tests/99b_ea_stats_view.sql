-- Pruebas de las estadísticas de EA para /stats y /ranking. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name, timezone) values
  ('ab000000-0000-0000-0000-000000000001', 'club-ab', 'Club AB', 'America/Caracas'),
  ('ab000000-0000-0000-0000-000000000002', 'club-ac', 'Club AC', 'America/Caracas');
insert into public.players (id, display_name, discord_user_id) values
  ('ab300000-0000-0000-0000-000000000001', 'Admin', '740000000000000001'),
  ('ab300000-0000-0000-0000-000000000002', 'Delantero', '740000000000000002');
insert into public.club_memberships (club_id, player_id, role, gamertag) values
  ('ab000000-0000-0000-0000-000000000001', 'ab300000-0000-0000-0000-000000000001', 'admin', null),
  ('ab000000-0000-0000-0000-000000000001', 'ab300000-0000-0000-0000-000000000002', 'jugador', 'Ficticio9');
insert into public.club_ea_links (club_id, platform, ea_club_id, consented_by)
  values ('ab000000-0000-0000-0000-000000000001', 'common-gen5', '12345', '740000000000000001');

-- Dos partidos el mismo día local (Caracas) y uno al día siguiente.
insert into public.ea_matches (club_id, match_id, platform, ea_club_id, match_type, played_at, goals_for, goals_against, result) values
  ('ab000000-0000-0000-0000-000000000001', '1', 'common-gen5', '12345', 'leagueMatch', '2026-10-25T01:00:00Z', 2, 1, 'victoria'),
  ('ab000000-0000-0000-0000-000000000001', '2', 'common-gen5', '12345', 'leagueMatch', '2026-10-25T02:00:00Z', 1, 1, 'empate'),
  ('ab000000-0000-0000-0000-000000000001', '3', 'common-gen5', '12345', 'leagueMatch', '2026-10-26T01:00:00Z', 0, 2, 'derrota');
insert into public.ea_match_players (club_id, match_id, side, ea_player_id, gamertag, goals, assists, rating, passes_made, passes_attempted) values
  ('ab000000-0000-0000-0000-000000000001', '1', 'propio', '100', 'Ficticio9', 2, 1, 8.0, 10, 12),
  ('ab000000-0000-0000-0000-000000000001', '2', 'propio', '100', 'Ficticio9', 1, null, 7.0, 5, 5),
  ('ab000000-0000-0000-0000-000000000001', '3', 'propio', '100', 'Ficticio9', 0, 0, null, null, null),
  ('ab000000-0000-0000-0000-000000000001', '1', 'propio', '200', 'SinFicha', 0, 1, 6.5, null, null),
  ('ab000000-0000-0000-0000-000000000001', '1', 'rival', '900', 'RivalFicticio', 1, 0, 6.0, null, null);

select pg_temp.expect(
  (select player_id = 'ab300000-0000-0000-0000-000000000002' and sessions = 2 and matches_played = 3
          and goals = 3 and assists = 1 and rating_points = 15.0 and rated_matches = 2
          and passes_made = 15 and dribbles is null and interceptions is null
     from public.v_ea_player_season_stats where source_player_id = '100'),
  'suma los partidos del jugador vinculado por su gamertag; sesiones = días locales');
select pg_temp.expect(
  (select player_id is null and source_player_name = 'SinFicha' and passes_made is null
     from public.v_ea_player_season_stats where source_player_id = '200'),
  'sin gamertag en la plantilla queda sin vincular; sin dato sigue siendo NULL');
select pg_temp.expect(
  not exists (select 1 from public.v_ea_player_season_stats where source_player_id = '900'),
  'los rivales nunca aparecen en las estadísticas del club');
select pg_temp.expect(
  not exists (select 1 from public.v_ea_player_season_stats where club_id = 'ab000000-0000-0000-0000-000000000002'),
  'cada club solo ve lo suyo');
select pg_temp.expect(
  not has_table_privilege('anon', 'public.v_ea_player_season_stats', 'select')
  and has_table_privilege('service_role', 'public.v_ea_player_season_stats', 'select'),
  'solo el servidor lee la vista');

rollback;
