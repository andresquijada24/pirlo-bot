-- PIRLO BOT · Fase 6.4: resumen automático de partidos de EA en Discord
--
-- Tras procesar partidos, la tarea programada publica un resumen en el canal de resultados del
-- club. Cada partido se reclama antes de publicar (recap_posted_at), así que nunca se anuncia dos
-- veces; si Discord falla de forma temporal, se libera para reintentar.
-- Solo se anuncian partidos procesados en las últimas 24 h: importar partidos antiguos no inunda
-- el canal. Los rivales solo aparecen por nombre y marcador (nunca sus gamertags).
-- Solo añade objetos.

alter table public.ea_matches add column recap_posted_at timestamptz;

-- Reclama hasta p_limit partidos pendientes de anunciar (los más antiguos primero).
create function public.claim_ea_recaps(p_club_id uuid, p_limit integer)
returns setof text
language sql
security invoker
set search_path = ''
as $$
  update public.ea_matches m set recap_posted_at = now()
   where m.club_id = p_club_id
     and m.match_id in (
       select x.match_id from public.ea_matches x
        where x.club_id = p_club_id and x.recap_posted_at is null
          and x.processed_at > now() - interval '24 hours'
        order by x.played_at
        limit least(greatest(p_limit, 1), 10)
        for update skip locked)
  returning m.match_id;
$$;

create function public.release_ea_recaps(p_club_id uuid, p_match_ids text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.ea_matches set recap_posted_at = null
   where club_id = p_club_id and match_id = any (p_match_ids);
$$;

-- Datos del resumen: partido y jugadores propios (con su nombre en el club si están vinculados).
create function public.ea_recap(p_club_id uuid, p_match_ids text[])
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
                 'goals', p.goals, 'assists', p.assists, 'rating', p.rating,
                 'manOfTheMatch', p.man_of_the_match)
                 order by p.rating desc nulls last, p.gamertag)
          from public.ea_match_players p
          left join public.players pl on pl.id = public.member_by_gamertag(p.club_id, p.gamertag)
         where p.club_id = m.club_id and p.match_id = m.match_id and p.side = 'propio'), '[]'::jsonb))
      order by m.played_at), '[]'::jsonb)
    from public.ea_matches m
   where m.club_id = p_club_id and m.match_id = any (p_match_ids);
$$;

revoke execute on function public.claim_ea_recaps(uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_ea_recaps(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.ea_recap(uuid, text[]) from public, anon, authenticated;
grant execute on function public.claim_ea_recaps(uuid, integer) to service_role;
grant execute on function public.release_ea_recaps(uuid, text[]) to service_role;
grant execute on function public.ea_recap(uuid, text[]) to service_role;
