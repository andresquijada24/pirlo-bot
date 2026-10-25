-- PIRLO BOT · Pulido: tableros de convocatoria sincronizados y cancelación
--
-- - callup_messages: mensajes de Discord que muestran el tablero de una convocatoria (el original,
--   los que se vuelven a publicar con /convocatoria ver y los recordatorios). Al responder, cerrar
--   o cancelar, el bot edita todos para que muestren lo mismo.
-- - cancel_callup: cancela una convocatoria (deja de admitir respuestas y de recordarse).
-- Solo añade objetos; no borra datos.

create table public.callup_messages (
  club_id uuid not null,
  callup_id uuid not null,
  channel_id text not null check (channel_id ~ '^\d{17,20}$'),
  message_id text not null check (message_id ~ '^\d{17,20}$'),
  created_at timestamptz not null default now(),
  primary key (callup_id, message_id),
  foreign key (club_id, callup_id) references public.callups (club_id, id) on delete cascade
);
create index callup_messages_club_callup_idx on public.callup_messages (club_id, callup_id);

alter table public.callup_messages enable row level security;
revoke all on public.callup_messages from anon, authenticated;
grant all on public.callup_messages to service_role;

create function public.cancel_callup(p_club_id uuid, p_callup_id uuid, p_actor_discord_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.callups set status = 'cancelada'
   where club_id = p_club_id and id = p_callup_id and status <> 'cancelada';
  if not found then
    if exists (select 1 from public.callups where club_id = p_club_id and id = p_callup_id) then
      raise exception 'La convocatoria ya estaba cancelada.' using errcode = 'P0001';
    end if;
    raise exception 'Convocatoria no encontrada' using errcode = 'P0002';
  end if;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id)
  values (p_club_id, p_actor_discord_id, 'callup.cancel', 'callup', p_callup_id::text);
end;
$$;

revoke execute on function public.cancel_callup(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_callup(uuid, uuid, text) to service_role;
