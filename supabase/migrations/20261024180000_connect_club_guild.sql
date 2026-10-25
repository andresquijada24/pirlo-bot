-- Conectar un club YA existente a otro servidor de Discord (p. ej. pasar del servidor de pruebas
-- al servidor real del club) sin crear un club nuevo: conserva plantilla, sesiones y temporadas.
--
-- Solo un admin activo del club puede hacerlo. Que además gestione el servidor de destino lo
-- comprueba el bot (permiso "Gestionar servidor" de Discord) antes de llamar a esta función.
-- No borra nada: añade el servidor (si no existía) y el vínculo club–servidor.

create function public.connect_club_guild(
  p_slug text,
  p_guild_id text,
  p_guild_name text,
  p_actor_discord_id text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_club uuid;
begin
  select c.id into v_club from public.clubs c where c.slug = lower(btrim(p_slug));
  if v_club is null then
    raise exception 'No existe un club con ese identificador.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.club_memberships m join public.players p on p.id = m.player_id
     where m.club_id = v_club and m.left_at is null and m.role = 'admin'
       and p.discord_user_id = p_actor_discord_id
  ) then
    raise exception 'Solo un admin del club puede conectarlo a otro servidor.' using errcode = 'P0001';
  end if;

  insert into public.guilds (id, name) values (p_guild_id, p_guild_name)
  on conflict (id) do update
    set name = coalesce(excluded.name, public.guilds.name), removed_at = null;

  -- Si el servidor ya tiene otro club y no es multiclub, el trigger enforce_single_club_guild lo impide.
  insert into public.club_guilds (club_id, guild_id, is_primary)
  values (
    v_club, p_guild_id,
    not exists (select 1 from public.club_guilds cg where cg.guild_id = p_guild_id and cg.is_primary)
  )
  on conflict (club_id, guild_id) do nothing;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id)
  values (v_club, p_actor_discord_id, 'club.connect_guild', 'guild', p_guild_id);

  return v_club;
end;
$$;

-- Solo el servidor del bot puede ejecutarla.
revoke execute on function public.connect_club_guild(text, text, text, text) from public, anon, authenticated;
grant execute on function public.connect_club_guild(text, text, text, text) to service_role;
