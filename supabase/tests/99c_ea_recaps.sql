-- Pruebas del resumen de partidos de EA. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values
  ('ac000000-0000-0000-0000-000000000001', 'club-rc', 'Club RC'),
  ('ac000000-0000-0000-0000-000000000002', 'club-rd', 'Club RD');
insert into public.players (id, display_name, discord_user_id) values
  ('ac300000-0000-0000-0000-000000000001', 'Delantero Ficticio', '750000000000000001');
insert into public.club_memberships (club_id, player_id, role, gamertag) values
  ('ac000000-0000-0000-0000-000000000001', 'ac300000-0000-0000-0000-000000000001', 'jugador', 'Ficticio9');
insert into public.club_ea_links (club_id, platform, ea_club_id, consented_by)
  values ('ac000000-0000-0000-0000-000000000001', 'common-gen5', '12345', '750000000000000001');
insert into public.ea_matches (club_id, match_id, platform, ea_club_id, match_type, played_at, goals_for, goals_against, result, opponent_name, processed_at) values
  ('ac000000-0000-0000-0000-000000000001', '1', 'common-gen5', '12345', 'leagueMatch', now() - interval '2 hours', 2, 1, 'victoria', 'Rival Uno', now()),
  ('ac000000-0000-0000-0000-000000000001', '2', 'common-gen5', '12345', 'leagueMatch', now() - interval '1 hour', 0, 0, 'empate', 'Rival Dos', now()),
  ('ac000000-0000-0000-0000-000000000001', '3', 'common-gen5', '12345', 'leagueMatch', now() - interval '9 days', 1, 0, 'victoria', 'Viejo', now() - interval '3 days');
insert into public.ea_match_players (club_id, match_id, side, ea_player_id, gamertag, goals, assists, rating, man_of_the_match) values
  ('ac000000-0000-0000-0000-000000000001', '1', 'propio', '100', 'Ficticio9', 2, null, 8.5, true),
  ('ac000000-0000-0000-0000-000000000001', '1', 'propio', '200', 'SinFicha', 0, 1, 7.0, false),
  ('ac000000-0000-0000-0000-000000000001', '1', 'rival', '900', 'RivalFicticio', 1, 0, 6.0, false);

-- 1. Reclamar: solo lo reciente, y nunca dos veces.
select pg_temp.expect(
  (select array_agg(id order by id) = array['1', '2'] from public.claim_ea_recaps('ac000000-0000-0000-0000-000000000001', 10) id),
  'se reclaman los partidos procesados en las últimas 24 h');
select pg_temp.expect(
  not exists (select 1 from public.claim_ea_recaps('ac000000-0000-0000-0000-000000000001', 10)),
  'un partido reclamado no se vuelve a reclamar');
select pg_temp.expect(
  not exists (select 1 from public.claim_ea_recaps('ac000000-0000-0000-0000-000000000002', 10)),
  'cada club reclama solo lo suyo');

-- 2. Liberar tras un fallo temporal.
select public.release_ea_recaps('ac000000-0000-0000-0000-000000000001', array['2']);
select pg_temp.expect(
  (select array_agg(id) = array['2'] from public.claim_ea_recaps('ac000000-0000-0000-0000-000000000001', 10) id),
  'un partido liberado se puede volver a anunciar');

-- 3. Contenido: nombre del club para los vinculados, gamertag para el resto, nunca rivales.
select pg_temp.expect(
  (select r -> 0 -> 'players' -> 0 ->> 'name' = 'Delantero Ficticio'
      and r -> 0 -> 'players' -> 1 ->> 'name' = 'SinFicha'
      and jsonb_array_length(r -> 0 -> 'players') = 2
      and r -> 0 -> 'players' -> 0 -> 'assists' = 'null'::jsonb
      and r -> 0 ->> 'opponentName' = 'Rival Uno'
     from public.ea_recap('ac000000-0000-0000-0000-000000000001', array['1']) r),
  'el resumen trae solo jugadores propios; sin dato = null');
select pg_temp.expect(
  (select r = '[]'::jsonb from public.ea_recap('ac000000-0000-0000-0000-000000000002', array['1']) r),
  'un club no lee el resumen de otro');

select pg_temp.expect(
  not has_function_privilege('anon', 'public.claim_ea_recaps(uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.ea_recap(uuid, text[])', 'execute'),
  'solo el servidor usa estas funciones');

rollback;
