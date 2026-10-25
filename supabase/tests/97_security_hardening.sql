-- Pruebas de la revisión de seguridad (fase 8). Datos ficticios; todo se deshace al final.
begin;

insert into public.guilds (id, name) values ('921000000000000001', 'A'), ('921000000000000002', 'B'), ('921000000000000003', 'C');
insert into public.clubs (id, slug, name) values
  ('a8000000-0000-0000-0000-000000000001', 'club-a8', 'Club A'),
  ('a8000000-0000-0000-0000-000000000002', 'club-b8', 'Club B');
insert into public.club_guilds (club_id, guild_id) values
  ('a8000000-0000-0000-0000-000000000001', '921000000000000001'),
  ('a8000000-0000-0000-0000-000000000002', '921000000000000002');
insert into public.players (id, display_name, discord_user_id) values
  ('a8300000-0000-0000-0000-000000000001', 'Doble', '720000000000000001'),
  ('a8300000-0000-0000-0000-000000000002', 'Admin A', '720000000000000002');
insert into public.club_memberships (club_id, player_id, role, gamertag) values
  ('a8000000-0000-0000-0000-000000000001', 'a8300000-0000-0000-0000-000000000001', 'jugador', 'Original'),
  ('a8000000-0000-0000-0000-000000000002', 'a8300000-0000-0000-0000-000000000001', 'jugador', 'Original'),
  ('a8000000-0000-0000-0000-000000000001', 'a8300000-0000-0000-0000-000000000002', 'admin', null);

-- 1. Un club no cambia el gamertag que usa otro club.
select public.link_player_gamertag('a8000000-0000-0000-0000-000000000001', 'a8300000-0000-0000-0000-000000000001', 'NuevoA', '720000000000000002');
select pg_temp.expect(
  (select gamertag = 'Original' from public.club_memberships
    where club_id = 'a8000000-0000-0000-0000-000000000002' and player_id = 'a8300000-0000-0000-0000-000000000001')
  and public.member_by_gamertag('a8000000-0000-0000-0000-000000000002', 'NuevoA') is null
  and public.member_by_gamertag('a8000000-0000-0000-0000-000000000001', 'nuevoa') = 'a8300000-0000-0000-0000-000000000001',
  'vincular un gamertag en un club no afecta a otro club');
select pg_temp.expect_error($$
  select public.link_player_gamertag('a8000000-0000-0000-0000-000000000002', 'a8300000-0000-0000-0000-000000000002', 'X', null)
$$, 'P0001', 'no se vincula a quien no es del club');

-- 2. Revincular devuelve a "sin vincular" las estadísticas de la ficha anterior.
insert into public.external_players (club_id, source, external_id, gamertag) values
  ('a8000000-0000-0000-0000-000000000001', 'maritimo', 'ext-a', 'NuevoA'),
  ('a8000000-0000-0000-0000-000000000001', 'maritimo', 'ext-b', 'OtraFicha');
select public.link_player_gamertag('a8000000-0000-0000-0000-000000000001', 'a8300000-0000-0000-0000-000000000001', 'NuevoA', null);
insert into public.sessions (id, club_id, played_on, source, external_id) values
  ('a8500000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', current_date, 'maritimo', 's-1');
insert into public.player_session_stats (club_id, session_id, player_id, source, source_player_id, source_player_name, goals) values
  ('a8000000-0000-0000-0000-000000000001', 'a8500000-0000-0000-0000-000000000001', 'a8300000-0000-0000-0000-000000000001', 'maritimo', 'ext-a', 'NuevoA', 3);
select public.link_player_gamertag('a8000000-0000-0000-0000-000000000001', 'a8300000-0000-0000-0000-000000000001', 'OtraFicha', null);
select pg_temp.expect(
  (select player_id is null from public.player_session_stats where source_player_id = 'ext-a')
  and (select player_id is null from public.external_players where external_id = 'ext-a')
  and (select player_id = 'a8300000-0000-0000-0000-000000000001' from public.external_players where external_id = 'ext-b'),
  'al revincular, las estadísticas de la ficha anterior dejan de contar para ese jugador');

-- 3. Recordatorios: el servidor bloqueado y el de referencia no ocupan la cola.
insert into public.guilds (id, name) values ('853894813169614848', 'Referencia');
insert into public.clubs (id, slug, name, reminder_minutes) values
  ('a8000000-0000-0000-0000-000000000003', 'club-ref', 'Ref', 60);
insert into public.club_guilds (club_id, guild_id) values ('a8000000-0000-0000-0000-000000000003', '853894813169614848');
insert into public.club_channels (club_id, guild_id, purpose, channel_id) values
  ('a8000000-0000-0000-0000-000000000003', '853894813169614848', 'convocatorias', '931000000000000001'),
  ('a8000000-0000-0000-0000-000000000002', '921000000000000002', 'convocatorias', '931000000000000002');
update public.clubs set reminder_minutes = 60 where id = 'a8000000-0000-0000-0000-000000000002';
insert into public.callups (id, club_id, title, starts_at) values
  ('a8600000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000003', 'Ref', now() + interval '10 minutes'),
  ('a8600000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000002', 'B', now() + interval '20 minutes');
select pg_temp.expect(
  (select array_agg(callup_id::text) = array['a8600000-0000-0000-0000-000000000002'] from public.due_callup_reminders(1, '{}')),
  'el servidor de referencia nunca entra en la cola de recordatorios');
select pg_temp.expect(
  (select count(*) = 0 from public.due_callup_reminders(10, '{921000000000000002}')),
  'los servidores bloqueados se filtran en la consulta');
select public.claim_callup_reminder('a8000000-0000-0000-0000-000000000002', 'a8600000-0000-0000-0000-000000000002');
select public.release_callup_reminder('a8000000-0000-0000-0000-000000000002', 'a8600000-0000-0000-0000-000000000002');
select pg_temp.expect(
  (select count(*) = 1 from public.due_callup_reminders(10, '{}')),
  'un recordatorio liberado vuelve a la cola');

-- 4. Desconectar un servidor.
select pg_temp.expect_error($$
  select public.disconnect_club_guild('a8000000-0000-0000-0000-000000000001', '921000000000000001', '720000000000000002')
$$, 'P0001', 'no se desconecta el único servidor del club');
insert into public.club_guilds (club_id, guild_id) values ('a8000000-0000-0000-0000-000000000001', '921000000000000003');
insert into public.club_channels (club_id, guild_id, purpose, channel_id) values
  ('a8000000-0000-0000-0000-000000000001', '921000000000000003', 'anuncios', '931000000000000003');
select pg_temp.expect_error($$
  select public.disconnect_club_guild('a8000000-0000-0000-0000-000000000001', '921000000000000003', '720000000000000001')
$$, 'P0001', 'solo un admin del club puede desconectar');
select public.disconnect_club_guild('a8000000-0000-0000-0000-000000000001', '921000000000000003', '720000000000000002');
select pg_temp.expect(
  not exists (select 1 from public.club_guilds where club_id = 'a8000000-0000-0000-0000-000000000001' and guild_id = '921000000000000003')
  and not exists (select 1 from public.club_channels where channel_id = '931000000000000003')
  and exists (select 1 from public.audit_log where action = 'club.disconnect_guild' and jsonb_array_length(details -> 'channels') = 1),
  'desconectar quita el vínculo y sus canales, con copia en la auditoría');

-- 5. Ninguna función pública es ejecutable por anon ni authenticated.
select pg_temp.expect(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ),
  'ninguna función de public es ejecutable por anon o authenticated');

rollback;
