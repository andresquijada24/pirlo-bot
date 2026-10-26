-- PIRLO BOT · Fase 6.15: calendario del proveedor y tipo de partido en las sesiones
--
-- Los clubes con estadísticas por SESIÓN (Marítimo) también se separan en liga, copa y amistosos.
-- 1. public.matches (ya existía, vacía para proveedores) recibe el calendario del proveedor: se
--    añade la competición tal como la informa la fuente y la versión en origen.
-- 2. Una sesión se clasifica SOLO si los partidos del calendario de ese día suman exactamente los
--    partidos de las sesiones de ese día y son todos del mismo tipo. Si no, queda sin tipo (NULL)
--    y solo cuenta en «Todos»: no se reparten números que la fuente no da.
-- 3. La vista de estadísticas por sesión añade match_type AL FINAL (no cambia ninguna columna).
-- Solo añade columnas, funciones y una vista; no borra ni modifica datos existentes.

alter table public.matches
  add column competition text
    check (competition in ('liga', 'copa', 'amistoso', 'torneo', 'relampago')),
  -- Mismo vocabulario que EA: torneo y relámpago son competiciones por eliminatorias (copa).
  add column match_type text generated always as (
    case competition
      when 'liga' then 'leagueMatch'
      when 'amistoso' then 'friendlyMatch'
      when 'copa' then 'playoffMatch'
      when 'torneo' then 'playoffMatch'
      when 'relampago' then 'playoffMatch'
    end
  ) stored,
  add column name text check (char_length(name) <= 200),
  add column source_updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Aplicar un partido del calendario del proveedor (idempotente por versión)
-- ---------------------------------------------------------------------------
create function public.sync_apply_match(p_club uuid, p_source public.stats_provider, p_match jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ext text := p_match ->> 'externalId';
  v_version timestamptz := (p_match ->> 'updatedAt')::timestamptz;
  v_at timestamptz := (p_match ->> 'startsAt')::timestamptz;
  v_gf smallint := (p_match ->> 'goalsFor')::smallint;
  v_ga smallint := (p_match ->> 'goalsAgainst')::smallint;
  v_state text := p_match ->> 'state';
  v_status public.match_status;
  v_tz text;
  v_existing record;
begin
  if v_ext is null or v_at is null or v_version is null then
    raise exception 'Partido del proveedor incompleto' using errcode = '22023';
  end if;
  select timezone into v_tz from public.clubs where id = p_club;
  if not found then
    raise exception 'Club inexistente' using errcode = 'P0002';
  end if;

  -- Jugado solo con marcador; cancelado, pospuesto o borrador no cuentan como disputados ese día.
  v_status := case
    when v_state in ('cancelado', 'pospuesto', 'borrador') then 'anulado'
    when v_gf is not null and v_ga is not null and v_state in ('finalizado', 'archivado') then 'jugado'
    else 'programado'
  end;

  select id, source_updated_at into v_existing from public.matches
   where club_id = p_club and source = p_source and external_id = v_ext;
  if found and v_existing.source_updated_at is not distinct from v_version then
    return 'sin_cambios';
  end if;

  insert into public.matches
    (club_id, season_id, opponent_name, played_at, goals_for, goals_against, status, source,
     external_id, source_version, competition, name, source_updated_at)
  values (
    p_club, public.season_for_date(p_club, (v_at at time zone v_tz)::date),
    left(p_match ->> 'opponent', 100), v_at,
    case when v_status = 'jugado' then v_gf end, case when v_status = 'jugado' then v_ga end,
    v_status, p_source, v_ext, p_match ->> 'updatedAt', p_match ->> 'competition',
    left(p_match ->> 'name', 200), v_version
  )
  on conflict (club_id, source, external_id) do update set
    season_id = excluded.season_id,
    opponent_name = excluded.opponent_name,
    played_at = excluded.played_at,
    goals_for = excluded.goals_for,
    goals_against = excluded.goals_against,
    status = excluded.status,
    source_version = excluded.source_version,
    competition = excluded.competition,
    name = excluded.name,
    source_updated_at = excluded.source_updated_at;
  return case when v_existing.id is null then 'insertada' else 'actualizada' end;
end;
$$;

-- Borrados: ahora también los partidos del calendario (antes la v1 no los importaba).
create or replace function public.sync_apply_deletion(
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
  elsif p_kind = 'partido' then
    -- Se anula (no se borra): deja de contar y se conserva la trazabilidad.
    update public.matches set status = 'anulado', goals_for = null, goals_against = null
     where club_id = p_club and source = p_source and external_id = p_external_id
       and status <> 'anulado';
    return found;
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tipo de partido de cada sesión (solo cuando el calendario lo deja claro)
-- ---------------------------------------------------------------------------
create view public.v_session_match_type
with (security_invoker = true)
as
with days as (
  select se.club_id, se.source, se.played_on, sum(se.matches_played) as n
    from public.sessions se
   where not se.is_duplicate and se.source <> 'manual'
   group by se.club_id, se.source, se.played_on
), cal as (
  select m.club_id, m.source, (m.played_at at time zone c.timezone)::date as day,
         count(*) as n, count(m.match_type) as typed,
         min(m.match_type) as t_min, max(m.match_type) as t_max
    from public.matches m
    join public.clubs c on c.id = m.club_id
   where m.status <> 'anulado' and m.source <> 'manual' and m.played_at <= now()
   group by m.club_id, m.source, 3
)
select se.club_id, se.id as session_id, cal.t_min as match_type
  from public.sessions se
  join days d on d.club_id = se.club_id and d.source = se.source and d.played_on = se.played_on
  join cal on cal.club_id = se.club_id and cal.source = se.source and cal.day = se.played_on
 where not se.is_duplicate
   and cal.n = d.n and cal.typed = cal.n and cal.t_min = cal.t_max;

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
  sum(s.rating * s.matches_played) filter (where s.rating is not null)   as rating_points,
  sum(s.matches_played) filter (where s.rating is not null)              as rated_matches,
  null::bigint                          as clean_sheets,
  t.match_type                          as match_type
from public.player_session_stats s
join public.sessions se on se.club_id = s.club_id and se.id = s.session_id
left join public.v_session_match_type t on t.club_id = s.club_id and t.session_id = s.session_id
where not se.is_duplicate
group by s.club_id, se.season_id, s.player_id, s.source, s.source_player_id, t.match_type;

revoke all on public.v_session_match_type from anon, authenticated;
grant select on public.v_session_match_type to service_role;
revoke all on public.v_player_session_season_stats from anon, authenticated;
grant select on public.v_player_session_season_stats to service_role;
revoke execute on function public.sync_apply_match(uuid, public.stats_provider, jsonb) from public, anon, authenticated;
grant execute on function public.sync_apply_match(uuid, public.stats_provider, jsonb) to service_role;
revoke execute on function public.sync_apply_deletion(uuid, public.stats_provider, text, text) from public, anon, authenticated;
grant execute on function public.sync_apply_deletion(uuid, public.stats_provider, text, text) to service_role;
