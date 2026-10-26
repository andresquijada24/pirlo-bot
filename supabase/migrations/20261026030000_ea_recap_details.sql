-- PIRLO BOT · Fase 6.5: más datos en el resumen de partidos de EA (para la imagen del partido)
-- Añade posición, tiros, pases, entradas y paradas de cada jugador propio. Sin dato = null.
-- Solo reemplaza una función.

create or replace function public.ea_recap(p_club_id uuid, p_match_ids text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'matchId', m.match_id, 'matchType', m.match_type, 'playedAt', m.played_at,
      'goalsFor', m.goals_for, 'goalsAgainst', m.goals_against, 'result', m.result,
      'opponentName', m.opponent_name,
      'players', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', coalesce(pl.display_name, p.gamertag),
                 'position', p.position,
                 'goals', p.goals, 'assists', p.assists, 'rating', p.rating,
                 'shots', p.shots,
                 'passesMade', p.passes_made, 'passesAttempted', p.passes_attempted,
                 'tacklesMade', p.tackles_made, 'tacklesAttempted', p.tackles_attempted,
                 'saves', p.saves,
                 'manOfTheMatch', p.man_of_the_match)
                 order by p.rating desc nulls last, p.gamertag)
          from public.ea_match_players p
          left join public.players pl on pl.id = public.member_by_gamertag(p.club_id, p.gamertag)
         where p.club_id = m.club_id and p.match_id = m.match_id and p.side = 'propio'), '[]'::jsonb))
      order by m.played_at), '[]'::jsonb)
    from public.ea_matches m
   where m.club_id = p_club_id and m.match_id = any (p_match_ids);
$$;

revoke execute on function public.ea_recap(uuid, text[]) from public, anon, authenticated;
grant execute on function public.ea_recap(uuid, text[]) to service_role;
