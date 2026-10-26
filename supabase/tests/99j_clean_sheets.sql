-- Pruebas de porterías a cero. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values ('ac000000-0000-0000-0000-000000000001', 'club-cs', 'Club CS');
insert into public.ea_matches (club_id, match_id, platform, ea_club_id, match_type, played_at, goals_for, goals_against, result)
values
  ('ac000000-0000-0000-0000-000000000001', '1', 'common-gen5', '1', 'leagueMatch', now(), 2, 0, 'victoria'),
  ('ac000000-0000-0000-0000-000000000001', '2', 'common-gen5', '1', 'leagueMatch', now(), 1, 1, 'empate'),
  ('ac000000-0000-0000-0000-000000000001', '3', 'common-gen5', '1', 'leagueMatch', now(), 1, 0, 'victoria');
insert into public.ea_match_players (club_id, match_id, side, ea_player_id, gamertag, position)
values
  ('ac000000-0000-0000-0000-000000000001', '1', 'propio', '10', 'Portero', 'goalkeeper'),
  ('ac000000-0000-0000-0000-000000000001', '2', 'propio', '10', 'Portero', 'goalkeeper'),
  ('ac000000-0000-0000-0000-000000000001', '3', 'propio', '10', 'Portero', 'defender'),
  ('ac000000-0000-0000-0000-000000000001', '1', 'propio', '20', 'Delantero', 'forward'),
  ('ac000000-0000-0000-0000-000000000001', '1', 'rival', '30', 'PorteroRival', 'goalkeeper');

select pg_temp.expect(
  (select sum(clean_sheets) from public.v_ea_player_season_stats
    where club_id = 'ac000000-0000-0000-0000-000000000001' and source_player_id = '10') = 1,
  'solo cuenta de portero y sin goles recibidos');
select pg_temp.expect(
  (select sum(clean_sheets) from public.v_ea_player_season_stats
    where club_id = 'ac000000-0000-0000-0000-000000000001' and source_player_id = '20') = 0,
  'un jugador de campo no suma porterías a cero');
select pg_temp.expect(
  not exists (select 1 from public.v_ea_player_season_stats
    where club_id = 'ac000000-0000-0000-0000-000000000001' and source_player_id = '30'),
  'los rivales nunca entran');
select pg_temp.expect(
  (select count(*) from public.v_player_session_season_stats where clean_sheets is not null) = 0,
  'los proveedores por sesión no informan porterías a cero: NULL');

rollback;
