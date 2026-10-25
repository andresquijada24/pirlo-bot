-- Pruebas de recordatorios (fase 7.3). Datos ficticios; todo se deshace al final.
begin;

insert into public.guilds (id, name) values ('920000000000000001', 'Pruebas');
insert into public.clubs (id, slug, name) values ('e1000000-0000-0000-0000-000000000000', 'club-r', 'Club R');
insert into public.club_guilds (club_id, guild_id, is_primary) values ('e1000000-0000-0000-0000-000000000000', '920000000000000001', true);
insert into public.club_channels (club_id, guild_id, purpose, channel_id) values
  ('e1000000-0000-0000-0000-000000000000', '920000000000000001', 'convocatorias', '930000000000000001');
insert into public.callups (id, club_id, title, starts_at) values
  ('e1500000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000000', 'Pronto', now() + interval '30 minutes'),
  ('e1500000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000000', 'Lejos', now() + interval '2 days');

select pg_temp.expect(
  (select count(*) = 0 from public.due_callup_reminders(10)),
  'desactivado por defecto: no hay recordatorios pendientes');
select pg_temp.expect_error($$
  update public.clubs set reminder_minutes = 5 where slug = 'club-r'
$$, '23514', 'menos de 15 minutos de antelación se rechaza');

update public.clubs set reminder_minutes = 60 where slug = 'club-r';
select pg_temp.expect(
  (select count(*) = 1 and min(channel_id) = '930000000000000001' from public.due_callup_reminders(10)),
  'activado: solo la convocatoria dentro de la ventana, en el canal de convocatorias');

insert into public.club_channels (club_id, guild_id, purpose, channel_id) values
  ('e1000000-0000-0000-0000-000000000000', '920000000000000001', 'recordatorios', '930000000000000002');
select pg_temp.expect(
  (select min(channel_id) = '930000000000000002' from public.due_callup_reminders(10)),
  'si hay canal de recordatorios, se usa ese');

select pg_temp.expect(
  public.claim_callup_reminder('e1000000-0000-0000-0000-000000000000', 'e1500000-0000-0000-0000-000000000001')
  and not public.claim_callup_reminder('e1000000-0000-0000-0000-000000000000', 'e1500000-0000-0000-0000-000000000001'),
  'un recordatorio solo se reclama una vez');
select pg_temp.expect(
  (select count(*) = 0 from public.due_callup_reminders(10)),
  'una convocatoria recordada ya no vuelve a salir');

update public.callups set reminded_at = null, status = 'cerrada' where id = 'e1500000-0000-0000-0000-000000000001';
select pg_temp.expect(
  (select count(*) = 0 from public.due_callup_reminders(10)),
  'una convocatoria cerrada no se recuerda');

select pg_temp.expect(
  not has_function_privilege('anon', 'public.due_callup_reminders(integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_callup_reminder(uuid,uuid)', 'execute'),
  'solo el servidor gestiona los recordatorios');

rollback;
