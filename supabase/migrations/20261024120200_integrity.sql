-- PIRLO BOT · Migración 3: integridad, sincronización e historial

create type public.external_entity as enum ('club', 'player', 'match', 'season', 'session');
create type public.sync_status as enum ('en_curso', 'ok', 'error');

-- Correspondencia proveedor + id externo → id interno. Evita duplicados al sincronizar.
create table public.external_refs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  provider public.stats_provider not null,
  entity public.external_entity not null,
  external_id text not null,
  internal_id uuid not null,
  created_at timestamptz not null default now(),
  unique (club_id, provider, entity, external_id),
  unique (club_id, provider, entity, internal_id)
);

-- Una fila por ejecución de sincronización: cursor incremental, conteos y errores.
create table public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  provider public.stats_provider not null,
  status public.sync_status not null default 'en_curso',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cursor_before text,
  cursor_after text,
  rows_inserted integer not null default 0 check (rows_inserted >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  error_message text,
  check ((status = 'en_curso') = (finished_at is null))
);
create index provider_sync_runs_last_idx
  on public.provider_sync_runs (club_id, provider, started_at desc);
-- Como mucho una sincronización en curso por club y proveedor.
create unique index provider_sync_runs_one_running
  on public.provider_sync_runs (club_id, provider) where status = 'en_curso';

-- Historial de correcciones de estadísticas.
create table public.stat_revisions (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs (id) on delete restrict,
  stat_id uuid not null,
  match_id uuid not null,
  player_id uuid not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  changed_by text, -- discord_user_id o 'proveedor:<id>'
  changed_at timestamptz not null default now()
);
create index stat_revisions_stat_idx on public.stat_revisions (club_id, stat_id, changed_at desc);

-- Registra automáticamente cada cambio de una estadística.
-- El motivo y el autor se pasan por sesión: set_config('pirlo.change_reason', ..., true)
-- y set_config('pirlo.changed_by', ..., true). Sin motivo explícito queda 'no especificado'.
create function public.log_stat_revision() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  f text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  v_reason text := coalesce(nullif(current_setting('pirlo.change_reason', true), ''), 'no especificado');
  v_by text := nullif(current_setting('pirlo.changed_by', true), '');
begin
  foreach f in array array[
    'goals', 'assists', 'tackles_made', 'tackles_attempted', 'clean_sheet_verified', 'position_played'
  ] loop
    if o -> f is distinct from n -> f then
      insert into public.stat_revisions
        (club_id, stat_id, match_id, player_id, field, old_value, new_value, reason, changed_by)
      values
        (new.club_id, new.id, new.match_id, new.player_id, f, o -> f, n -> f, v_reason, v_by);
    end if;
  end loop;
  return new;
end;
$$;
create trigger player_match_stats_revision after update on public.player_match_stats
  for each row execute function public.log_stat_revision();

-- Quién hizo qué en cada club.
create table public.audit_log (
  id bigint generated always as identity primary key,
  club_id uuid references public.clubs (id) on delete restrict,
  actor_discord_id text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_club_idx on public.audit_log (club_id, created_at desc);
