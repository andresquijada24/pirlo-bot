-- Pruebas de reglas del esquema. Todo ocurre dentro de una transacción que se revierte:
-- ningún dato de prueba queda en la base de datos.
begin;

-- Fixtures: existen solo durante esta transacción.
-- Clubes A y B, cada uno con su temporada y un partido jugado.
insert into public.clubs (id, slug, name) values
  ('a0000000-0000-0000-0000-000000000000', 'club-a', 'Club A'),
  ('b0000000-0000-0000-0000-000000000000', 'club-b', 'Club B');
insert into public.seasons (id, club_id, name, is_current) values
  ('a5000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'T1', true),
  ('b5000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000', 'T1', true);
insert into public.players (id, display_name) values
  ('10000000-0000-0000-0000-000000000001', 'Jugador Uno'),
  ('10000000-0000-0000-0000-000000000002', 'Jugador Dos');
insert into public.matches (id, club_id, season_id, played_at, goals_for, goals_against, status, source) values
  ('a3000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000',
   'a5000000-0000-0000-0000-000000000000', now(), 2, 0, 'jugado', 'manual'),
  ('b3000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000',
   'b5000000-0000-0000-0000-000000000000', now(), 1, 1, 'jugado', 'manual');

-- ---------------------------------------------------------------------------
-- 1. Aislamiento entre clubes (claves foráneas compuestas)
-- ---------------------------------------------------------------------------
select pg_temp.expect_error($$
  insert into public.sessions (club_id, season_id, played_on)
  values ('b0000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-000000000000', current_date)
$$, '23503', 'una sesión del club B no puede apuntar a una temporada del club A');

select pg_temp.expect_error($$
  insert into public.matches (club_id, season_id, played_at, status, source)
  values ('b0000000-0000-0000-0000-000000000000', 'a5000000-0000-0000-0000-000000000000', now(), 'programado', 'manual')
$$, '23503', 'un partido del club B no puede apuntar a una temporada del club A');

select pg_temp.expect_error($$
  insert into public.player_match_stats (club_id, match_id, player_id, source)
  values ('b0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000',
          '10000000-0000-0000-0000-000000000001', 'manual')
$$, '23503', 'estadísticas del club B no pueden apuntar a un partido del club A');

insert into public.callups (id, club_id, title, starts_at) values
  ('a4000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000000', 'vs Rival', now() + interval '1 day');
select pg_temp.expect_error($$
  insert into public.callup_responses (callup_id, club_id, player_id, answer)
  values ('a4000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000000',
          '10000000-0000-0000-0000-000000000001', 'voy')
$$, '23503', 'una respuesta del club B no puede apuntar a una convocatoria del club A');

-- ---------------------------------------------------------------------------
-- 2. No inventar estadísticas: lo no informado es NULL
-- ---------------------------------------------------------------------------
insert into public.player_match_stats (id, club_id, match_id, player_id, source) values
  ('a6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000',
   'a3000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'manual');
select pg_temp.expect(
  (select goals is null and assists is null and tackles_made is null and clean_sheet_verified is null
   from public.player_match_stats where id = 'a6000000-0000-0000-0000-000000000001'),
  'estadísticas sin informar quedan NULL, no 0');

select pg_temp.expect(
  (select goals is null and goals_data_matches = 0 and matches_played = 1
   from public.v_player_season_stats where player_id = '10000000-0000-0000-0000-000000000001'),
  'la vista no convierte en 0 un total sin datos y reporta la cobertura');

-- ---------------------------------------------------------------------------
-- 3. Validaciones de datos
-- ---------------------------------------------------------------------------
select pg_temp.expect_error($$
  insert into public.player_match_stats (club_id, match_id, player_id, tackles_made, tackles_attempted, source)
  values ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000',
          '10000000-0000-0000-0000-000000000002', 5, 3, 'manual')
$$, '23514', 'entradas exitosas no pueden superar las intentadas');

select pg_temp.expect_error($$
  insert into public.player_match_stats (club_id, match_id, player_id, goals, source)
  values ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000',
          '10000000-0000-0000-0000-000000000002', -1, 'manual')
$$, '23514', 'no se aceptan goles negativos');

select pg_temp.expect_error($$
  insert into public.matches (club_id, played_at, status, source)
  values ('a0000000-0000-0000-0000-000000000000', now(), 'jugado', 'manual')
$$, '23514', 'un partido jugado exige marcador');

select pg_temp.expect(
  (select result from public.matches where id = 'a3000000-0000-0000-0000-000000000000') = 'V'
  and (select result from public.matches where id = 'b3000000-0000-0000-0000-000000000000') = 'E',
  'el resultado V/E/D se calcula desde el marcador');

select pg_temp.expect_error($$
  insert into public.seasons (club_id, name, is_current)
  values ('a0000000-0000-0000-0000-000000000000', 'T2', true)
$$, '23505', 'solo una temporada actual por club');

-- Sin marcador en ambos lados no hay resultado.
insert into public.matches (id, club_id, played_at, status, source) values
  ('a3000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000000', now(), 'programado', 'manual');
select pg_temp.expect(
  (select result is null from public.matches where id = 'a3000000-0000-0000-0000-000000000009'),
  'un partido sin marcador no tiene resultado');

-- ---------------------------------------------------------------------------
-- 4. Membresías
-- ---------------------------------------------------------------------------
insert into public.club_memberships (club_id, player_id, role, positions, shirt_number) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'capitan', '{MC,MCO}', 10);
select pg_temp.expect_error($$
  insert into public.club_memberships (club_id, player_id)
  values ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001')
$$, '23505', 'un jugador no puede tener dos membresías activas en el mismo club');

select pg_temp.expect_error($$
  insert into public.club_memberships (club_id, player_id, shirt_number)
  values ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 10)
$$, '23505', 'dorsal único entre miembros activos');

-- El mismo jugador sí puede estar en otro club (historial / préstamos).
insert into public.club_memberships (club_id, player_id) values
  ('b0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001');
select pg_temp.expect(true, 'un jugador puede pertenecer a clubes distintos');

-- ---------------------------------------------------------------------------
-- 5. Servidores de Discord: uno o varios clubes
-- ---------------------------------------------------------------------------
insert into public.guilds (id, multi_club_enabled) values
  ('100000000000000001', false),
  ('100000000000000002', true);
insert into public.club_guilds (club_id, guild_id) values
  ('a0000000-0000-0000-0000-000000000000', '100000000000000001');
select pg_temp.expect_error($$
  insert into public.club_guilds (club_id, guild_id, is_primary)
  values ('b0000000-0000-0000-0000-000000000000', '100000000000000001', false)
$$, 'P0001', 'sin modalidad multiclub, un servidor solo admite un club');

insert into public.club_guilds (club_id, guild_id, is_primary) values
  ('a0000000-0000-0000-0000-000000000000', '100000000000000002', true),
  ('b0000000-0000-0000-0000-000000000000', '100000000000000002', false);
select pg_temp.expect(
  (select count(*) from public.club_guilds where guild_id = '100000000000000002') = 2,
  'con modalidad multiclub, un servidor admite varios clubes');

select pg_temp.expect_error($$
  insert into public.club_channels (club_id, guild_id, channel_id, purpose)
  values ('b0000000-0000-0000-0000-000000000000', '100000000000000001', '200000000000000001', 'anuncios')
$$, '23503', 'un club no puede configurar canales en un servidor al que no está vinculado');

-- ---------------------------------------------------------------------------
-- 6. Historial de correcciones
-- ---------------------------------------------------------------------------
select set_config('pirlo.change_reason', 'corrección del acta', true);
select set_config('pirlo.changed_by', 'proveedor:maritimo', true);
update public.player_match_stats set goals = 2, assists = 1
  where id = 'a6000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  (select count(*) from public.stat_revisions
    where stat_id = 'a6000000-0000-0000-0000-000000000001'
      and reason = 'corrección del acta' and changed_by = 'proveedor:maritimo') = 2,
  'cada campo corregido queda registrado con motivo y autor');
select pg_temp.expect(
  (select old_value = 'null'::jsonb and new_value = '2'::jsonb from public.stat_revisions
    where stat_id = 'a6000000-0000-0000-0000-000000000001' and field = 'goals'),
  'la revisión guarda valor anterior y nuevo');

-- ---------------------------------------------------------------------------
-- 7. Vistas derivadas
-- ---------------------------------------------------------------------------
update public.player_match_stats set clean_sheet_verified = true
  where id = 'a6000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  (select goals = 2 and assists = 1 and clean_sheets_verified = 1 and wins = 1
   from public.v_player_season_stats where player_id = '10000000-0000-0000-0000-000000000001'
     and club_id = 'a0000000-0000-0000-0000-000000000000'),
  'la vista de temporada suma goles, asistencias, porterías verificadas y victorias');

select pg_temp.expect(
  not exists (select 1 from public.v_player_season_stats
              where club_id = 'b0000000-0000-0000-0000-000000000000'),
  'las estadísticas del club A no aparecen en el club B');

select pg_temp.expect(
  (select wins = 1 and goals_for = 2 and clean_sheets = 1 from public.v_club_season_record
   where club_id = 'a0000000-0000-0000-0000-000000000000'),
  'el balance del club cuenta solo partidos jugados');

select pg_temp.expect(
  (select value = 2 from public.v_player_match_bests
   where club_id = 'a0000000-0000-0000-0000-000000000000' and stat = 'goals'),
  'récord de goles en un partido');

rollback;
