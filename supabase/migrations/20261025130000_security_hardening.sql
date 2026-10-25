-- PIRLO BOT · Fase 8: correcciones de la revisión de seguridad
--
-- 1. El gamertag de un jugador para emparejar estadísticas pasa a guardarse POR CLUB
--    (club_memberships.gamertag). Antes se escribía en players.ea_gamertag, que comparten todos
--    los clubes del jugador: un DT de un club podía cambiar a quién se asignan estadísticas de otro.
-- 2. Revincular un gamertag devuelve a "sin vincular" las estadísticas de la ficha anterior.
-- 3. Recordatorios: los servidores bloqueados se filtran en SQL (no ocupan la cola) y un
--    recordatorio que falló por un error temporal se puede liberar para reintentarlo.
-- 4. Desconectar un club de un servidor (/club desconectar), con copia en la auditoría.
-- 5. Permisos explícitos de las funciones nuevas (y una prueba que lo vigila para todas).
-- Solo añade objetos, rellena la nueva columna y reemplaza funciones.

-- ---------------------------------------------------------------------------
-- 1. Gamertag por club
-- ---------------------------------------------------------------------------
alter table public.club_memberships
  add column gamertag text check (gamertag is null or length(btrim(gamertag)) between 1 and 40);

-- Se copia el valor actual a las membresías activas (no se borra nada de players).
update public.club_memberships m set gamertag = btrim(p.ea_gamertag)
  from public.players p
 where p.id = m.player_id and m.left_at is null and m.gamertag is null and p.ea_gamertag is not null;

create index club_memberships_gamertag_idx on public.club_memberships (club_id, lower(gamertag))
  where left_at is null and gamertag is not null;

create or replace function public.member_by_gamertag(p_club uuid, p_gamertag text) returns uuid
language sql
stable
set search_path = ''
as $$
  select case when count(*) = 1 then min(m.player_id::text)::uuid end
    from public.club_memberships m
   where m.club_id = p_club and m.left_at is null
     and lower(m.gamertag) = lower(btrim(p_gamertag));
$$;

create or replace function public.link_player_gamertag(
  p_club uuid, p_player uuid, p_gamertag text, p_actor text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gt text := btrim(p_gamertag);
  v_old text;
  v_taken uuid;
  n integer;
begin
  select gamertag into v_old from public.club_memberships
   where club_id = p_club and player_id = p_player and left_at is null;
  if not found then
    raise exception 'Ese jugador no forma parte de la plantilla.' using errcode = 'P0001';
  end if;

  select player_id into v_taken from public.external_players
   where club_id = p_club and lower(gamertag) = lower(v_gt)
     and player_id is not null and player_id <> p_player
   limit 1;
  if v_taken is not null then
    raise exception 'Ese gamertag ya está vinculado a otro jugador del club' using errcode = 'P0001';
  end if;

  -- Solo cambia el dato de ESTE club.
  update public.club_memberships set gamertag = v_gt
   where club_id = p_club and player_id = p_player and left_at is null;

  -- Fichas del gamertag anterior: se liberan y sus estadísticas vuelven a "sin vincular".
  update public.player_session_stats st set player_id = null
   where st.club_id = p_club and st.player_id = p_player
     and (st.source_player_id in (select ep.external_id from public.external_players ep
                                   where ep.club_id = p_club and ep.player_id = p_player
                                     and lower(ep.gamertag) <> lower(v_gt))
          or (v_old is not null and lower(v_old) <> lower(v_gt)
              and st.source_player_id = 'gt:' || lower(v_old)));
  update public.external_players set player_id = null, linked_at = null
   where club_id = p_club and player_id = p_player and lower(gamertag) <> lower(v_gt);

  update public.external_players set player_id = p_player, linked_at = now()
   where club_id = p_club and lower(gamertag) = lower(v_gt);
  get diagnostics n = row_count;

  update public.player_session_stats st set player_id = p_player
   where st.club_id = p_club
     and (st.source_player_id in (select ep.external_id from public.external_players ep
                                   where ep.club_id = p_club and ep.player_id = p_player)
          or st.source_player_id = 'gt:' || lower(v_gt));

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club, p_actor, 'player.link_gamertag', 'player', p_player::text,
          jsonb_build_object('gamertag', v_gt, 'anterior', v_old, 'fichas', n));
  return n;
end;
$$;

create or replace function public.approve_link_request(
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
      set discord_verified_at = coalesce(discord_verified_at, now())
    where id = v_player;
  end if;

  insert into public.club_memberships (club_id, player_id, role, gamertag)
  values (p_club_id, v_player, p_role, nullif(btrim(r.ea_gamertag), ''))
  returning id into v_membership;

  update public.link_requests
    set status = 'aprobada', decided_at = now(), decided_by = p_decided_by
  where id = r.id;

  if r.ea_gamertag is not null and not exists (
    select 1 from public.external_players
     where club_id = p_club_id and lower(gamertag) = lower(btrim(r.ea_gamertag))
       and player_id is not null and player_id <> v_player
  ) then
    perform public.link_player_gamertag(p_club_id, v_player, r.ea_gamertag, p_decided_by);
  end if;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_decided_by, 'link.approve', 'membership', v_membership::text,
          jsonb_build_object('request_id', r.id, 'role', p_role));

  return v_membership;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Recordatorios
-- ---------------------------------------------------------------------------
create function public.due_callup_reminders(p_limit integer, p_blocked_guilds text[])
returns table (club_id uuid, callup_id uuid, guild_id text, channel_id text)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.club_id, d.callup_id, d.guild_id, d.channel_id
    from public.due_callup_reminders(1000) d
   where d.guild_id <> all (coalesce(p_blocked_guilds, '{}') || '{853894813169614848}'::text[])
   limit p_limit;
$$;

create function public.release_callup_reminder(p_club_id uuid, p_callup_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.callups set reminded_at = null where club_id = p_club_id and id = p_callup_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Desconectar un club de un servidor
-- ---------------------------------------------------------------------------
create function public.disconnect_club_guild(p_club_id uuid, p_guild_id text, p_actor_discord_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.club_memberships m join public.players p on p.id = m.player_id
     where m.club_id = p_club_id and m.left_at is null and m.role = 'admin'
       and p.discord_user_id = p_actor_discord_id
  ) then
    raise exception 'Solo un admin del club puede desconectarlo de un servidor.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.club_guilds where club_id = p_club_id and guild_id = p_guild_id) then
    raise exception 'El club no está conectado a ese servidor.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.club_guilds where club_id = p_club_id) <= 1 then
    raise exception 'Es el único servidor del club: no se puede desconectar.' using errcode = 'P0001';
  end if;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.disconnect_guild', 'guild', p_guild_id,
          jsonb_build_object('channels', coalesce((select jsonb_agg(to_jsonb(ch)) from public.club_channels ch
                                                    where ch.club_id = p_club_id and ch.guild_id = p_guild_id), '[]'::jsonb)));
  -- Los canales configurados en ese servidor se van con el vínculo (cascade).
  delete from public.club_guilds where club_id = p_club_id and guild_id = p_guild_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Permisos
-- ---------------------------------------------------------------------------
-- Postgres da EXECUTE a PUBLIC en cada función nueva y un "alter default privileges in schema"
-- no lo puede quitar. Por eso cada función revoca explícitamente y una prueba SQL comprueba que
-- ninguna función de public es ejecutable por anon ni authenticated.
revoke execute on function public.due_callup_reminders(integer, text[]) from public, anon, authenticated;
revoke execute on function public.release_callup_reminder(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.disconnect_club_guild(uuid, text, text) from public, anon, authenticated;
grant execute on function public.due_callup_reminders(integer, text[]) to service_role;
grant execute on function public.release_callup_reminder(uuid, uuid) to service_role;
grant execute on function public.disconnect_club_guild(uuid, text, text) to service_role;
