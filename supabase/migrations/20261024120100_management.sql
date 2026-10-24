-- PIRLO BOT · Migración 2: gestión (calendario, convocatorias, alineaciones, publicaciones)

create type public.event_kind as enum ('partido', 'entrenamiento', 'torneo', 'otro');
create type public.callup_status as enum ('abierta', 'cerrada', 'cancelada');
create type public.callup_answer as enum ('voy', 'no_voy', 'duda');
create type public.lineup_status as enum ('borrador', 'publicada');
create type public.post_kind as enum ('recordatorio', 'convocatoria', 'alineacion', 'resultado', 'ranking', 'otro');
create type public.post_status as enum ('pendiente', 'enviado', 'fallido', 'cancelado');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  kind public.event_kind not null,
  title text not null check (length(btrim(title)) between 1 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz,
  match_id uuid,
  created_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  unique (club_id, id),
  foreign key (club_id, match_id) references public.matches (club_id, id) on delete set null (match_id)
);
create index events_club_start_idx on public.events (club_id, starts_at);

create table public.callups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  event_id uuid,
  title text not null check (length(btrim(title)) between 1 and 100),
  opponent_name text,
  starts_at timestamptz not null,
  closes_at timestamptz,
  status public.callup_status not null default 'abierta',
  channel_id text check (channel_id is null or channel_id ~ '^\d{17,20}$'),
  message_id text check (message_id is null or message_id ~ '^\d{17,20}$'),
  created_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  check (closes_at is null or closes_at <= starts_at),
  unique (club_id, id),
  foreign key (club_id, event_id) references public.events (club_id, id) on delete set null (event_id)
);
create index callups_club_start_idx on public.callups (club_id, starts_at desc);

create table public.callup_responses (
  callup_id uuid not null,
  club_id uuid not null,
  player_id uuid not null references public.players (id) on delete cascade,
  answer public.callup_answer not null,
  note text check (note is null or length(note) <= 200),
  responded_at timestamptz not null default now(),
  primary key (callup_id, player_id),
  foreign key (club_id, callup_id) references public.callups (club_id, id) on delete cascade
);

create table public.lineups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  callup_id uuid,
  match_id uuid,
  formation text not null check (formation ~ '^\d(-\d){2,4}$'), -- p. ej. 4-3-3, 4-2-3-1
  status public.lineup_status not null default 'borrador',
  channel_id text check (channel_id is null or channel_id ~ '^\d{17,20}$'),
  message_id text check (message_id is null or message_id ~ '^\d{17,20}$'),
  published_at timestamptz,
  created_by uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((status = 'publicada') = (published_at is not null)),
  unique (club_id, id),
  foreign key (club_id, callup_id) references public.callups (club_id, id) on delete set null (callup_id),
  foreign key (club_id, match_id) references public.matches (club_id, id) on delete set null (match_id)
);

create table public.lineup_slots (
  lineup_id uuid not null,
  club_id uuid not null,
  slot smallint not null check (slot between 1 and 23),
  position public.position_code,
  player_id uuid references public.players (id) on delete set null,
  is_substitute boolean not null default false,
  primary key (lineup_id, slot),
  foreign key (club_id, lineup_id) references public.lineups (club_id, id) on delete cascade
);
-- Un jugador no puede ocupar dos huecos de la misma alineación.
create unique index lineup_slots_player_once on public.lineup_slots (lineup_id, player_id)
  where player_id is not null;

create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  kind public.post_kind not null,
  channel_id text not null check (channel_id ~ '^\d{17,20}$'),
  run_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status public.post_status not null default 'pendiente',
  attempts smallint not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'enviado') = (sent_at is not null))
);
-- Cola de trabajo de /api/cron/tick.
create index scheduled_posts_due_idx on public.scheduled_posts (run_at) where status = 'pendiente';
