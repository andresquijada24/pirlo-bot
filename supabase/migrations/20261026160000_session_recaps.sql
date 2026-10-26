-- PIRLO BOT · Fase 6.17: resumen de cada sesión publicado en Discord
--
-- Cuando llega una sesión nueva del proveedor (Marítimo), PIRLO publica su tarjeta en el canal de
-- resultados del club. Cada sesión se anuncia una sola vez:
-- - sessions.recap_posted_at: cuándo se reservó para anunciarla (NULL = pendiente).
-- - Las sesiones que ya existían se dan por anunciadas (no se publica el historial de golpe).
-- Solo añade una columna, un índice y funciones; no borra datos.

alter table public.sessions add column recap_posted_at timestamptz;
update public.sessions set recap_posted_at = coalesce(published_at, created_at) where recap_posted_at is null;

create index sessions_recap_pending_idx on public.sessions (club_id, published_at)
  where recap_posted_at is null and not is_duplicate;

-- Reserva atómica (dos ejecuciones a la vez no anuncian la misma sesión).
create function public.claim_session_recaps(p_club uuid, p_limit integer)
returns setof uuid
language sql
security invoker
set search_path = ''
as $$
  update public.sessions s set recap_posted_at = now()
   where s.id in (
     select id from public.sessions
      where club_id = p_club and recap_posted_at is null and not is_duplicate and source <> 'manual'
      order by published_at nulls last, created_at
      limit greatest(1, least(p_limit, 10))
      for update skip locked)
  returning s.id;
$$;

create function public.release_session_recaps(p_club uuid, p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sessions set recap_posted_at = null
   where club_id = p_club and id = any(p_ids);
$$;

revoke execute on function public.claim_session_recaps(uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_session_recaps(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_session_recaps(uuid, integer) to service_role;
grant execute on function public.release_session_recaps(uuid, uuid[]) to service_role;
