-- Pruebas de sincronización y vinculación (migración 9).
begin;

insert into public.clubs (id, slug, name, stats_provider) values
  ('a1000000-0000-0000-0000-000000000000', 'club-m', 'Club M', 'maritimo');
-- Temporada creada "hoy" sin fechas: no debe absorber sesiones anteriores.
insert into public.seasons (id, club_id, name, is_current, created_at) values
  ('a1500000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'T1', true, '2026-10-24');

-- Plantilla externa.
select pg_temp.expect(
  public.sync_apply_players('a1000000-0000-0000-0000-000000000000', 'maritimo', '[
    {"externalId":"jug-1","gamertag":"Pirlo21","platform":"ps","positions":["MC","MCO"],"shirtNumber":10,"active":true,"updatedAt":"2026-10-20T00:00:00Z"},
    {"externalId":"jug-2","gamertag":"Muro","platform":"ps","positions":["DFC"],"shirtNumber":4,"active":true,"updatedAt":"2026-10-20T00:00:00Z"}
  ]'::jsonb) = 2,
  'se importa la plantilla externa');

-- Sesión anterior a la temporada y sesión posterior.
select pg_temp.expect(
  public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-1","publishedAt":"2026-10-20T23:00:00Z","playedOn":"2026-10-20","matchesPlayed":4,
    "wins":3,"draws":0,"losses":1,"duplicateOf":null,"updatedAt":"v1",
    "players":[
      {"externalPlayerId":"jug-1","gamertag":"Pirlo21","matchesPlayed":4,"rating":7.5,"goals":3,"assists":1,
       "goalsManual":0,"assistsManual":0,"shots":6,"dribbles":4,"passesMade":50,"passesAttempted":60,
       "tacklesMade":5,"tacklesAttempted":9,"interceptions":2,"blocks":1,"clearances":0,"saves":0},
      {"externalPlayerId":null,"gamertag":"Invitado","matchesPlayed":2,"rating":null,"goals":1,"assists":null,
       "goalsManual":null,"assistsManual":null,"shots":null,"dribbles":null,"passesMade":null,"passesAttempted":null,
       "tacklesMade":null,"tacklesAttempted":null,"interceptions":null,"blocks":null,"clearances":null,"saves":null}
    ]}'::jsonb) = 'insertada',
  'una sesión nueva se inserta');

select pg_temp.expect(
  (select season_id is null from public.sessions where external_id = 'msg-1'),
  'una temporada creada después no absorbe sesiones anteriores');

select pg_temp.expect(
  public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-2","publishedAt":"2026-10-25T23:00:00Z","playedOn":"2026-10-25","matchesPlayed":2,
    "wins":1,"draws":1,"losses":0,"duplicateOf":null,"updatedAt":"v1",
    "players":[{"externalPlayerId":"jug-1","gamertag":"Pirlo21","matchesPlayed":2,"rating":6.5,"goals":1,"assists":0,
       "goalsManual":0,"assistsManual":0,"shots":2,"dribbles":1,"passesMade":20,"passesAttempted":20,
       "tacklesMade":1,"tacklesAttempted":5,"interceptions":0,"blocks":0,"clearances":1,"saves":0}]}'::jsonb) = 'insertada',
  'segunda sesión insertada');
select pg_temp.expect(
  (select season_id = 'a1500000-0000-0000-0000-000000000000' from public.sessions where external_id = 'msg-2'),
  'una sesión posterior a la creación de la temporada se asigna a ella');

-- Idempotencia: misma versión → sin cambios.
select pg_temp.expect(
  public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-1","publishedAt":"2026-10-20T23:00:00Z","playedOn":"2026-10-20","matchesPlayed":4,
    "wins":3,"draws":0,"losses":1,"duplicateOf":null,"updatedAt":"v1","players":[]}'::jsonb) = 'sin_cambios',
  'repetir la misma versión no cambia nada');

-- Corrección en origen: asistencias 1 → 2 y el invitado ya no figura.
select pg_temp.expect(
  public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-1","publishedAt":"2026-10-20T23:00:00Z","playedOn":"2026-10-20","matchesPlayed":4,
    "wins":3,"draws":0,"losses":1,"duplicateOf":null,"updatedAt":"v2",
    "players":[{"externalPlayerId":"jug-1","gamertag":"Pirlo21","matchesPlayed":4,"rating":7.5,"goals":3,"assists":2,
       "goalsManual":0,"assistsManual":0,"shots":6,"dribbles":4,"passesMade":50,"passesAttempted":60,
       "tacklesMade":5,"tacklesAttempted":9,"interceptions":2,"blocks":1,"clearances":0,"saves":0}]}'::jsonb) = 'actualizada',
  'una versión nueva actualiza la sesión');
select pg_temp.expect(
  (select assists = 2 from public.player_session_stats where source_player_id = 'jug-1'
     and session_id = (select id from public.sessions where external_id = 'msg-1'))
  and not exists (select 1 from public.player_session_stats where source_player_id = 'gt:invitado'),
  'la corrección se aplica y quien ya no figura se retira');
select pg_temp.expect(
  exists (select 1 from public.stat_revisions where field = 'assists' and reason = 'sincronización maritimo'
            and changed_by = 'proveedor:maritimo'),
  'la corrección queda en el historial con su motivo');

-- Sesión duplicada: se guarda marcada y no suma.
select public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-2b","publishedAt":"2026-10-25T23:05:00Z","playedOn":"2026-10-25","matchesPlayed":2,
    "wins":1,"draws":1,"losses":0,"duplicateOf":"msg-2","updatedAt":"v1",
    "players":[{"externalPlayerId":"jug-1","gamertag":"Pirlo21","matchesPlayed":2,"rating":6.5,"goals":1,"assists":0,
       "goalsManual":0,"assistsManual":0,"shots":2,"dribbles":1,"passesMade":20,"passesAttempted":20,
       "tacklesMade":1,"tacklesAttempted":5,"interceptions":0,"blocks":0,"clearances":1,"saves":0}]}'::jsonb);
select pg_temp.expect(
  (select sum(goals) = 4 from public.v_player_session_season_stats where source_player_id = 'jug-1'),
  'la sesión duplicada no suma goles');

-- Vinculación por gamertag: asigna las estadísticas ya importadas.
insert into public.players (id, display_name, discord_user_id) values
  ('a1300000-0000-0000-0000-000000000001', 'Andrés', '600000000000000001'),
  ('a1300000-0000-0000-0000-000000000002', 'Otro', '600000000000000002');
select pg_temp.expect(
  public.link_player_gamertag('a1000000-0000-0000-0000-000000000000', 'a1300000-0000-0000-0000-000000000001', ' pirlo21 ') = 1,
  'el gamertag se vincula sin distinguir mayúsculas ni espacios');
select pg_temp.expect(
  (select count(*) = 3 from public.player_session_stats where player_id = 'a1300000-0000-0000-0000-000000000001'),
  'las estadísticas ya importadas pasan al jugador vinculado');
select pg_temp.expect_error($$
  select public.link_player_gamertag('a1000000-0000-0000-0000-000000000000', 'a1300000-0000-0000-0000-000000000002', 'Pirlo21')
$$, 'P0001', 'un gamertag ya vinculado no se puede asignar a otro jugador');

-- Las sesiones nuevas de un jugador vinculado llegan ya asignadas.
select public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-3","publishedAt":"2026-10-26T23:00:00Z","playedOn":"2026-10-26","matchesPlayed":1,
    "wins":1,"draws":0,"losses":0,"duplicateOf":null,"updatedAt":"v1",
    "players":[{"externalPlayerId":"jug-1","gamertag":"Pirlo21","matchesPlayed":1,"rating":8.0,"goals":2,"assists":0,
       "goalsManual":0,"assistsManual":0,"shots":3,"dribbles":0,"passesMade":10,"passesAttempted":12,
       "tacklesMade":0,"tacklesAttempted":1,"interceptions":0,"blocks":0,"clearances":0,"saves":0}]}'::jsonb);
select pg_temp.expect(
  (select player_id = 'a1300000-0000-0000-0000-000000000001' from public.player_session_stats
    where session_id = (select id from public.sessions where external_id = 'msg-3')),
  'las sesiones nuevas de un jugador vinculado llegan asignadas');

-- Aprobar una solicitud con gamertag vincula automáticamente.
insert into public.link_requests (id, club_id, discord_user_id, display_name, ea_gamertag) values
  ('a1400000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000000', '600000000000000003', 'Defensa', 'MURO');
select public.approve_link_request('a1000000-0000-0000-0000-000000000000', 'a1400000-0000-0000-0000-000000000001',
                                   '600000000000000001', 'jugador');
select pg_temp.expect(
  (select ep.player_id = p.id from public.external_players ep, public.players p
    where ep.external_id = 'jug-2' and p.discord_user_id = '600000000000000003'),
  'aprobar una solicitud vincula la ficha externa con el mismo gamertag');

-- Un miembro con gamertag ya registrado se vincula solo al llegar su ficha y sus sesiones.
insert into public.players (id, display_name, ea_gamertag, discord_user_id) values
  ('a1300000-0000-0000-0000-000000000009', 'Nuevo', 'Rapido9', '600000000000000009');
insert into public.club_memberships (club_id, player_id, role) values
  ('a1000000-0000-0000-0000-000000000000', 'a1300000-0000-0000-0000-000000000009', 'jugador');
select public.sync_apply_players('a1000000-0000-0000-0000-000000000000', 'maritimo',
  '[{"externalId":"jug-9","gamertag":"rapido9","platform":null,"positions":[],"shirtNumber":null,"active":true,"updatedAt":"x"}]'::jsonb);
select pg_temp.expect(
  (select player_id = 'a1300000-0000-0000-0000-000000000009' from public.external_players where external_id = 'jug-9'),
  'una ficha nueva se vincula al miembro con el mismo gamertag');
select public.sync_apply_session('a1000000-0000-0000-0000-000000000000', 'maritimo', '{
    "externalId":"msg-4","publishedAt":"2026-10-27T23:00:00Z","playedOn":"2026-10-27","matchesPlayed":1,
    "wins":0,"draws":0,"losses":1,"duplicateOf":null,"updatedAt":"v1",
    "players":[{"externalPlayerId":null,"gamertag":"RAPIDO9","matchesPlayed":1,"rating":null,"goals":0,"assists":0,
       "goalsManual":null,"assistsManual":null,"shots":null,"dribbles":null,"passesMade":null,"passesAttempted":null,
       "tacklesMade":null,"tacklesAttempted":null,"interceptions":null,"blocks":null,"clearances":null,"saves":null}]}'::jsonb);
select pg_temp.expect(
  (select player_id = 'a1300000-0000-0000-0000-000000000009' from public.player_session_stats
    where session_id = (select id from public.sessions where external_id = 'msg-4')),
  'una fila sin ficha se asigna al miembro con ese gamertag');

-- Borrados del proveedor.
-- (cada comprobación en su propia sentencia: una consulta no ve los cambios de su misma sentencia)
select pg_temp.expect(
  public.sync_apply_deletion('a1000000-0000-0000-0000-000000000000', 'maritimo', 'sesion', 'msg-3'),
  'el borrado de una sesión se aplica');
select pg_temp.expect(
  not exists (select 1 from public.sessions where external_id = 'msg-3')
  and not exists (select 1 from public.player_session_stats st
                   where not exists (select 1 from public.sessions se where se.id = st.session_id)),
  'una sesión borrada en origen se elimina con sus estadísticas');
select pg_temp.expect(
  exists (select 1 from public.audit_log where action = 'sync.session_deleted'
            and details ->> 'external_id' = 'msg-3' and jsonb_array_length(details -> 'players') = 1),
  'la sesión borrada queda copiada en la auditoría');
select pg_temp.expect(
  public.sync_apply_deletion('a1000000-0000-0000-0000-000000000000', 'maritimo', 'jugador', 'jug-2'),
  'el borrado de un jugador se aplica');
select pg_temp.expect(
  (select not active from public.external_players where external_id = 'jug-2'),
  'un jugador borrado en origen queda inactivo');

-- Aislamiento: aplicar en otro club no toca el club M.
insert into public.clubs (id, slug, name) values ('a2000000-0000-0000-0000-000000000000', 'club-n', 'Club N');
select pg_temp.expect(
  not public.sync_apply_deletion('a2000000-0000-0000-0000-000000000000', 'maritimo', 'sesion', 'msg-1'),
  'un borrado dirigido a otro club no encuentra nada');
select pg_temp.expect(
  exists (select 1 from public.sessions where external_id = 'msg-1'),
  'un borrado dirigido a otro club no afecta a este');

-- Seguridad.
select pg_temp.expect(
  not has_function_privilege('anon', 'public.sync_apply_session(uuid,public.stats_provider,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.link_player_gamertag(uuid,uuid,text,text)', 'execute')
  and not has_table_privilege('anon', 'public.external_players', 'select')
  and has_function_privilege('service_role', 'public.sync_apply_session(uuid,public.stats_provider,jsonb)', 'execute'),
  'solo el servidor puede sincronizar y vincular');

rollback;
