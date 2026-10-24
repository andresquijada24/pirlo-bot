-- PIRLO BOT · Migración 6: índices para claves foráneas
-- Recomendado por el asesor de rendimiento de Supabase (lint 0001_unindexed_foreign_keys).
-- Acelera borrados/actualizaciones en tablas padre y las consultas por club.

create index callup_responses_club_callup_idx on public.callup_responses (club_id, callup_id);
create index callup_responses_player_idx on public.callup_responses (player_id);

create index callups_club_event_idx on public.callups (club_id, event_id);
create index callups_created_by_idx on public.callups (created_by);

create index club_channels_club_guild_idx on public.club_channels (club_id, guild_id);

create index events_club_match_idx on public.events (club_id, match_id);
create index events_created_by_idx on public.events (created_by);

create index lineup_slots_club_lineup_idx on public.lineup_slots (club_id, lineup_id);
create index lineup_slots_player_idx on public.lineup_slots (player_id);

create index lineups_club_callup_idx on public.lineups (club_id, callup_id);
create index lineups_club_match_idx on public.lineups (club_id, match_id);
create index lineups_created_by_idx on public.lineups (created_by);

create index matches_club_session_idx on public.matches (club_id, session_id);

create index player_match_stats_club_match_idx on public.player_match_stats (club_id, match_id);
create index player_match_stats_player_only_idx on public.player_match_stats (player_id);

create index scheduled_posts_club_idx on public.scheduled_posts (club_id);

create index sessions_club_season_idx on public.sessions (club_id, season_id);
