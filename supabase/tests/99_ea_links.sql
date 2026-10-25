-- Pruebas del consentimiento de EA y de los partidos procesados. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values
  ('a9000000-0000-0000-0000-000000000001', 'club-a9', 'Club A'),
  ('a9000000-0000-0000-0000-000000000002', 'club-b9', 'Club B');
insert into public.players (id, display_name, discord_user_id) values
  ('a9300000-0000-0000-0000-000000000001', 'Admin A', '730000000000000001'),
  ('a9300000-0000-0000-0000-000000000002', 'Jugador A', '730000000000000002'),
  ('a9300000-0000-0000-0000-000000000003', 'Admin B', '730000000000000003');
insert into public.club_memberships (club_id, player_id, role) values
  ('a9000000-0000-0000-0000-000000000001', 'a9300000-0000-0000-0000-000000000001', 'admin'),
  ('a9000000-0000-0000-0000-000000000001', 'a9300000-0000-0000-0000-000000000002', 'dt'),
  ('a9000000-0000-0000-0000-000000000002', 'a9300000-0000-0000-0000-000000000003', 'admin');

-- 1. Consentimiento: solo un admin del club, y un club de EA pertenece a un único club de PIRLO.
select pg_temp.expect_error($$
  select public.link_ea_club('a9000000-0000-0000-0000-000000000001', 'common-gen5', '12345', '730000000000000002')
$$, 'P0001', 'un DT no puede dar el consentimiento');
select public.link_ea_club('a9000000-0000-0000-0000-000000000001', 'common-gen5', '12345', '730000000000000001');
select pg_temp.expect(
  (select consented_by = '730000000000000001' from public.club_ea_links where club_id = 'a9000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.audit_log where club_id = 'a9000000-0000-0000-0000-000000000001' and action = 'club.ea_link'),
  'el admin vincula su club de EA y queda auditado');
select pg_temp.expect_error($$
  select public.link_ea_club('a9000000-0000-0000-0000-000000000002', 'common-gen5', '12345', '730000000000000003')
$$, 'P0001', 'otro club no puede reclamar el mismo club de EA');

-- 2. Procesamiento: solo partidos del club de EA enlazado, una sola vez.
insert into public.ea_match_cache (platform, ea_club_id, match_id, match_type, played_at, payload) values
  ('common-gen5', '12345', '900001', 'leagueMatch', now() - interval '1 hour', '{}'),
  ('common-gen5', '99999', '900002', 'leagueMatch', now(), '{}');
select pg_temp.expect(
  (select array_agg(match_id) = array['900001'] from public.pending_ea_matches('a9000000-0000-0000-0000-000000000001', 10))
  and not exists (select 1 from public.pending_ea_matches('a9000000-0000-0000-0000-000000000002', 10)),
  'cada club solo ve pendientes los partidos de su club de EA');

select pg_temp.expect(public.apply_ea_match('a9000000-0000-0000-0000-000000000001', $j${
  "matchId": "900001", "platform": "common-gen5", "eaClubId": "12345", "matchType": "leagueMatch",
  "playedAt": "2026-10-25T02:00:00Z", "goalsFor": 3, "goalsAgainst": 1, "result": "victoria",
  "opponentEaClubId": "54321", "opponentName": "Rival Ficticio",
  "players": [
    {"side": "propio", "eaPlayerId": "1", "gamertag": "Ficticio1", "position": "forward", "goals": 2, "assists": null, "rating": 8.1, "manOfTheMatch": true},
    {"side": "rival", "eaPlayerId": "2", "gamertag": "RivalFicticio", "goals": 1}
  ]}$j$::jsonb), 'se guarda un partido nuevo');
select pg_temp.expect(
  (select goals_for = 3 and result = 'victoria' and opponent_name = 'Rival Ficticio' from public.ea_matches where match_id = '900001')
  and (select assists is null and shots is null and goals = 2 from public.ea_match_players where gamertag = 'Ficticio1')
  and (select count(*) = 1 from public.ea_match_players where side = 'rival'),
  'el dato que no llega queda en NULL, no en 0; el rival se guarda en el club');
select pg_temp.expect(not public.apply_ea_match('a9000000-0000-0000-0000-000000000001',
  '{"matchId": "900001", "platform": "common-gen5", "eaClubId": "12345", "matchType": "leagueMatch", "playedAt": "2026-10-25T02:00:00Z"}'),
  'un partido no se procesa dos veces');
select pg_temp.expect(not exists (select 1 from public.pending_ea_matches('a9000000-0000-0000-0000-000000000001', 10)),
  'ya no queda pendiente');
select pg_temp.expect_error($$
  select public.apply_ea_match('a9000000-0000-0000-0000-000000000002',
    '{"matchId": "900003", "platform": "common-gen5", "eaClubId": "12345", "matchType": "leagueMatch", "playedAt": "2026-10-25T02:00:00Z"}')
$$, 'P0001', 'sin consentimiento no se procesa nada');

-- 3. Retirar el consentimiento detiene el procesamiento y conserva lo ya procesado.
select pg_temp.expect_error($$
  select public.unlink_ea_club('a9000000-0000-0000-0000-000000000001', '730000000000000002')
$$, 'P0001', 'un DT no puede retirar el consentimiento');
select pg_temp.expect(public.unlink_ea_club('a9000000-0000-0000-0000-000000000001', '730000000000000001'),
  'el admin retira el consentimiento');
select pg_temp.expect(not exists (select 1 from public.club_ea_links where club_id = 'a9000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.ea_matches where club_id = 'a9000000-0000-0000-0000-000000000001'),
  'el admin retira el consentimiento; los partidos procesados se conservan');
select pg_temp.expect(not public.unlink_ea_club('a9000000-0000-0000-0000-000000000001', '730000000000000001'),
  'retirar dos veces no falla');

-- 4. Solo el servidor accede.
select pg_temp.expect(
  not has_table_privilege('anon', 'public.ea_match_players', 'select')
  and not has_function_privilege('authenticated', 'public.link_ea_club(uuid, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.apply_ea_match(uuid, jsonb)', 'execute'),
  'solo el servidor accede a los datos de EA');

rollback;
