-- PIRLO BOT · Fase 6.9: aprobación final de clubes nuevos por el dueño de PIRLO BOT
--
-- Los clubes nuevos (alta automática al instalar el bot o /club registrar) quedan 'pendiente'
-- hasta que el dueño los aprueba desde su DM con botones o desde el panel. Un club pendiente o
-- rechazado no responde comandos, no publica nada y no aparece en la web. Los clubes existentes
-- siguen 'activo'. Solo añade objetos (valores de enum y una función).

alter type public.club_status add value if not exists 'pendiente';
alter type public.club_status add value if not exists 'rechazado';

create function public.set_club_status(p_club_id uuid, p_status public.club_status, p_actor_discord_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.clubs set status = p_status where id = p_club_id;
  if not found then
    raise exception 'Club no encontrado.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.status', 'club', p_club_id::text,
          jsonb_build_object('estado', p_status::text));
end;
$$;

-- Solo el servidor (service_role). El control de que quien aprueba es el dueño está en la app.
revoke execute on function public.set_club_status(uuid, public.club_status, text) from public, anon, authenticated;
grant execute on function public.set_club_status(uuid, public.club_status, text) to service_role;
