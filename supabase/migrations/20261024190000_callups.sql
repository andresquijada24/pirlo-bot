-- PIRLO BOT · Fase 7.1: convocatorias (Voy / No voy / Duda)
--
-- - clubs.timezone: zona horaria con la que se interpretan las fechas que escribe el club.
--   En Discord las horas se muestran con marcas <t:…> que cada usuario ve en su hora local.
-- - create_callup: crea la convocatoria y su evento del calendario en una sola transacción.
-- - respond_callup: guarda (o cambia) la respuesta de un jugador mientras esté abierta.
-- - close_callup: cierra una convocatoria abierta.
-- Solo añade objetos; no borra datos.

alter table public.clubs
  add column timezone text not null default 'America/Caracas'
    check (timezone = 'UTC' or timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$');

create function public.create_callup(
  p_club_id uuid,
  p_title text,
  p_opponent text,
  p_starts_at timestamptz,
  p_closes_at timestamptz,
  p_actor_discord_id text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_player uuid;
  v_event uuid;
  v_callup uuid;
begin
  if p_starts_at <= now() then
    raise exception 'La fecha de la convocatoria ya pasó.' using errcode = 'P0001';
  end if;
  if p_closes_at is not null and p_closes_at <= now() then
    raise exception 'La hora de cierre ya pasó.' using errcode = 'P0001';
  end if;

  select p.id into v_player
    from public.players p
    join public.club_memberships m on m.player_id = p.id and m.club_id = p_club_id and m.left_at is null
   where p.discord_user_id = p_actor_discord_id;

  insert into public.events (club_id, kind, title, starts_at, created_by)
  values (p_club_id, 'partido', btrim(p_title), p_starts_at, v_player)
  returning id into v_event;

  insert into public.callups (club_id, event_id, title, opponent_name, starts_at, closes_at, created_by)
  values (p_club_id, v_event, btrim(p_title), nullif(btrim(p_opponent), ''), p_starts_at, p_closes_at, v_player)
  returning id into v_callup;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'callup.create', 'callup', v_callup::text,
          jsonb_build_object('title', btrim(p_title), 'starts_at', p_starts_at));
  return v_callup;
end;
$$;

-- Guarda o cambia la respuesta. Lanza P0001 si la convocatoria ya no admite respuestas.
create function public.respond_callup(
  p_club_id uuid,
  p_callup_id uuid,
  p_player_id uuid,
  p_answer public.callup_answer
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c public.callups%rowtype;
begin
  select * into c from public.callups where club_id = p_club_id and id = p_callup_id;
  if not found then
    raise exception 'Convocatoria no encontrada' using errcode = 'P0002';
  end if;
  if c.status <> 'abierta' then
    raise exception 'Esta convocatoria está cerrada.' using errcode = 'P0001';
  end if;
  if now() >= coalesce(c.closes_at, c.starts_at) then
    raise exception 'El plazo para responder ya terminó.' using errcode = 'P0001';
  end if;

  -- Solo miembros activos del club.
  if not exists (
    select 1 from public.club_memberships
     where club_id = p_club_id and player_id = p_player_id and left_at is null
  ) then
    raise exception 'Solo los miembros del club pueden responder.' using errcode = 'P0001';
  end if;

  insert into public.callup_responses (callup_id, club_id, player_id, answer)
  values (p_callup_id, p_club_id, p_player_id, p_answer)
  on conflict (callup_id, player_id) do update
    set answer = excluded.answer, responded_at = now();
end;
$$;

create function public.close_callup(
  p_club_id uuid,
  p_callup_id uuid,
  p_actor_discord_id text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.callups set status = 'cerrada'
   where club_id = p_club_id and id = p_callup_id and status = 'abierta';
  if not found then
    if exists (select 1 from public.callups where club_id = p_club_id and id = p_callup_id) then
      raise exception 'La convocatoria ya estaba cerrada.' using errcode = 'P0001';
    end if;
    raise exception 'Convocatoria no encontrada' using errcode = 'P0002';
  end if;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id)
  values (p_club_id, p_actor_discord_id, 'callup.close', 'callup', p_callup_id::text);
end;
$$;

revoke execute on function public.create_callup(uuid, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.respond_callup(uuid, uuid, uuid, public.callup_answer) from public, anon, authenticated;
revoke execute on function public.close_callup(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_callup(uuid, text, text, timestamptz, timestamptz, text) to service_role;
grant execute on function public.respond_callup(uuid, uuid, uuid, public.callup_answer) to service_role;
grant execute on function public.close_callup(uuid, uuid, text) to service_role;
