-- PIRLO BOT · Fase 6.12: porterías a cero por jugador (Top portero)
--
-- Se añade la columna clean_sheets AL FINAL de las dos vistas de estadísticas (create or replace
-- solo permite añadir columnas al final; no cambia ni quita ninguna).
-- - EA: un partido cuenta si el jugador jugó de portero (position = 'goalkeeper') y el club no
--   recibió goles. Si el partido no tiene marcador, no cuenta.
-- - Proveedores por sesión (Marítimo…): su API no informa porterías a cero → NULL (sin dato).
-- Solo cambia vistas: no toca ni borra datos.

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
  null::bigint                          as clean_sheets
from public.player_session_stats s
join public.sessions se on se.club_id = s.club_id and se.id = s.session_id
where not se.is_duplicate
group by s.club_id, se.season_id, s.player_id, s.source, s.source_player_id;

create or replace view public.v_ea_player_season_stats
with (security_invoker = true)
as
with x as (
  select p.*, m.goals_against as team_goals_against, (m.played_at at time zone c.timezone)::date as day
    from public.ea_match_players p
    join public.ea_matches m on m.club_id = p.club_id and m.match_id = p.match_id
    join public.clubs c on c.id = p.club_id
   where p.side = 'propio'
)
select
  x.club_id,
  public.season_for_date(x.club_id, x.day)                  as season_id,
  public.member_by_gamertag(x.club_id, x.gamertag)          as player_id,
  'ea'::text                                                as source,
  x.ea_player_id                                            as source_player_id,
  max(x.gamertag)                                           as source_player_name,
  count(distinct x.day)                                     as sessions,
  count(*)                                                  as matches_played,
  sum(x.goals)                                              as goals,
  sum(x.assists)                                            as assists,
  sum(x.shots)                                              as shots,
  null::bigint                                              as dribbles,
  sum(x.passes_made)                                        as passes_made,
  sum(x.passes_attempted)                                   as passes_attempted,
  sum(x.tackles_made)                                       as tackles_made,
  sum(x.tackles_attempted)                                  as tackles_attempted,
  null::bigint                                              as interceptions,
  null::bigint                                              as blocks,
  null::bigint                                              as clearances,
  sum(x.saves)                                              as saves,
  sum(x.rating)                                             as rating_points,
  nullif(count(x.rating), 0)                                as rated_matches,
  count(*) filter (where x.position = 'goalkeeper' and x.team_goals_against = 0) as clean_sheets
from x
group by x.club_id, 2, 3, x.ea_player_id;
