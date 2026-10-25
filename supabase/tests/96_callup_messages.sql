-- Pruebas de mensajes de convocatoria y cancelación. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values
  ('f1000000-0000-0000-0000-000000000000', 'club-s', 'Club S'),
  ('f2000000-0000-0000-0000-000000000000', 'club-t', 'Club T');
insert into public.callups (id, club_id, title, starts_at) values
  ('f1500000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000000', 'J1', now() + interval '1 day');

insert into public.callup_messages (club_id, callup_id, channel_id, message_id) values
  ('f1000000-0000-0000-0000-000000000000', 'f1500000-0000-0000-0000-000000000001', '930000000000000001', '940000000000000001');
select pg_temp.expect_error($$
  insert into public.callup_messages (club_id, callup_id, channel_id, message_id) values
    ('f2000000-0000-0000-0000-000000000000', 'f1500000-0000-0000-0000-000000000001', '930000000000000001', '940000000000000002')
$$, '23503', 'un mensaje no puede apuntar a la convocatoria de otro club');

select public.cancel_callup('f1000000-0000-0000-0000-000000000000', 'f1500000-0000-0000-0000-000000000001', '700000000000000001');
select pg_temp.expect(
  (select status = 'cancelada' from public.callups where id = 'f1500000-0000-0000-0000-000000000001')
  and exists (select 1 from public.audit_log where action = 'callup.cancel'),
  'cancelar deja la convocatoria cancelada y queda en la auditoría');
select pg_temp.expect_error($$
  select public.cancel_callup('f1000000-0000-0000-0000-000000000000', 'f1500000-0000-0000-0000-000000000001', '700000000000000001')
$$, 'P0001', 'no se cancela dos veces');
select pg_temp.expect_error($$
  select public.cancel_callup('f2000000-0000-0000-0000-000000000000', 'f1500000-0000-0000-0000-000000000001', '700000000000000001')
$$, 'P0002', 'no se cancela desde otro club');

select pg_temp.expect(
  not has_table_privilege('anon', 'public.callup_messages', 'select')
  and not has_function_privilege('authenticated', 'public.cancel_callup(uuid,uuid,text)', 'execute'),
  'solo el servidor gestiona mensajes y cancelaciones');

rollback;
