-- PIRLO BOT · Fase 6.14: foto del jugador (captura de su Pro en The Grounds)
--
-- EA no ofrece la imagen del avatar, así que el jugador sube su propia captura con
-- /plantilla foto. Se guarda ya recortada (JPEG ~480×600, máx. ~200 KB en base64) en su ficha de
-- ESE club: cada club decide sobre su plantilla. La sube el propio jugador o un admin/DT del club.
-- Solo añade objetos.

alter table public.club_memberships
  add column photo_jpg text check (photo_jpg is null or (length(photo_jpg) <= 270000 and photo_jpg ~ '^[A-Za-z0-9+/]+=*$'));

create function public.set_member_photo(p_club_id uuid, p_membership_id uuid, p_jpg_base64 text, p_actor_discord_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner text;
begin
  select p.discord_user_id into v_owner
    from public.club_memberships m join public.players p on p.id = m.player_id
   where m.id = p_membership_id and m.club_id = p_club_id and m.left_at is null;
  if not found then
    raise exception 'Ese jugador no forma parte de la plantilla.' using errcode = 'P0002';
  end if;
  if v_owner is distinct from p_actor_discord_id and not exists (
    select 1 from public.club_memberships m join public.players p on p.id = m.player_id
     where m.club_id = p_club_id and m.left_at is null and m.role in ('admin', 'dt')
       and p.discord_user_id = p_actor_discord_id
  ) then
    raise exception 'Solo el propio jugador o un admin/DT del club puede cambiar su foto.' using errcode = 'P0001';
  end if;
  update public.club_memberships set photo_jpg = p_jpg_base64 where id = p_membership_id;
  -- En la auditoría solo queda el cambio, no la imagen.
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'member.photo', 'membership', p_membership_id::text,
          jsonb_build_object('quitada', p_jpg_base64 is null, 'bytes', coalesce(length(p_jpg_base64), 0)));
end;
$$;

revoke execute on function public.set_member_photo(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_member_photo(uuid, uuid, text, text) to service_role;
