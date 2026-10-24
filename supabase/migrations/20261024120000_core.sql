-- PIRLO BOT · Migración 1: núcleo multiclub (clubes, servidores, jugadores, competición)
--
-- Reglas de diseño:
--   * Toda tabla de club lleva club_id. Las referencias entre tablas de club usan claves
--     foráneas COMPUESTAS (club_id, id) para que sea imposible enlazar filas de clubes distintos.
--   * Las estadísticas admiten NULL: dato no ofrecido por la fuente = NULL, nunca 0.
--   * Sin datos de ejemplo: esta migración solo crea estructura.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.stats_provider as enum ('maritimo', 'ourproclub', 'ea', 'manual');
create type public.club_status as enum ('activo', 'inactivo');
create type public.club_role as enum ('admin', 'dt', 'capitan', 'jugador');
create type public.position_code as enum (
  'POR', 'DFC', 'LI', 'LD', 'CAI', 'CAD', 'MCD', 'MC', 'MCO', 'MI', 'MD', 'EI', 'ED', 'SD', 'DC'
);
create type public.channel_purpose as enum (
  'anuncios', 'convocatorias', 'alineaciones', 'resultados', 'rankings', 'recordatorios'
);
create type public.match_status as enum ('programado', 'jugado', 'verificado', 'anulado');

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clubes y servidores de Discord
-- ---------------------------------------------------------------------------
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  name text not null check (length(btrim(name)) between 1 and 80),
  crest_url text check (crest_url is null or crest_url ~ '^https://'),
  ea_club_id text,
  platform text check (platform is null or platform in ('ps5', 'xbox', 'pc', 'crossplay')),
  stats_provider public.stats_provider not null default 'manual',
  status public.club_status not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clubs_updated_at before update on public.clubs
  for each row execute function public.set_updated_at();

create table public.guilds (
  id text primary key check (id ~ '^\d{17,20}$'), -- guild_id de Discord
  name text,
  multi_club_enabled boolean not null default false,
  installed_at timestamptz not null default now(),
  removed_at timestamptz
);

create table public.club_guilds (
  club_id uuid not null references public.clubs (id) on delete restrict,
  guild_id text not null references public.guilds (id) on delete restrict,
  is_primary boolean not null default true,
  linked_at timestamptz not null default now(),
  primary key (club_id, guild_id)
);
create index club_guilds_guild_idx on public.club_guilds (guild_id);
-- Como mucho un club principal por servidor.
create unique index club_guilds_one_primary on public.club_guilds (guild_id) where is_primary;

-- Un servidor sin modalidad multiclub solo puede tener un club.
create function public.enforce_single_club_guild() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (select g.multi_club_enabled from public.guilds g where g.id = new.guild_id)
     and exists (
       select 1 from public.club_guilds cg
       where cg.guild_id = new.guild_id and cg.club_id <> new.club_id
     ) then
    raise exception 'El servidor % no tiene habilitada la modalidad multiclub', new.guild_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger club_guilds_single_club before insert or update on public.club_guilds
  for each row execute function public.enforce_single_club_guild();

create table public.club_channels (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  guild_id text not null,
  channel_id text not null check (channel_id ~ '^\d{17,20}$'),
  purpose public.channel_purpose not null,
  created_at timestamptz not null default now(),
  unique (club_id, purpose),
  foreign key (club_id, guild_id) references public.club_guilds (club_id, guild_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------
-- Identidad global del jugador: puede cambiar de club sin perder su historial.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  ea_gamertag text,
  discord_user_id text unique check (discord_user_id is null or discord_user_id ~ '^\d{17,20}$'),
  discord_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discord_verified_at is null or discord_user_id is not null)
);
create trigger players_updated_at before update on public.players
  for each row execute function public.set_updated_at();

create table public.club_memberships (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  role public.club_role not null default 'jugador',
  positions public.position_code[] not null default '{}',
  shirt_number smallint check (shirt_number between 1 and 99),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  check (left_at is null or left_at >= joined_at),
  unique (club_id, id)
);
-- Una sola membresía activa por jugador y club.
create unique index club_memberships_active
  on public.club_memberships (club_id, player_id) where left_at is null;
create unique index club_memberships_active_shirt
  on public.club_memberships (club_id, shirt_number) where left_at is null and shirt_number is not null;
create index club_memberships_player_idx on public.club_memberships (player_id);

-- ---------------------------------------------------------------------------
-- Competición
-- ---------------------------------------------------------------------------
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 60),
  starts_on date,
  ends_on date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  unique (club_id, id),
  unique (club_id, name)
);
create unique index seasons_one_current on public.seasons (club_id) where is_current;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  season_id uuid,
  played_on date not null,
  label text,
  created_at timestamptz not null default now(),
  unique (club_id, id),
  foreign key (club_id, season_id) references public.seasons (club_id, id) on delete restrict
);
create index sessions_club_date_idx on public.sessions (club_id, played_on desc);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  season_id uuid,
  session_id uuid,
  opponent_name text,
  played_at timestamptz not null,
  goals_for smallint check (goals_for >= 0),
  goals_against smallint check (goals_against >= 0),
  result char(1) generated always as (
    case
      when goals_for is null or goals_against is null then null
      when goals_for > goals_against then 'V'
      when goals_for = goals_against then 'E'
      else 'D'
    end
  ) stored,
  status public.match_status not null default 'programado',
  source public.stats_provider not null,
  external_id text,
  source_version text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, id),
  unique (club_id, source, external_id),
  foreign key (club_id, season_id) references public.seasons (club_id, id) on delete restrict,
  foreign key (club_id, session_id) references public.sessions (club_id, id) on delete restrict,
  -- Un partido jugado o verificado debe tener marcador.
  check (status in ('programado', 'anulado') or (goals_for is not null and goals_against is not null))
);
create index matches_club_played_idx on public.matches (club_id, played_at desc);
create index matches_season_idx on public.matches (club_id, season_id);
create trigger matches_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

create table public.player_match_stats (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  match_id uuid not null,
  player_id uuid not null references public.players (id) on delete restrict,
  position_played public.position_code,
  goals smallint check (goals >= 0),
  assists smallint check (assists >= 0),
  tackles_made smallint check (tackles_made >= 0),
  tackles_attempted smallint check (tackles_attempted >= 0),
  clean_sheet_verified boolean,
  source public.stats_provider not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, player_id),
  foreign key (club_id, match_id) references public.matches (club_id, id) on delete cascade,
  check (tackles_made is null or tackles_attempted is null or tackles_made <= tackles_attempted)
);
create index player_match_stats_player_idx on public.player_match_stats (club_id, player_id);
create trigger player_match_stats_updated_at before update on public.player_match_stats
  for each row execute function public.set_updated_at();
