-- PIRLO BOT · Fase 6.3: estadísticas de EA en /stats y /ranking
--
-- Vista con la misma forma que v_player_session_season_stats, calculada a partir de los partidos
-- de EA procesados. Reglas:
-- - Solo el lado 'propio': los rivales nunca entran en estadísticas ni rankings del club.
-- - El jugador se reconoce por el gamertag guardado en su ficha de ESTE club
--   (club_memberships.gamertag, vía member_by_gamertag). Sin coincidencia única, la fila queda
--   "sin vincular" con el gamertag de EA como nombre.
-- - La temporada sale de la fecha local del club (season_for_date); "sesiones" = días distintos.
-- - Lo que EA no ofrece (regates, intercepciones, bloqueos, despejes) es NULL, nunca 0.
-- Solo añade objetos.

create view public.v_ea_player_season_stats
with (security_invoker = true)
as
with x as (
  select p.*, (m.played_at at time zone c.timezone)::date as day
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
  nullif(count(x.rating), 0)                                as rated_matches
from x
group by x.club_id, 2, 3, x.ea_player_id;

revoke all on public.v_ea_player_season_stats from anon, authenticated;
grant select on public.v_ea_player_season_stats to service_role;
