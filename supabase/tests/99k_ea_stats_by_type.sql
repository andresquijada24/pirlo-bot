-- Estadísticas de EA por tipo de partido. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values ('ab000000-0000-0000-0000-000000000001', 'club-tipo', 'Club Tipo');
insert into public.ea_matches (club_id, match_id, platform, ea_club_id, match_type, played_at, goals_for, goals_against, result)
values
  ('ab000000-0000-0000-0000-000000000001', '1', 'common-gen5', '1', 'leagueMatch', now(), 2, 0, 'victoria'),
  ('ab000000-0000-0000-0000-000000000001', '2', 'common-gen5', '1', 'friendlyMatch', now(), 1, 1, 'empate'),
  ('ab000000-0000-0000-0000-000000000001', '3', 'common-gen5', '1', 'playoffMatch', now(), 3, 2, 'victoria');
insert into public.ea_match_players (club_id, match_id, side, ea_player_id, gamertag, goals)
values
  ('ab000000-0000-0000-0000-000000000001', '1', 'propio', '10', 'Jugador', 2),
  ('ab000000-0000-0000-0000-000000000001', '2', 'propio', '10', 'Jugador', 1),
  ('ab000000-0000-0000-0000-000000000001', '3', 'propio', '10', 'Jugador', 3);

select pg_temp.expect(
  (select sum(goals) from public.v_ea_player_season_stats where club_id = 'ab000000-0000-0000-0000-000000000001') = 6,
  'sin filtrar, los totales son los de siempre');
select pg_temp.expect(
  (select goals from public.v_ea_player_season_stats
    where club_id = 'ab000000-0000-0000-0000-000000000001' and match_type = 'friendlyMatch') = 1,
  'amistosos por separado');
select pg_temp.expect(
  (select sum(goals) from public.v_ea_player_season_stats
    where club_id = 'ab000000-0000-0000-0000-000000000001' and match_type in ('leagueMatch', 'playoffMatch')) = 5,
  'liga y copa por separado');

rollback;
