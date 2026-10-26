-- PIRLO BOT · Fase 6.7: colores del rival en la imagen del partido
--
-- El escudo genérico del rival (iniciales) se pinta con los colores de su equipación local, que
-- vienen en los datos del partido de EA (customKit.kitColor1/kitColor2). Son datos del partido,
-- no la imagen de nadie: no se descargan escudos de EA.
-- Añade dos columnas, reemplaza dos funciones y completa los colores de los partidos ya
-- procesados a partir de la caché. No borra nada.

alter table public.ea_matches
  add column opponent_color1 text check (opponent_color1 ~ '^#[0-9a-f]{6}$'),
  add column opponent_color2 text check (opponent_color2 ~ '^#[0-9a-f]{6}$');

-- Color de EA (entero en texto, p. ej. "15921906") a "#rrggbb"; null si no es válido.
create function public.ea_color(p_value text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value ~ '^\d{1,8}$' and p_value::bigint <= 16777215
              then '#' || lpad(to_hex(p_value::int), 6, '0') end;
$$;

create or replace function public.apply_ea_match(p_club_id uuid, p_match jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l public.club_ea_links%rowtype;
begin
  select * into l from public.club_ea_links where club_id = p_club_id;
  if not found or l.platform <> p_match ->> 'platform' or l.ea_club_id <> p_match ->> 'eaClubId' then
    raise exception 'El partido no pertenece al club de EA vinculado a este club.' using errcode = 'P0001';
  end if;

  insert into public.ea_matches (club_id, match_id, platform, ea_club_id, match_type, played_at,
                                 goals_for, goals_against, result, opponent_ea_club_id, opponent_name,
                                 opponent_color1, opponent_color2)
  values (p_club_id, p_match ->> 'matchId', l.platform, l.ea_club_id, p_match ->> 'matchType',
          (p_match ->> 'playedAt')::timestamptz,
          (p_match ->> 'goalsFor')::smallint, (p_match ->> 'goalsAgainst')::smallint, p_match ->> 'result',
          p_match ->> 'opponentEaClubId', p_match ->> 'opponentName',
          p_match -> 'opponentColors' ->> 'primary', p_match -> 'opponentColors' ->> 'secondary')
  on conflict (club_id, match_id) do nothing;
  if not found then
    return false;
  end if;

  insert into public.ea_match_players (club_id, match_id, side, ea_player_id, gamertag, position,
    seconds_played, rating, goals, assists, shots, passes_made, passes_attempted, tackles_made,
    tackles_attempted, saves, goals_conceded, red_cards, man_of_the_match)
  select p_club_id, p_match ->> 'matchId', x.side, x."eaPlayerId", btrim(x.gamertag), x.position,
         x."secondsPlayed", x.rating, x.goals, x.assists, x.shots, x."passesMade", x."passesAttempted",
         x."tacklesMade", x."tacklesAttempted", x.saves, x."goalsConceded", x."redCards", x."manOfTheMatch"
    from jsonb_to_recordset(coalesce(p_match -> 'players', '[]'::jsonb)) as x(
      side text, "eaPlayerId" text, gamertag text, position text, "secondsPlayed" integer,
      rating numeric, goals smallint, assists smallint, shots smallint, "passesMade" smallint,
      "passesAttempted" smallint, "tacklesMade" smallint, "tacklesAttempted" smallint, saves smallint,
      "goalsConceded" smallint, "redCards" smallint, "manOfTheMatch" boolean);
  return true;
end;
$$;

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
      'opponentColors', case when m.opponent_color1 is not null
                             then jsonb_build_object('primary', m.opponent_color1,
                                                     'secondary', coalesce(m.opponent_color2, m.opponent_color1)) end,
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

-- Partidos ya procesados: colores a partir de la copia guardada del partido.
update public.ea_matches m
   set opponent_color1 = public.ea_color(c.payload -> 'clubs' -> m.opponent_ea_club_id -> 'details' -> 'customKit' ->> 'kitColor1'),
       opponent_color2 = public.ea_color(c.payload -> 'clubs' -> m.opponent_ea_club_id -> 'details' -> 'customKit' ->> 'kitColor2')
  from public.ea_match_cache c
 where c.platform = m.platform and c.ea_club_id = m.ea_club_id and c.match_id = m.match_id
   and m.opponent_ea_club_id is not null and m.opponent_color1 is null;

revoke execute on function public.ea_color(text) from public, anon, authenticated;
revoke execute on function public.apply_ea_match(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ea_recap(uuid, text[]) from public, anon, authenticated;
grant execute on function public.ea_color(text) to service_role;
grant execute on function public.apply_ea_match(uuid, jsonb) to service_role;
grant execute on function public.ea_recap(uuid, text[]) to service_role;
