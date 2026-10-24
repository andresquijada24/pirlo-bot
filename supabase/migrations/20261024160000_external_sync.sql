-- PIRLO BOT · Migración 9: sincronización con proveedores y vinculación de jugadores externos
--
-- - external_players: la plantilla tal como la informa el proveedor (p. ej. Marítimo).
-- - sync_apply_*: aplican lo recibido de forma atómica e idempotente (repetir no duplica).
-- - link_player_gamertag: vincula a un jugador de PIRLO BOT con su ficha externa por gamertag y
--   le asigna sus estadísticas ya importadas.
-- Solo añade objetos o reemplaza funciones; no borra datos.

-- ---------------------------------------------------------------------------
-- Plantilla externa
-- ---------------------------------------------------------------------------
create table public.external_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  source public.stats_provider not null,
  external_id text not null,
  gamertag text not null,
  platform text check (platform is null or platform in ('ps', 'xbox', 'pc')),
  positions text[] not null default '{}',
  shirt_number smallint,
  active boolean not null default true,
  source_version text,
  player_id uuid references public.players (id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, source, external_id)
);
create index external_players_gamertag_idx on public.external_players (club_id, lower(gamertag));
create index external_players_player_idx on public.external_players (player_id);
-- Un jugador de PIRLO BOT se vincula como mucho a una ficha por club y proveedor.
create unique index external_players_one_link
  on public.external_players (club_id, source, player_id) where player_id is not null;
create trigger external_players_updated_at before update on public.external_players
  for each row execute function public.set_updated_at();

alter table public.external_players enable row level security;
revoke all on public.external_players from anon, authenticated;
grant all on public.external_players to service_role;

-- ---------------------------------------------------------------------------
-- Totales por sesión: columnas para agregar la nota entre temporadas
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE VIEW solo permite añadir columnas al final: se mantienen las existentes.
create or replace view public.v_player_session_season_stats
with (security_invoker = true)
as
select
  s.club_id,
  se.season_id,
  s.player_id,
  s.source,
  s.source_player_id,
  max(s.source_player_name)             as source_player_name,
  count(*)                              as sessions,
  sum(s.matches_played)                 as matches_played,
  sum(s.goals)                          as goals,
  sum(s.assists)                        as assists,
  sum(s.shots)                          as shots,
  sum(s.dribbles)                       as dribbles,
  sum(s.passes_made)                    as passes_made,
  sum(s.passes_attempted)               as passes_attempted,
  case when sum(s.passes_attempted) > 0
    then round(100.0 * sum(s.passes_made) / sum(s.passes_attempted), 1) end as pass_pct,
  sum(s.tackles_made)                   as tackles_made,
  sum(s.tackles_attempted)              as tackles_attempted,
  case when sum(s.tackles_attempted) > 0
    then round(100.0 * sum(s.tackles_made) / sum(s.tackles_attempted), 1) end as tackle_pct,
  sum(s.interceptions)                  as interceptions,
  sum(s.blocks)                         as blocks,
  sum(s.clearances)                     as clearances,
  sum(s.saves)                          as saves,
  case when sum(s.matches_played) filter (where s.rating is not null) > 0
    then round(sum(s.rating * s.matches_played) filter (where s.rating is not null)
               / sum(s.matches_played) filter (where s.rating is not null), 2) end as avg_rating,
  -- Nuevas: permiten calcular la nota ponderada al sumar varias temporadas.
  sum(s.rating * s.matches_played) filter (where s.rating is not null)   as rating_points,
  sum(s.matches_played) filter (where s.rating is not null)              as rated_matches
from public.player_session_stats s
join public.sessions se on se.club_id = s.club_id and se.id = s.session_id
where not se.is_duplicate
group by s.club_id, se.season_id, s.player_id, s.source, s.source_player_id;

-- ---------------------------------------------------------------------------
-- Temporada que corresponde a una fecha de juego
-- ---------------------------------------------------------------------------
-- 1) La temporada cuyo rango de fechas incluye el día.
-- 2) Si ninguna tiene fechas que encajen: la temporada (sin fecha de inicio) más reciente creada
--    en o antes de ese día. Así una temporada creada hoy no absorbe el historial anterior.
create function public.season_for_date(p_club uuid, p_day date) returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.id from public.seasons s
      where s.club_id = p_club and s.starts_on is not null and s.starts_on <= p_day
        and (s.ends_on is null or s.ends_on >= p_day)
      order by s.starts_on desc limit 1),
    (select s.id from public.seasons s
      where s.club_id = p_club and s.starts_on is null and s.created_at::date <= p_day
      order by s.created_at desc limit 1)
  );
$$;

-- ---------------------------------------------------------------------------
-- Miembro activo del club con ese gamertag (solo si hay exactamente uno)
-- ---------------------------------------------------------------------------
create function public.member_by_gamertag(p_club uuid, p_gamertag text) returns uuid
language sql
stable
set search_path = ''
as $$
  select case when count(*) = 1 then min(p.id::text)::uuid end
    from public.club_memberships m
    join public.players p on p.id = m.player_id
   where m.club_id = p_club and m.left_at is null
     and lower(p.ea_gamertag) = lower(btrim(p_gamertag));
$$;

-- ---------------------------------------------------------------------------
-- Aplicar la plantilla externa
-- ---------------------------------------------------------------------------
-- p_players: [{externalId, gamertag, platform, positions[], shirtNumber, active, updatedAt}]
create function public.sync_apply_players(p_club uuid, p_source public.stats_provider, p_players jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer := 0;
  e jsonb;
begin
  for e in select * from jsonb_array_elements(p_players) loop
    insert into public.external_players
      (club_id, source, external_id, gamertag, platform, positions, shirt_number, active, source_version)
    values (
      p_club, p_source, e ->> 'externalId', e ->> 'gamertag', e ->> 'platform',
      coalesce(array(select jsonb_array_elements_text(e -> 'positions')), '{}'),
      (e ->> 'shirtNumber')::smallint, coalesce((e ->> 'active')::boolean, true), e ->> 'updatedAt'
    )
    on conflict (club_id, source, external_id) do update set
      gamertag = excluded.gamertag,
      platform = excluded.platform,
      positions = excluded.positions,
      shirt_number = excluded.shirt_number,
      active = excluded.active,
      source_version = excluded.source_version
    where public.external_players.source_version is distinct from excluded.source_version;
    n := n + 1;
  end loop;

  -- Fichas sin vincular cuyo gamertag coincide con el de un único miembro del club.
  update public.external_players ep
     set player_id = public.member_by_gamertag(p_club, ep.gamertag), linked_at = now()
   where ep.club_id = p_club and ep.source = p_source and ep.player_id is null
     and public.member_by_gamertag(p_club, ep.gamertag) is not null
     and not exists (select 1 from public.external_players o
                      where o.club_id = p_club and o.source = p_source
                        and o.player_id = public.member_by_gamertag(p_club, ep.gamertag));

  -- Estadísticas que llegaron antes de vincular: se asignan al jugador ya vinculado.
  update public.player_session_stats st
     set player_id = ep.player_id
    from public.external_players ep
   where st.club_id = p_club and ep.club_id = p_club and ep.source = p_source
     and st.source = p_source and st.source_player_id = ep.external_id
     and ep.player_id is not null and st.player_id is null;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aplicar una sesión con sus filas por jugador
-- ---------------------------------------------------------------------------
-- p_session: ExternalSession serializada (ver src/providers/types.ts).
-- Devuelve 'insertada', 'actualizada' o 'sin_cambios'.
create function public.sync_apply_session(p_club uuid, p_source public.stats_provider, p_session jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ext text := p_session ->> 'externalId';
  v_version text := p_session ->> 'updatedAt';
  v_day date := (p_session ->> 'playedOn')::date;
  v_existing record;
  v_session uuid;
  v_result text;
  e jsonb;
  v_key text;
  v_keys text[] := '{}';
begin
  select id, source_version into v_existing from public.sessions
   where club_id = p_club and source = p_source and external_id = v_ext;
  if found and v_existing.source_version is not distinct from v_version then
    return 'sin_cambios';
  end if;

  perform set_config('pirlo.change_reason', 'sincronización ' || p_source, true);
  perform set_config('pirlo.changed_by', 'proveedor:' || p_source, true);

  insert into public.sessions
    (club_id, season_id, played_on, label, source, external_id, published_at,
     matches_played, wins, draws, losses, is_duplicate, source_version)
  values (
    p_club, public.season_for_date(p_club, v_day), v_day, null, p_source, v_ext,
    (p_session ->> 'publishedAt')::timestamptz,
    (p_session ->> 'matchesPlayed')::smallint, (p_session ->> 'wins')::smallint,
    (p_session ->> 'draws')::smallint, (p_session ->> 'losses')::smallint,
    (p_session ->> 'duplicateOf') is not null, v_version
  )
  on conflict (club_id, source, external_id) do update set
    played_on = excluded.played_on,
    published_at = excluded.published_at,
    matches_played = excluded.matches_played,
    wins = excluded.wins,
    draws = excluded.draws,
    losses = excluded.losses,
    is_duplicate = excluded.is_duplicate,
    source_version = excluded.source_version
  returning id into v_session;
  v_result := case when v_existing.id is null then 'insertada' else 'actualizada' end;

  for e in select * from jsonb_array_elements(p_session -> 'players') loop
    -- Clave estable: el id del proveedor; si el jugador no tiene ficha, su gamertag.
    v_key := coalesce(e ->> 'externalPlayerId', 'gt:' || lower(e ->> 'gamertag'));
    v_keys := v_keys || v_key;
    insert into public.player_session_stats
      (club_id, session_id, player_id, source, source_player_id, source_player_name,
       matches_played, rating, goals, assists, goals_manual, assists_manual, shots, dribbles,
       passes_made, passes_attempted, tackles_made, tackles_attempted, interceptions, blocks,
       clearances, saves)
    values (
      p_club, v_session,
      case when e ->> 'externalPlayerId' is not null then
        (select ep.player_id from public.external_players ep
          where ep.club_id = p_club and ep.source = p_source and ep.external_id = e ->> 'externalPlayerId')
      else public.member_by_gamertag(p_club, e ->> 'gamertag') end,
      p_source, v_key, e ->> 'gamertag',
      (e ->> 'matchesPlayed')::smallint, (e ->> 'rating')::numeric,
      (e ->> 'goals')::smallint, (e ->> 'assists')::smallint,
      (e ->> 'goalsManual')::smallint, (e ->> 'assistsManual')::smallint,
      (e ->> 'shots')::smallint, (e ->> 'dribbles')::smallint,
      (e ->> 'passesMade')::smallint, (e ->> 'passesAttempted')::smallint,
      (e ->> 'tacklesMade')::smallint, (e ->> 'tacklesAttempted')::smallint,
      (e ->> 'interceptions')::smallint, (e ->> 'blocks')::smallint,
      (e ->> 'clearances')::smallint, (e ->> 'saves')::smallint
    )
    on conflict (session_id, source_player_id) do update set
      player_id = coalesce(excluded.player_id, public.player_session_stats.player_id),
      source_player_name = excluded.source_player_name,
      matches_played = excluded.matches_played,
      rating = excluded.rating,
      goals = excluded.goals,
      assists = excluded.assists,
      goals_manual = excluded.goals_manual,
      assists_manual = excluded.assists_manual,
      shots = excluded.shots,
      dribbles = excluded.dribbles,
      passes_made = excluded.passes_made,
      passes_attempted = excluded.passes_attempted,
      tackles_made = excluded.tackles_made,
      tackles_attempted = excluded.tackles_attempted,
      interceptions = excluded.interceptions,
      blocks = excluded.blocks,
      clearances = excluded.clearances,
      saves = excluded.saves;
  end loop;

  -- El proveedor es la fuente de verdad de la sesión: quien ya no figura en ella se retira.
  delete from public.player_session_stats
   where session_id = v_session and club_id = p_club and not (source_player_id = any (v_keys));

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aplicar un borrado informado por el proveedor
-- ---------------------------------------------------------------------------
create function public.sync_apply_deletion(
  p_club uuid, p_source public.stats_provider, p_kind text, p_external_id text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_kind = 'sesion' then
    -- Antes de retirarla se guarda una copia completa en la auditoría (trazabilidad).
    insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
    select p_club, 'proveedor:' || p_source, 'sync.session_deleted', 'session', se.id::text,
           jsonb_build_object('external_id', se.external_id, 'session', to_jsonb(se),
             'players', coalesce((select jsonb_agg(to_jsonb(st)) from public.player_session_stats st
                                   where st.club_id = p_club and st.session_id = se.id), '[]'::jsonb))
      from public.sessions se
     where se.club_id = p_club and se.source = p_source and se.external_id = p_external_id;
    if not found then
      return false;
    end if;
    delete from public.sessions
     where club_id = p_club and source = p_source and external_id = p_external_id;
    return true;
  elsif p_kind = 'jugador' then
    update public.external_players set active = false
     where club_id = p_club and source = p_source and external_id = p_external_id;
    return found;
  end if;
  return false; -- 'partido': PIRLO BOT no importa el calendario del proveedor en la v1.
end;
$$;

-- ---------------------------------------------------------------------------
-- Vincular un jugador de PIRLO BOT con su ficha externa por gamertag
-- ---------------------------------------------------------------------------
-- Devuelve cuántas fichas externas quedaron vinculadas (0 si el gamertag no aparece).
create function public.link_player_gamertag(
  p_club uuid, p_player uuid, p_gamertag text, p_actor text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_taken uuid;
  n integer;
begin
  select player_id into v_taken from public.external_players
   where club_id = p_club and lower(gamertag) = lower(btrim(p_gamertag))
     and player_id is not null and player_id <> p_player
   limit 1;
  if v_taken is not null then
    raise exception 'Ese gamertag ya está vinculado a otro jugador del club' using errcode = 'P0001';
  end if;

  update public.players set ea_gamertag = btrim(p_gamertag) where id = p_player;

  -- Si el jugador estaba vinculado a otra ficha (gamertag anterior), se libera.
  update public.external_players set player_id = null, linked_at = null
   where club_id = p_club and player_id = p_player and lower(gamertag) <> lower(btrim(p_gamertag));

  update public.external_players set player_id = p_player, linked_at = now()
   where club_id = p_club and lower(gamertag) = lower(btrim(p_gamertag));
  get diagnostics n = row_count;

  -- Estadísticas ya importadas: por id de proveedor o, sin ficha, por gamertag.
  update public.player_session_stats st set player_id = p_player
   where st.club_id = p_club
     and (st.source_player_id in (select ep.external_id from public.external_players ep
                                   where ep.club_id = p_club and ep.player_id = p_player)
          or st.source_player_id = 'gt:' || lower(btrim(p_gamertag)));

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club, p_actor, 'player.link_gamertag',
          'player', p_player::text, jsonb_build_object('gamertag', btrim(p_gamertag), 'fichas', n));
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aprobar una solicitud ahora también vincula el gamertag, si está libre
-- ---------------------------------------------------------------------------
create or replace function public.approve_link_request(
  p_club_id uuid,
  p_request_id uuid,
  p_decided_by text,
  p_role public.club_role
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.link_requests%rowtype;
  v_player uuid;
  v_membership uuid;
begin
  select * into r from public.link_requests
  where club_id = p_club_id and id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.status <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta' using errcode = 'P0001';
  end if;

  select p.id into v_player from public.players p where p.discord_user_id = r.discord_user_id;
  if v_player is null then
    insert into public.players (display_name, ea_gamertag, discord_user_id, discord_verified_at)
    values (r.display_name, r.ea_gamertag, r.discord_user_id, now())
    returning id into v_player;
  else
    update public.players
      set discord_verified_at = coalesce(discord_verified_at, now()),
          ea_gamertag = coalesce(ea_gamertag, r.ea_gamertag)
    where id = v_player;
  end if;

  insert into public.club_memberships (club_id, player_id, role)
  values (p_club_id, v_player, p_role)
  returning id into v_membership;

  update public.link_requests
    set status = 'aprobada', decided_at = now(), decided_by = p_decided_by
  where id = r.id;

  -- Vinculación automática con la ficha externa, solo si ese gamertag no es de otro jugador.
  if r.ea_gamertag is not null and not exists (
    select 1 from public.external_players
     where club_id = p_club_id and lower(gamertag) = lower(btrim(r.ea_gamertag))
       and player_id is not null and player_id <> v_player
  ) then
    perform public.link_player_gamertag(p_club_id, v_player, r.ea_gamertag, p_decided_by);
  end if;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_decided_by, 'link.approve', 'membership', v_membership::text,
          jsonb_build_object('request_id', r.id, 'role', p_role));

  return v_membership;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos: solo el servidor del bot
-- ---------------------------------------------------------------------------
revoke execute on function public.season_for_date(uuid, date) from public, anon, authenticated;
revoke execute on function public.member_by_gamertag(uuid, text) from public, anon, authenticated;
revoke execute on function public.sync_apply_players(uuid, public.stats_provider, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_apply_session(uuid, public.stats_provider, jsonb) from public, anon, authenticated;
revoke execute on function public.sync_apply_deletion(uuid, public.stats_provider, text, text) from public, anon, authenticated;
revoke execute on function public.link_player_gamertag(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.approve_link_request(uuid, uuid, text, public.club_role) from public, anon, authenticated;
revoke all on public.v_player_session_season_stats from anon, authenticated;
grant execute on function public.season_for_date(uuid, date) to service_role;
grant execute on function public.member_by_gamertag(uuid, text) to service_role;
grant execute on function public.sync_apply_players(uuid, public.stats_provider, jsonb) to service_role;
grant execute on function public.sync_apply_session(uuid, public.stats_provider, jsonb) to service_role;
grant execute on function public.sync_apply_deletion(uuid, public.stats_provider, text, text) to service_role;
grant execute on function public.link_player_gamertag(uuid, uuid, text, text) to service_role;
grant execute on function public.approve_link_request(uuid, uuid, text, public.club_role) to service_role;
grant select on public.v_player_session_season_stats to service_role;
