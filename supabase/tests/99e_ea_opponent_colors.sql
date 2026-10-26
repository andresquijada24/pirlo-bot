-- Pruebas de los colores del rival. Datos ficticios; todo se deshace al final.
begin;

select pg_temp.expect(
  public.ea_color('15921906') = '#f2f2f2' and public.ea_color('592653') = '#090b0d'
  and public.ea_color('0') = '#000000' and public.ea_color('99999999') is null
  and public.ea_color('abc') is null and public.ea_color(null) is null,
  'convierte el color de EA a #rrggbb y rechaza lo inválido');

insert into public.clubs (id, slug, name) values ('ae000000-0000-0000-0000-000000000001', 'club-co', 'Club CO');
insert into public.players (id, display_name, discord_user_id) values ('ae300000-0000-0000-0000-000000000001', 'Admin', '770000000000000001');
insert into public.club_memberships (club_id, player_id, role) values ('ae000000-0000-0000-0000-000000000001', 'ae300000-0000-0000-0000-000000000001', 'admin');
insert into public.club_ea_links (club_id, platform, ea_club_id, consented_by)
  values ('ae000000-0000-0000-0000-000000000001', 'common-gen5', '12345', '770000000000000001');

select public.apply_ea_match('ae000000-0000-0000-0000-000000000001', '{
  "matchId": "1", "platform": "common-gen5", "eaClubId": "12345", "matchType": "leagueMatch",
  "playedAt": "2026-10-25T02:00:00Z", "goalsFor": 1, "goalsAgainst": 0, "result": "victoria",
  "opponentEaClubId": "54321", "opponentName": "Rival", "opponentColors": {"primary": "#db1012", "secondary": "#f2f2f2"},
  "players": []}');
select pg_temp.expect(
  (select r -> 0 -> 'opponentColors' = '{"primary": "#db1012", "secondary": "#f2f2f2"}'::jsonb
     from public.ea_recap('ae000000-0000-0000-0000-000000000001', array['1']) r),
  'guarda y devuelve los colores del rival');
select pg_temp.expect_error($$
  update public.ea_matches set opponent_color1 = 'red' where match_id = '1'
$$, '23514', 'solo colores #rrggbb');

rollback;
