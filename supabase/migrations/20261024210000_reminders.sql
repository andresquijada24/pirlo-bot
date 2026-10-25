-- PIRLO BOT · Fase 7.3: recordatorios automáticos de convocatorias
--
-- - clubs.reminder_minutes: minutos antes del inicio en que se publica el recordatorio.
--   NULL = desactivado (por defecto): el bot no publica nada por su cuenta sin que el admin lo active.
-- - callups.reminded_at: cuándo se envió; garantiza un solo recordatorio por convocatoria.
-- - due_callup_reminders: convocatorias que ya deben recordarse, con el canal donde publicarlo.
-- - claim_callup_reminder: marca una convocatoria como recordada (solo una tarea la gana).
-- Solo añade objetos; no borra datos.

alter table public.clubs
  add column reminder_minutes smallint check (reminder_minutes is null or reminder_minutes between 15 and 1440);

alter table public.callups add column reminded_at timestamptz;

create function public.due_callup_reminders(p_limit integer)
returns table (club_id uuid, callup_id uuid, guild_id text, channel_id text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.club_id, c.id, ch.guild_id, ch.channel_id
    from public.callups c
    join public.clubs cl on cl.id = c.club_id
    -- Canal de recordatorios; si no hay, el de convocatorias.
    join lateral (
      select x.guild_id, x.channel_id from public.club_channels x
       where x.club_id = c.club_id and x.purpose in ('recordatorios', 'convocatorias')
       order by (x.purpose = 'recordatorios') desc
       limit 1
    ) ch on true
   where cl.status = 'activo'
     and cl.reminder_minutes is not null
     and c.status = 'abierta'
     and c.reminded_at is null
     and now() >= c.starts_at - make_interval(mins => cl.reminder_minutes)
     and now() < c.starts_at
   order by c.starts_at
   limit p_limit;
$$;

create function public.claim_callup_reminder(p_club_id uuid, p_callup_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.callups set reminded_at = now()
   where club_id = p_club_id and id = p_callup_id and reminded_at is null;
  return found;
end;
$$;

revoke execute on function public.due_callup_reminders(integer) from public, anon, authenticated;
revoke execute on function public.claim_callup_reminder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.due_callup_reminders(integer) to service_role;
grant execute on function public.claim_callup_reminder(uuid, uuid) to service_role;
