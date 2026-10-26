-- PIRLO BOT · Fase 6.13: estadísticas de EA separadas por tipo de partido
--
-- La vista de EA pasa a agrupar también por tipo de partido (liga, playoff/copa, amistoso) y lo
-- expone en una columna nueva al final, match_type. Quien no filtra por tipo suma todas las filas
-- del jugador y obtiene los mismos totales que antes. Solo cambia la vista: no toca datos.

create or replace view public.v_ea_player_season_stats
with (security_invoker = true)
as
with x as (
  select p.*, m.goals_against as team_goals_against, m.match_type as m_type,
         (m.played_at at time zone c.timezone)::date as day
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
  count(*) filter (where x.position = 'goalkeeper' and x.team_goals_against = 0) as clean_sheets,
  x.m_type                                                  as match_type
from x
group by x.club_id, 2, 3, x.ea_player_id, x.m_type;
