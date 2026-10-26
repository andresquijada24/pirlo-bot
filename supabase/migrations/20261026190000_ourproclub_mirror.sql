-- PIRLO BOT · Fase 6.20: espejo de Our Pro Club desde el Discord de cada club
--
-- Un admin indica en qué canal publica Our Pro Club (/club canal, uso «Our Pro Club»): ese comando
-- es también el consentimiento del club. PIRLO lee los mensajes nuevos de ese canal (solo los de
-- Our Pro Club) y:
--   - cada partido terminado (imagen de Our Pro Club) → aviso al momento en el canal de resultados;
--   - cada «Session Recap» (texto con los números) → sesión con las estadísticas de cada jugador.
-- ourproclub_messages recuerda qué mensajes ya se procesaron (cada uno se procesa una sola vez).
-- Solo añade un valor al tipo de canal y una tabla; no borra ni modifica datos.

alter type public.channel_purpose add value if not exists 'ourproclub';

create table public.ourproclub_messages (
  club_id uuid not null references public.clubs (id) on delete cascade,
  message_id text not null check (message_id ~ '^\d{17,20}$'),
  kind text not null check (kind in ('partido', 'resumen', 'otro')),
  posted_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (club_id, message_id)
);
create index ourproclub_messages_recent_idx on public.ourproclub_messages (club_id, posted_at desc);
alter table public.ourproclub_messages enable row level security;
revoke all on public.ourproclub_messages from anon, authenticated;
grant select, insert on public.ourproclub_messages to service_role;
