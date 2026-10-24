-- PIRLO BOT · Migración 4: vistas de estadísticas derivadas
--
-- Nada se duplica: rankings, efectividad y récords se calculan desde los conteos brutos.
-- Honestidad de datos:
--   * SUM ignora NULL. Si un jugador no tiene ningún dato de goles, el total es NULL (no 0).
--   * Las columnas *_data_matches dicen en cuántos partidos existe el dato, para que el bot pueda
--     avisar cuando la cobertura es parcial.
--   * Solo cuentan partidos 'jugado' o 'verificado'. Las porterías imbatidas solo si están verificadas.
--   * security_invoker: las vistas respetan los permisos y RLS de quien consulta.

create view public.v_player_season_stats
with (security_invoker = true)
as
select
  s.club_id,
  m.season_id,
  s.player_id,
  count(*)                                   as matches_played,
  count(*) filter (where m.result = 'V')     as wins,
  count(*) filter (where m.result = 'E')     as draws,
  count(*) filter (where m.result = 'D')     as losses,
  sum(s.goals)                               as goals,
  count(s.goals)                             as goals_data_matches,
  sum(s.assists)                             as assists,
  count(s.assists)                           as assists_data_matches,
  sum(s.tackles_made)                        as tackles_made,
  sum(s.tackles_attempted)                   as tackles_attempted,
  count(s.tackles_attempted)                 as tackles_data_matches,
  case
    when sum(s.tackles_attempted) > 0
      then round(100.0 * sum(s.tackles_made) / sum(s.tackles_attempted), 1)
  end                                        as tackle_success_pct,
  count(*) filter (where s.clean_sheet_verified) as clean_sheets_verified
from public.player_match_stats s
join public.matches m on m.club_id = s.club_id and m.id = s.match_id
where m.status in ('jugado', 'verificado')
group by s.club_id, m.season_id, s.player_id;

create view public.v_player_career_stats
with (security_invoker = true)
as
select
  s.club_id,
  s.player_id,
  count(*)                                   as matches_played,
  sum(s.goals)                               as goals,
  count(s.goals)                             as goals_data_matches,
  sum(s.assists)                             as assists,
  count(s.assists)                           as assists_data_matches,
  sum(s.tackles_made)                        as tackles_made,
  sum(s.tackles_attempted)                   as tackles_attempted,
  case
    when sum(s.tackles_attempted) > 0
      then round(100.0 * sum(s.tackles_made) / sum(s.tackles_attempted), 1)
  end                                        as tackle_success_pct,
  count(*) filter (where s.clean_sheet_verified) as clean_sheets_verified
from public.player_match_stats s
join public.matches m on m.club_id = s.club_id and m.id = s.match_id
where m.status in ('jugado', 'verificado')
group by s.club_id, s.player_id;

create view public.v_club_season_record
with (security_invoker = true)
as
select
  m.club_id,
  m.season_id,
  count(*)                               as matches_played,
  count(*) filter (where m.result = 'V') as wins,
  count(*) filter (where m.result = 'E') as draws,
  count(*) filter (where m.result = 'D') as losses,
  sum(m.goals_for)                       as goals_for,
  sum(m.goals_against)                   as goals_against,
  count(*) filter (where m.goals_against = 0) as clean_sheets
from public.matches m
where m.status in ('jugado', 'verificado')
group by m.club_id, m.season_id;

-- Mejor marca individual en un solo partido, por estadística (récords históricos).
create view public.v_player_match_bests
with (security_invoker = true)
as
select distinct on (s.club_id, stat)
  s.club_id,
  stat,
  value,
  s.player_id,
  s.match_id,
  m.played_at
from public.player_match_stats s
join public.matches m on m.club_id = s.club_id and m.id = s.match_id
cross join lateral (
  values ('goals', s.goals), ('assists', s.assists), ('tackles_made', s.tackles_made)
) as v(stat, value)
where m.status in ('jugado', 'verificado') and value is not null
order by s.club_id, stat, value desc, m.played_at asc;
