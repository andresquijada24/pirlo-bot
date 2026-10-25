-- Pruebas de convocatorias (fase 7.1). Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values
  ('c1000000-0000-0000-0000-000000000000', 'club-c', 'Club C'),
  ('c2000000-0000-0000-0000-000000000000', 'club-d', 'Club D');
insert into public.players (id, display_name, discord_user_id) values
  ('c1300000-0000-0000-0000-000000000001', 'Capi', '700000000000000001'),
  ('c1300000-0000-0000-0000-000000000002', 'Jugador', '700000000000000002'),
  ('c1300000-0000-0000-0000-000000000003', 'Ajeno', '700000000000000003');
insert into public.club_memberships (club_id, player_id, role) values
  ('c1000000-0000-0000-0000-000000000000', 'c1300000-0000-0000-0000-000000000001', 'capitan'),
  ('c1000000-0000-0000-0000-000000000000', 'c1300000-0000-0000-0000-000000000002', 'jugador'),
  ('c2000000-0000-0000-0000-000000000000', 'c1300000-0000-0000-0000-000000000003', 'jugador');

select pg_temp.expect(
  (select timezone = 'America/Caracas' from public.clubs where slug = 'club-c'),
  'la zona horaria por defecto es Caracas');
select pg_temp.expect_error($$
  update public.clubs set timezone = 'hora; drop' where slug = 'club-c'
$$, '23514', 'una zona horaria con formato inválido se rechaza');

create temp table t (callup uuid) on commit drop;
insert into t select public.create_callup('c1000000-0000-0000-0000-000000000000', ' Liga J1 ', 'Rival FC',
  now() + interval '1 day', now() + interval '23 hours', '700000000000000001');

select pg_temp.expect(
  (select c.title = 'Liga J1' and c.status = 'abierta' and c.event_id is not null
          and c.created_by = 'c1300000-0000-0000-0000-000000000001'
     from public.callups c, t where c.id = t.callup),
  'crear una convocatoria crea también su evento del calendario');
select pg_temp.expect(
  exists (select 1 from public.audit_log where action = 'callup.create'),
  'la creación queda en la auditoría');
select pg_temp.expect_error($$
  select public.create_callup('c1000000-0000-0000-0000-000000000000', 'Pasado', null, now() - interval '1 hour', null, '700000000000000001')
$$, 'P0001', 'no se puede convocar en el pasado');

select public.respond_callup('c1000000-0000-0000-0000-000000000000', (select callup from t),
  'c1300000-0000-0000-0000-000000000002', 'duda');
select public.respond_callup('c1000000-0000-0000-0000-000000000000', (select callup from t),
  'c1300000-0000-0000-0000-000000000002', 'voy');
select pg_temp.expect(
  (select count(*) = 1 and min(answer::text) = 'voy' from public.callup_responses r, t where r.callup_id = t.callup),
  'responder dos veces cambia la respuesta, no la duplica');

select pg_temp.expect_error($$
  select public.respond_callup('c1000000-0000-0000-0000-000000000000', (select callup from t),
    'c1300000-0000-0000-0000-000000000003', 'voy')
$$, 'P0001', 'alguien de otro club no puede responder');
select pg_temp.expect_error($$
  select public.respond_callup('c2000000-0000-0000-0000-000000000000', (select callup from t),
    'c1300000-0000-0000-0000-000000000003', 'voy')
$$, 'P0002', 'una convocatoria no se encuentra desde otro club');

select public.close_callup('c1000000-0000-0000-0000-000000000000', (select callup from t), '700000000000000001');
select pg_temp.expect(
  (select c.status = 'cerrada' from public.callups c, t where c.id = t.callup),
  'cerrar deja la convocatoria cerrada');
select pg_temp.expect_error($$
  select public.respond_callup('c1000000-0000-0000-0000-000000000000', (select callup from t),
    'c1300000-0000-0000-0000-000000000001', 'voy')
$$, 'P0001', 'una convocatoria cerrada no admite respuestas');
select pg_temp.expect_error($$
  select public.close_callup('c1000000-0000-0000-0000-000000000000', (select callup from t), '700000000000000001')
$$, 'P0001', 'no se cierra dos veces');

-- Plazo vencido: la hora de cierre ya pasó aunque siga "abierta".
insert into public.callups (id, club_id, title, starts_at, closes_at, created_at)
values ('c1500000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000000', 'Vencida',
        now() + interval '2 hours', now() - interval '1 minute', now() - interval '1 day');
select pg_temp.expect_error($$
  select public.respond_callup('c1000000-0000-0000-0000-000000000000', 'c1500000-0000-0000-0000-000000000000',
    'c1300000-0000-0000-0000-000000000002', 'voy')
$$, 'P0001', 'pasada la hora de cierre ya no se puede responder');

select pg_temp.expect(
  not has_function_privilege('anon', 'public.respond_callup(uuid,uuid,uuid,public.callup_answer)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_callup(uuid,text,text,timestamptz,timestamptz,text)', 'execute')
  and has_function_privilege('service_role', 'public.close_callup(uuid,uuid,text)', 'execute'),
  'solo el servidor puede gestionar convocatorias');

rollback;
