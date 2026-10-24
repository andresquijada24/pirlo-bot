-- PIRLO BOT · Migración 7: solicitudes de vinculación y operaciones atómicas del núcleo
--
-- Las operaciones que tocan varias tablas se hacen en funciones de Postgres para que sean
-- atómicas (todo o nada). Se ejecutan con los permisos de quien llama (security invoker) y
-- solo el servidor del bot (service_role) puede invocarlas.

-- ---------------------------------------------------------------------------
-- Solicitudes de vinculación jugador ↔ Discord
-- ---------------------------------------------------------------------------
create type public.link_request_status as enum ('pendiente', 'aprobada', 'rechazada');

create table public.link_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  discord_user_id text not null check (discord_user_id ~ '^\d{17,20}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  ea_gamertag text check (ea_gamertag is null or length(ea_gamertag) <= 40),
  status public.link_request_status not null default 'pendiente',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  check ((status = 'pendiente') = (decided_at is null)),
  unique (club_id, id)
);
-- Como mucho una solicitud pendiente por persona y club.
create unique index link_requests_one_pending
  on public.link_requests (club_id, discord_user_id) where status = 'pendiente';
create index link_requests_club_status_idx on public.link_requests (club_id, status, requested_at);

alter table public.link_requests enable row level security;
revoke all on public.link_requests from anon, authenticated;
grant all on public.link_requests to service_role;

-- ---------------------------------------------------------------------------
-- register_club: crea el club, lo vincula al servidor y nombra admin a quien lo registra.
-- ---------------------------------------------------------------------------
create function public.register_club(
  p_guild_id text,
  p_guild_name text,
  p_slug text,
  p_name text,
  p_admin_discord_id text,
  p_admin_display_name text
) returns table (club_id uuid, membership_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_club uuid;
  v_player uuid;
  v_membership uuid;
begin
  insert into public.guilds (id, name) values (p_guild_id, p_guild_name)
  on conflict (id) do update
    set name = coalesce(excluded.name, public.guilds.name), removed_at = null;

  insert into public.clubs (slug, name) values (p_slug, p_name) returning id into v_club;

  -- El primer club del servidor es el principal. El trigger impide un segundo club
  -- si el servidor no tiene habilitada la modalidad multiclub.
  insert into public.club_guilds (club_id, guild_id, is_primary)
  values (
    v_club, p_guild_id,
    not exists (select 1 from public.club_guilds cg where cg.guild_id = p_guild_id and cg.is_primary)
  );

  select p.id into v_player from public.players p where p.discord_user_id = p_admin_discord_id;
  if v_player is null then
    insert into public.players (display_name, discord_user_id, discord_verified_at)
    values (p_admin_display_name, p_admin_discord_id, now())
    returning id into v_player;
  end if;

  insert into public.club_memberships (club_id, player_id, role)
  values (v_club, v_player, 'admin')
  returning id into v_membership;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id)
  values (v_club, p_admin_discord_id, 'club.register', 'club', v_club::text);

  return query select v_club, v_membership;
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_link_request: aprueba una solicitud y crea la membresía.
-- ---------------------------------------------------------------------------
create function public.approve_link_request(
  p_club_id uuid,
  p_request_id uuid,
  p_decided_by text,
  p_role public.club_role
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.link_requests%rowtype;
  v_player uuid;
  v_membership uuid;
begin
  select * into r from public.link_requests
  where club_id = p_club_id and id = p_request_id
  for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.status <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta' using errcode = 'P0001';
  end if;

  select p.id into v_player from public.players p where p.discord_user_id = r.discord_user_id;
  if v_player is null then
    insert into public.players (display_name, ea_gamertag, discord_user_id, discord_verified_at)
    values (r.display_name, r.ea_gamertag, r.discord_user_id, now())
    returning id into v_player;
  else
    update public.players
      set discord_verified_at = coalesce(discord_verified_at, now()),
          ea_gamertag = coalesce(ea_gamertag, r.ea_gamertag)
    where id = v_player;
  end if;

  insert into public.club_memberships (club_id, player_id, role)
  values (p_club_id, v_player, p_role)
  returning id into v_membership;

  update public.link_requests
    set status = 'aprobada', decided_at = now(), decided_by = p_decided_by
  where id = r.id;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_decided_by, 'link.approve', 'membership', v_membership::text,
          jsonb_build_object('request_id', r.id, 'role', p_role));

  return v_membership;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_season: crea una temporada y, si se pide, la marca como actual.
-- ---------------------------------------------------------------------------
create function public.create_season(
  p_club_id uuid,
  p_name text,
  p_make_current boolean,
  p_actor_discord_id text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_season uuid;
begin
  if p_make_current then
    update public.seasons set is_current = false where club_id = p_club_id and is_current;
  end if;

  insert into public.seasons (club_id, name, is_current)
  values (p_club_id, p_name, p_make_current)
  returning id into v_season;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id)
  values (p_club_id, p_actor_discord_id, 'season.create', 'season', v_season::text);

  return v_season;
end;
$$;

-- Solo el servidor del bot puede ejecutar estas funciones.
revoke execute on function public.register_club(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.approve_link_request(uuid, uuid, text, public.club_role) from public, anon, authenticated;
revoke execute on function public.create_season(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.register_club(text, text, text, text, text, text) to service_role;
grant execute on function public.approve_link_request(uuid, uuid, text, public.club_role) to service_role;
grant execute on function public.create_season(uuid, text, boolean, text) to service_role;
