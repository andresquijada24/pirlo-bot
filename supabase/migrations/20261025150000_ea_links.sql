-- PIRLO BOT · Fase 6.2: consentimiento por club y partidos de EA procesados
--
-- 1. club_ea_links: cada club de PIRLO enlaza (con el consentimiento de un admin) su club de EA.
--    Sin enlace no se guarda ni se procesa ningún partido de ese club de EA.
-- 2. ea_matches / ea_match_players: partidos ya procesados, SIEMPRE dentro de un club de PIRLO.
--    Los rivales (nombre, marcador, gamertags y estadísticas) se guardan solo en el club que
--    jugó contra ellos; nunca entran en rankings ni en estadísticas de la plantilla.
-- 3. Un dato que EA no trae se guarda como NULL, nunca 0.
--
-- PIRLO no lee de EA por sí mismo: la captura solo funcionará con una fuente autorizada.
-- Solo añade objetos.

create table public.club_ea_links (
  club_id uuid primary key references public.clubs (id) on delete cascade,
  platform text not null check (platform in ('common-gen5', 'common-gen4')),
  ea_club_id text not null check (ea_club_id ~ '^\d{1,12}$'),
  consented_by text not null check (consented_by ~ '^\d{17,20}$'),
  consented_at timestamptz not null default now(),
  consent_version text not null default 'v1',
  -- Un club de EA solo puede pertenecer a un club de PIRLO.
  unique (platform, ea_club_id)
);

create table public.ea_matches (
  club_id uuid not null references public.clubs (id) on delete cascade,
  match_id text not null check (match_id ~ '^\d{1,20}$'),
  platform text not null check (platform in ('common-gen5', 'common-gen4')),
  ea_club_id text not null check (ea_club_id ~ '^\d{1,12}$'),
  match_type text not null check (match_type in ('leagueMatch', 'playoffMatch', 'friendlyMatch')),
  played_at timestamptz not null,
  goals_for smallint check (goals_for >= 0),
  goals_against smallint check (goals_against >= 0),
  result text check (result in ('victoria', 'empate', 'derrota')),
  opponent_ea_club_id text check (opponent_ea_club_id ~ '^\d{1,12}$'),
  opponent_name text check (length(opponent_name) between 1 and 80),
  processed_at timestamptz not null default now(),
  primary key (club_id, match_id)
);
create index ea_matches_club_played_idx on public.ea_matches (club_id, played_at desc);

create table public.ea_match_players (
  club_id uuid not null,
  match_id text not null,
  side text not null check (side in ('propio', 'rival')),
  ea_player_id text not null check (ea_player_id ~ '^\d{1,20}$'),
  gamertag text not null check (length(btrim(gamertag)) between 1 and 40),
  position text check (length(position) between 1 and 20),
  seconds_played integer check (seconds_played >= 0),
  rating numeric(4, 2) check (rating between 0 and 10),
  goals smallint check (goals >= 0),
  assists smallint check (assists >= 0),
  shots smallint check (shots >= 0),
  passes_made smallint check (passes_made >= 0),
  passes_attempted smallint check (passes_attempted >= 0),
  tackles_made smallint check (tackles_made >= 0),
  tackles_attempted smallint check (tackles_attempted >= 0),
  saves smallint check (saves >= 0),
  goals_conceded smallint check (goals_conceded >= 0),
  red_cards smallint check (red_cards >= 0),
  man_of_the_match boolean,
  primary key (club_id, match_id, side, ea_player_id),
  foreign key (club_id, match_id) references public.ea_matches (club_id, match_id) on delete cascade
);
create index ea_match_players_gamertag_idx on public.ea_match_players (club_id, lower(gamertag)) where side = 'propio';

alter table public.club_ea_links enable row level security;
alter table public.ea_matches enable row level security;
alter table public.ea_match_players enable row level security;
revoke all on public.club_ea_links, public.ea_matches, public.ea_match_players from anon, authenticated;
grant all on public.club_ea_links, public.ea_matches, public.ea_match_players to service_role;

-- ---------------------------------------------------------------------------
-- Enlace con consentimiento (solo un admin del club)
-- ---------------------------------------------------------------------------
create function public.link_ea_club(p_club_id uuid, p_platform text, p_ea_club_id text, p_actor_discord_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous jsonb;
begin
  if not exists (
    select 1 from public.club_memberships m join public.players p on p.id = m.player_id
     where m.club_id = p_club_id and m.left_at is null and m.role = 'admin'
       and p.discord_user_id = p_actor_discord_id
  ) then
    raise exception 'Solo un admin del club puede vincular su club de EA.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.club_ea_links
     where platform = p_platform and ea_club_id = p_ea_club_id and club_id <> p_club_id
  ) then
    raise exception 'Ese club de EA ya está vinculado a otro club de PIRLO.' using errcode = 'P0001';
  end if;

  select to_jsonb(l) into v_previous from public.club_ea_links l where l.club_id = p_club_id;

  insert into public.club_ea_links (club_id, platform, ea_club_id, consented_by)
  values (p_club_id, p_platform, p_ea_club_id, p_actor_discord_id)
  on conflict (club_id) do update
    set platform = excluded.platform, ea_club_id = excluded.ea_club_id,
        consented_by = excluded.consented_by, consented_at = now(), consent_version = excluded.consent_version;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.ea_link', 'ea_club', p_ea_club_id,
          jsonb_build_object('platform', p_platform, 'anterior', v_previous));
end;
$$;

-- Retira el consentimiento: no se procesan más partidos. Los ya procesados se conservan.
create function public.unlink_ea_club(p_club_id uuid, p_actor_discord_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link jsonb;
begin
  if not exists (
    select 1 from public.club_memberships m join public.players p on p.id = m.player_id
     where m.club_id = p_club_id and m.left_at is null and m.role = 'admin'
       and p.discord_user_id = p_actor_discord_id
  ) then
    raise exception 'Solo un admin del club puede retirar el consentimiento de EA.' using errcode = 'P0001';
  end if;
  select to_jsonb(l) into v_link from public.club_ea_links l where l.club_id = p_club_id;
  if v_link is null then
    return false;
  end if;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.ea_unlink', 'ea_club', v_link ->> 'ea_club_id', v_link);
  delete from public.club_ea_links where club_id = p_club_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Procesamiento
-- ---------------------------------------------------------------------------
-- Partidos guardados en la caché del club de EA enlazado que este club aún no ha procesado.
create function public.pending_ea_matches(p_club_id uuid, p_limit integer)
returns table (match_id text, match_type text, played_at timestamptz, payload jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.match_id, c.match_type, c.played_at, c.payload
    from public.club_ea_links l
    join public.ea_match_cache c on c.platform = l.platform and c.ea_club_id = l.ea_club_id
   where l.club_id = p_club_id
     and not exists (select 1 from public.ea_matches m where m.club_id = l.club_id and m.match_id = c.match_id)
   order by c.played_at
   limit least(greatest(p_limit, 1), 100);
$$;

-- Guarda un partido procesado y sus jugadores en una sola operación. Devuelve false si ya existía.
-- Comprueba de nuevo que el partido es del club de EA enlazado (con consentimiento) a este club.
create function public.apply_ea_match(p_club_id uuid, p_match jsonb)
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
                                 goals_for, goals_against, result, opponent_ea_club_id, opponent_name)
  values (p_club_id, p_match ->> 'matchId', l.platform, l.ea_club_id, p_match ->> 'matchType',
          (p_match ->> 'playedAt')::timestamptz,
          (p_match ->> 'goalsFor')::smallint, (p_match ->> 'goalsAgainst')::smallint, p_match ->> 'result',
          p_match ->> 'opponentEaClubId', p_match ->> 'opponentName')
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

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function public.link_ea_club(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.unlink_ea_club(uuid, text) from public, anon, authenticated;
revoke execute on function public.pending_ea_matches(uuid, integer) from public, anon, authenticated;
revoke execute on function public.apply_ea_match(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.link_ea_club(uuid, text, text, text) to service_role;
grant execute on function public.unlink_ea_club(uuid, text) to service_role;
grant execute on function public.pending_ea_matches(uuid, integer) to service_role;
grant execute on function public.apply_ea_match(uuid, jsonb) to service_role;
