-- PIRLO BOT · Fase 6.10: sitio web propio del club (p. ej. https://www.maritimo.app)
--
-- Un admin del club puede indicar el sitio oficial de su club. Se muestra en su página pública
-- y en el panel interno. Solo https. Solo añade objetos.

alter table public.clubs add column website_url text
  check (website_url is null or (website_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"]*)?$' and length(website_url) <= 200));

create function public.set_club_website(p_club_id uuid, p_url text, p_actor_discord_id text)
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
    raise exception 'Solo un admin del club puede cambiar su sitio web.' using errcode = 'P0001';
  end if;
  update public.clubs set website_url = p_url where id = p_club_id;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.website', 'club', p_club_id::text, jsonb_build_object('url', p_url));
end;
$$;

revoke execute on function public.set_club_website(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_club_website(uuid, text, text) to service_role;
