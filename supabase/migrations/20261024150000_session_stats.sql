-- PIRLO BOT · Migración 8: estadísticas por SESIÓN
--
-- Algunos proveedores (MARÍTIMO CF vía OurProClub) no informan estadísticas por partido, sino por
-- sesión (varios partidos seguidos). Esta migración añade ese nivel sin tocar el nivel por partido.
-- Solo añade columnas y tablas: no borra ni modifica datos existentes.

-- ---------------------------------------------------------------------------
-- Sesiones: origen externo y balance de la sesión
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column source public.stats_provider not null default 'manual',
  add column external_id text,
  add column published_at timestamptz,
  add column matches_played smallint check (matches_played >= 0),
  add column wins smallint check (wins >= 0),
  add column draws smallint check (draws >= 0),
  add column losses smallint check (losses >= 0),
  -- Copia publicada dos veces por el proveedor: se guarda para trazabilidad pero no cuenta.
  add column is_duplicate boolean not null default false,
  add column source_version text,
  add column updated_at timestamptz not null default now(),
  add constraint sessions_record_fits check (
    matches_played is null or wins is null or draws is null or losses is null
    or wins + draws + losses <= matches_played
  ),
  add constraint sessions_club_source_external_key unique (club_id, source, external_id);

create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Estadísticas de un jugador en una sesión
-- ---------------------------------------------------------------------------
-- player_id puede ser NULL: el proveedor informa a jugadores que aún no están vinculados a un
-- jugador de PIRLO BOT. Se identifican por source_player_id (estable) y se vinculan después.
create table public.player_session_stats (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  session_id uuid not null,
  player_id uuid references public.players (id) on delete set null,
  source public.stats_provider not null,
  source_player_id text not null,
  source_player_name text not null,
  matches_played smallint check (matches_played >= 0),
  rating numeric(4, 2) check (rating between 0 and 10),
  goals smallint check (goals >= 0),
  assists smallint check (assists >= 0),
  goals_manual smallint check (goals_manual >= 0),
  assists_manual smallint check (assists_manual >= 0),
  shots smallint check (shots >= 0),
  dribbles smallint check (dribbles >= 0),
  passes_made smallint check (passes_made >= 0),
  passes_attempted smallint check (passes_attempted >= 0),
  tackles_made smallint check (tackles_made >= 0),
  tackles_attempted smallint check (tackles_attempted >= 0),
  interceptions smallint check (interceptions >= 0),
  blocks smallint check (blocks >= 0),
  clearances smallint check (clearances >= 0),
  saves smallint check (saves >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, source_player_id),
  foreign key (club_id, session_id) references public.sessions (club_id, id) on delete cascade,
  check (passes_made is null or passes_attempted is null or passes_made <= passes_attempted),
  check (tackles_made is null or tackles_attempted is null or tackles_made <= tackles_attempted),
  check (goals_manual is null or goals is null or goals_manual <= goals),
  check (assists_manual is null or assists is null or assists_manual <= assists)
);
create index player_session_stats_club_session_idx on public.player_session_stats (club_id, session_id);
create index player_session_stats_player_idx on public.player_session_stats (player_id);
create index player_session_stats_unlinked_idx
  on public.player_session_stats (club_id, source, source_player_id) where player_id is null;
create trigger player_session_stats_updated_at before update on public.player_session_stats
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Historial de correcciones también para el nivel sesión
-- ---------------------------------------------------------------------------
alter table public.stat_revisions
  alter column match_id drop not null,
  alter column player_id drop not null,
  add column session_id uuid,
  add constraint stat_revisions_target check (match_id is not null or session_id is not null);

create function public.log_session_stat_revision() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  f text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  v_reason text := coalesce(nullif(current_setting('pirlo.change_reason', true), ''), 'no especificado');
  v_by text := nullif(current_setting('pirlo.changed_by', true), '');
begin
  foreach f in array array[
    'matches_played', 'rating', 'goals', 'assists', 'goals_manual', 'assists_manual', 'shots',
    'dribbles', 'passes_made', 'passes_attempted', 'tackles_made', 'tackles_attempted',
    'interceptions', 'blocks', 'clearances', 'saves'
  ] loop
    if o -> f is distinct from n -> f then
      insert into public.stat_revisions
        (club_id, stat_id, session_id, player_id, field, old_value, new_value, reason, changed_by)
      values
        (new.club_id, new.id, new.session_id, new.player_id, f, o -> f, n -> f, v_reason, v_by);
    end if;
  end loop;
  return new;
end;
$$;
create trigger player_session_stats_revision after update on public.player_session_stats
  for each row execute function public.log_session_stat_revision();

-- ---------------------------------------------------------------------------
-- Totales por temporada a nivel sesión (excluye sesiones duplicadas)
-- ---------------------------------------------------------------------------
-- Clave de jugador: el jugador vinculado si existe; si no, el identificador del proveedor.
create view public.v_player_session_season_stats
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
  -- Nota media ponderada por partidos jugados (null si no hay datos).
  case when sum(s.matches_played) filter (where s.rating is not null) > 0
    then round(sum(s.rating * s.matches_played) filter (where s.rating is not null)
               / sum(s.matches_played) filter (where s.rating is not null), 2) end as avg_rating
from public.player_session_stats s
join public.sessions se on se.club_id = s.club_id and se.id = s.session_id
where not se.is_duplicate
group by s.club_id, se.season_id, s.player_id, s.source, s.source_player_id;

-- ---------------------------------------------------------------------------
-- Seguridad (mismas reglas que el resto)
-- ---------------------------------------------------------------------------
alter table public.player_session_stats enable row level security;
revoke all on public.player_session_stats from anon, authenticated;
revoke all on public.v_player_session_season_stats from anon, authenticated;
revoke execute on function public.log_session_stat_revision() from public, anon, authenticated;
grant all on public.player_session_stats to service_role;
grant select on public.v_player_session_season_stats to service_role;
