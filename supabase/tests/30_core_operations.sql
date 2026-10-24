-- Pruebas de las operaciones atómicas del núcleo (migración 7).
begin;

-- Registrar un club crea servidor, club, vínculo, jugador admin y auditoría.
create temp table r1 as
  select * from public.register_club('300000000000000001', 'Servidor Uno', 'club-uno', 'Club Uno',
                                     '400000000000000001', 'Admin Uno');
select pg_temp.expect((select count(*) from r1) = 1, 'register_club devuelve club y membresía');
select pg_temp.expect(
  (select m.role = 'admin' and p.discord_user_id = '400000000000000001' and p.discord_verified_at is not null
   from public.club_memberships m join public.players p on p.id = m.player_id
   where m.id = (select membership_id from r1)),
  'quien registra el club queda como admin verificado');
select pg_temp.expect(
  (select is_primary from public.club_guilds where club_id = (select club_id from r1)),
  'el primer club del servidor es el principal');
select pg_temp.expect(
  exists (select 1 from public.audit_log where action = 'club.register' and club_id = (select club_id from r1)),
  'el registro queda en la auditoría');

-- Segundo club en el mismo servidor sin modalidad multiclub: falla y no deja restos.
select pg_temp.expect_error($$
  select * from public.register_club('300000000000000001', null, 'club-dos', 'Club Dos',
                                     '400000000000000002', 'Admin Dos')
$$, 'P0001', 'no se registra un segundo club en un servidor sin modalidad multiclub');
select pg_temp.expect(
  not exists (select 1 from public.clubs where slug = 'club-dos')
  and not exists (select 1 from public.players where discord_user_id = '400000000000000002'),
  'un registro fallido no deja datos a medias (atómico)');

select pg_temp.expect_error($$
  select * from public.register_club('300000000000000009', null, 'club-uno', 'Otro', '400000000000000009', 'X')
$$, '23505', 'el identificador del club es único');

-- Vinculación: solicitud → aprobación → membresía.
insert into public.link_requests (id, club_id, discord_user_id, display_name, ea_gamertag) values
  ('c0000000-0000-0000-0000-000000000001', (select club_id from r1), '400000000000000003', 'Jugador Tres', 'GT3');
select pg_temp.expect_error($$
  insert into public.link_requests (club_id, discord_user_id, display_name)
  values ((select club_id from r1), '400000000000000003', 'Duplicada')
$$, '23505', 'solo una solicitud pendiente por persona y club');

create temp table m3 as
  select public.approve_link_request((select club_id from r1), 'c0000000-0000-0000-0000-000000000001',
                                     '400000000000000001', 'jugador') as membership_id;
select pg_temp.expect(
  (select p.ea_gamertag = 'GT3' and p.discord_verified_at is not null and m.role = 'jugador'
   from public.club_memberships m join public.players p on p.id = m.player_id
   where m.id = (select membership_id from m3)),
  'aprobar crea el jugador verificado y su membresía');
select pg_temp.expect(
  (select status = 'aprobada' and decided_by = '400000000000000001' from public.link_requests
   where id = 'c0000000-0000-0000-0000-000000000001'),
  'la solicitud queda aprobada con quién la decidió');
select pg_temp.expect_error($$
  select public.approve_link_request((select club_id from r1), 'c0000000-0000-0000-0000-000000000001',
                                     '400000000000000001', 'jugador')
$$, 'P0001', 'una solicitud ya resuelta no se puede aprobar de nuevo');

-- Aislamiento: aprobar con el id de otro club no encuentra la solicitud.
insert into public.clubs (id, slug, name) values ('d0000000-0000-0000-0000-000000000000', 'club-ajeno', 'Club Ajeno');
insert into public.link_requests (id, club_id, discord_user_id, display_name) values
  ('c0000000-0000-0000-0000-000000000002', (select club_id from r1), '400000000000000004', 'Jugador Cuatro');
select pg_temp.expect_error($$
  select public.approve_link_request('d0000000-0000-0000-0000-000000000000',
                                     'c0000000-0000-0000-0000-000000000002', '400000000000000001', 'jugador')
$$, 'P0002', 'un club no puede aprobar solicitudes de otro club');

-- Temporadas: crear como actual desmarca la anterior.
create temp table s1 as select public.create_season((select club_id from r1), 'T1', true, '400000000000000001') as id;
create temp table s2 as select public.create_season((select club_id from r1), 'T2', true, '400000000000000001') as id;
select pg_temp.expect(
  (select not is_current from public.seasons where id = (select id from s1))
  and (select is_current from public.seasons where id = (select id from s2)),
  'una temporada nueva marcada como actual desmarca la anterior');

-- Solo el servidor puede ejecutar estas funciones.
select pg_temp.expect(
  not has_function_privilege('anon', 'public.register_club(text,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.approve_link_request(uuid,uuid,text,public.club_role)', 'execute')
  and has_function_privilege('service_role', 'public.create_season(uuid,text,boolean,text)', 'execute'),
  'solo service_role puede ejecutar las operaciones del núcleo');

rollback;
