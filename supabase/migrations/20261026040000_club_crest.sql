-- PIRLO BOT · Fase 6.6: escudo de cada club
--
-- Un admin sube el escudo de su club con /club escudo. Se guarda ya reducido (PNG de 256 px,
-- máx. ~150 KB en base64) para dibujarlo en las imágenes de partido. Solo el escudo del propio
-- club: los rivales siguen con iniciales (no se usan escudos de EA).
-- Solo añade objetos.

alter table public.clubs
  add column crest_png text check (crest_png is null or (length(crest_png) <= 200000 and crest_png ~ '^[A-Za-z0-9+/]+=*$'));

create function public.set_club_crest(p_club_id uuid, p_png_base64 text, p_actor_discord_id text)
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
    raise exception 'Solo un admin del club puede cambiar el escudo.' using errcode = 'P0001';
  end if;
  update public.clubs set crest_png = p_png_base64 where id = p_club_id;
  -- En la auditoría solo queda el cambio, no la imagen.
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'club.crest', 'club', p_club_id::text,
          jsonb_build_object('quitado', p_png_base64 is null, 'bytes', coalesce(length(p_png_base64), 0)));
end;
$$;

revoke execute on function public.set_club_crest(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_club_crest(uuid, text, text) to service_role;
