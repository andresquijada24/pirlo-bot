-- Pruebas de conectar un club existente a otro servidor (migración 20261024180000).
begin;

insert into public.clubs (id, slug, name) values
  ('a8000000-0000-0000-0000-000000000001', 'club-c', 'Club C'),
  ('a8000000-0000-0000-0000-000000000002', 'club-d', 'Club D');
insert into public.guilds (id, name) values
  ('700000000000000001', 'Pruebas'), ('700000000000000003', 'Servidor de D');
insert into public.club_guilds (club_id, guild_id) values
  ('a8000000-0000-0000-0000-000000000001', '700000000000000001'),
  ('a8000000-0000-0000-0000-000000000002', '700000000000000003');
insert into public.players (id, display_name, discord_user_id) values
  ('a8100000-0000-0000-0000-000000000001', 'Admin', '610000000000000001'),
  ('a8100000-0000-0000-0000-000000000002', 'Jugador', '610000000000000002');
insert into public.club_memberships (club_id, player_id, role) values
  ('a8000000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000001', 'admin'),
  ('a8000000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000002', 'jugador');

select pg_temp.expect(
  public.connect_club_guild(' Club-C ', '700000000000000002', 'Servidor real', '610000000000000001')
    = 'a8000000-0000-0000-0000-000000000001',
  'un admin conecta el club a un servidor nuevo');
select pg_temp.expect(
  exists (select 1 from public.club_guilds where club_id = 'a8000000-0000-0000-0000-000000000001'
            and guild_id = '700000000000000002' and is_primary)
  and exists (select 1 from public.club_guilds where club_id = 'a8000000-0000-0000-0000-000000000001'
            and guild_id = '700000000000000001'),
  'el club queda en los dos servidores (principal en el nuevo)');
select pg_temp.expect(
  (select name = 'Servidor real' from public.guilds where id = '700000000000000002'),
  'el servidor se registra con su nombre');
select pg_temp.expect(
  exists (select 1 from public.audit_log where action = 'club.connect_guild' and entity_id = '700000000000000002'),
  'queda en la auditoría');
select pg_temp.expect(
  public.connect_club_guild('club-c', '700000000000000002', null, '610000000000000001')
    = 'a8000000-0000-0000-0000-000000000001',
  'repetirlo no falla ni duplica');

select pg_temp.expect_error(
  $q$select public.connect_club_guild('club-c', '700000000000000004', null, '610000000000000002')$q$,
  'P0001', 'un jugador que no es admin no puede conectar el club');
select pg_temp.expect_error(
  $q$select public.connect_club_guild('no-existe', '700000000000000004', null, '610000000000000001')$q$,
  'P0001', 'un identificador inexistente falla');
select pg_temp.expect_error(
  $q$select public.connect_club_guild('club-c', '700000000000000003', null, '610000000000000001')$q$,
  'P0001', 'no se conecta a un servidor que ya tiene otro club (sin multiclub)');

select pg_temp.expect(
  not has_function_privilege('anon', 'public.connect_club_guild(text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.connect_club_guild(text, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.connect_club_guild(text, text, text, text)', 'execute'),
  'solo service_role puede ejecutar connect_club_guild');

rollback;
