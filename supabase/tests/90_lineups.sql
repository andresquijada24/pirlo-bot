-- Pruebas de alineaciones (fase 7.2). Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values
  ('d1000000-0000-0000-0000-000000000000', 'club-l', 'Club L'),
  ('d2000000-0000-0000-0000-000000000000', 'club-m2', 'Club M2');
insert into public.players (id, display_name, discord_user_id) values
  ('d1300000-0000-0000-0000-000000000001', 'DT', '710000000000000001'),
  ('d1300000-0000-0000-0000-000000000002', 'Delantero', '710000000000000002'),
  ('d1300000-0000-0000-0000-000000000003', 'Otro', '710000000000000003'),
  ('d1300000-0000-0000-0000-000000000004', 'Ajeno', '710000000000000004');
insert into public.club_memberships (club_id, player_id, role) values
  ('d1000000-0000-0000-0000-000000000000', 'd1300000-0000-0000-0000-000000000001', 'dt'),
  ('d1000000-0000-0000-0000-000000000000', 'd1300000-0000-0000-0000-000000000002', 'jugador'),
  ('d1000000-0000-0000-0000-000000000000', 'd1300000-0000-0000-0000-000000000003', 'jugador'),
  ('d2000000-0000-0000-0000-000000000000', 'd1300000-0000-0000-0000-000000000004', 'jugador');
insert into public.callups (id, club_id, title, starts_at) values
  ('d1500000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000000', 'J1', now() + interval '1 day');

create temp table t (lineup uuid) on commit drop;
insert into t select public.create_lineup('d1000000-0000-0000-0000-000000000000', 'd1500000-0000-0000-0000-000000000001',
  '4-3-3', array['POR','LD','DFC','DFC','LI','MC','MCD','MC','ED','DC','EI']::public.position_code[], false, '710000000000000001');

select pg_temp.expect(
  (select count(*) = 11 and bool_and(player_id is null) from public.lineup_slots s, t where s.lineup_id = t.lineup),
  'crear la alineación deja 11 huecos titulares vacíos');
select pg_temp.expect_error($$
  select public.create_lineup('d1000000-0000-0000-0000-000000000000', 'd1500000-0000-0000-0000-000000000001',
    '4-4-2', array['POR','LD','DFC','DFC','LI','MD','MC','MC','MI','DC','DC']::public.position_code[], false, '710000000000000001')
$$, 'P0001', 'una convocatoria no tiene dos alineaciones salvo que se pida reemplazar');
select pg_temp.expect_error($$
  select public.create_lineup('d1000000-0000-0000-0000-000000000000', 'd1500000-0000-0000-0000-000000000001',
    '4-3-3', array['POR']::public.position_code[], true, '710000000000000001')
$$, 'P0001', 'una formación necesita 11 posiciones');

select pg_temp.expect(
  public.lineup_assign('d1000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000002', 'DC', false) = 10,
  'un jugador ocupa el hueco de su posición');
select pg_temp.expect(
  public.lineup_assign('d1000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000002', 'ED', false) = 9,
  'cambiar de posición lo mueve');
select pg_temp.expect(
  (select count(*) = 1 from public.lineup_slots s, t where s.lineup_id = t.lineup
     and s.player_id = 'd1300000-0000-0000-0000-000000000002'),
  'un jugador nunca está dos veces en la alineación');
select pg_temp.expect_error($$
  select public.lineup_assign('d1000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000003', 'ED', false)
$$, 'P0001', 'una posición ocupada no se pisa');
select pg_temp.expect_error($$
  select public.lineup_assign('d1000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000003', 'SD', false)
$$, 'P0001', 'una posición que no está en la formación se rechaza');

select pg_temp.expect(
  public.lineup_assign('d1000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000003', null, true) = 12,
  'los suplentes ocupan los huecos 12 en adelante');
select pg_temp.expect_error($$
  select public.lineup_assign('d1000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000004', 'DC', false)
$$, 'P0001', 'un jugador de otro club no entra en la alineación');
select pg_temp.expect_error($$
  select public.lineup_assign('d2000000-0000-0000-0000-000000000000', (select lineup from t),
    'd1300000-0000-0000-0000-000000000004', 'DC', false)
$$, 'P0002', 'una alineación no se encuentra desde otro club');

select pg_temp.expect(
  public.lineup_remove('d1000000-0000-0000-0000-000000000000', (select lineup from t), 'd1300000-0000-0000-0000-000000000003')
  and not public.lineup_remove('d1000000-0000-0000-0000-000000000000', (select lineup from t), 'd1300000-0000-0000-0000-000000000003'),
  'quitar a un jugador funciona una vez');

select public.publish_lineup('d1000000-0000-0000-0000-000000000000', (select lineup from t), '710000000000000001');
select pg_temp.expect(
  (select l.status = 'publicada' and l.published_at is not null from public.lineups l, t where l.id = t.lineup),
  'publicar marca la alineación como publicada');

select public.create_lineup('d1000000-0000-0000-0000-000000000000', 'd1500000-0000-0000-0000-000000000001',
  '4-4-2', array['POR','LD','DFC','DFC','LI','MD','MC','MC','MI','DC','DC']::public.position_code[], true, '710000000000000001');
select pg_temp.expect(
  (select formation = '4-4-2' from public.lineups where callup_id = 'd1500000-0000-0000-0000-000000000001')
  and exists (select 1 from public.audit_log where action = 'lineup.replace' and details -> 'slots' is not null),
  'reemplazar crea una nueva y deja copia de la anterior en la auditoría');

select pg_temp.expect(
  not has_function_privilege('anon', 'public.lineup_assign(uuid,uuid,uuid,public.position_code,boolean)', 'execute')
  and has_function_privilege('service_role', 'public.publish_lineup(uuid,uuid,text)', 'execute'),
  'solo el servidor puede gestionar alineaciones');

rollback;
