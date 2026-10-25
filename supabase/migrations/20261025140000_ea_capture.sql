-- PIRLO BOT · Fase 6.1: captura de partidos de EA (Pro Clubs)
--
-- EA solo devuelve los 5 últimos partidos de cada tipo, así que lo primero es guardarlos tal cual
-- llegan, antes de procesarlos. Esta tabla es una caché del proveedor (datos públicos de EA por
-- club de EA), no datos de un club de PIRLO: cada club de PIRLO se enlazará después con su club de
-- EA y solo verá los partidos de ese club.
-- Solo añade objetos.

create table public.ea_match_cache (
  platform text not null check (platform in ('common-gen5', 'common-gen4')),
  ea_club_id text not null check (ea_club_id ~ '^\d{1,12}$'),
  match_id text not null check (match_id ~ '^\d{1,20}$'),
  match_type text not null check (match_type in ('leagueMatch', 'playoffMatch', 'friendlyMatch')),
  played_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (platform, ea_club_id, match_id)
);
create index ea_match_cache_club_played_idx on public.ea_match_cache (platform, ea_club_id, played_at desc);

alter table public.ea_match_cache enable row level security;
revoke all on public.ea_match_cache from anon, authenticated;
grant all on public.ea_match_cache to service_role;
