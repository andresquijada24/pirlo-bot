-- PIRLO BOT · Fase 6.8: página web pública del club
--
-- Cada club puede tener una página pública (pirlo-bot.vercel.app/club/<identificador>) con sus
-- resultados y estadísticas. Está DESACTIVADA por defecto: solo un admin la activa con
-- /club web. En la página, los rivales solo aparecen por nombre, colores y marcador.
-- Solo añade objetos.

alter table public.clubs add column web_public boolean not null default false;

create function public.set_club_web(p_club_id uuid, p_public boolean, p_actor_discord_id text)
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
    raise exception 'Solo un admin del club puede activar o desactivar la página web.' using errcode = 'P0001';
  end if;
  update public.clubs set web_public = p_public where id = p_club_id;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.web', 'club', p_club_id::text, jsonb_build_object('publica', p_public));
end;
$$;

revoke execute on function public.set_club_web(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_club_web(uuid, boolean, text) to service_role;
