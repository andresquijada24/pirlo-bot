-- Pruebas de la aprobación de clubes. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name) values ('ae000000-0000-0000-0000-000000000001', 'club-aprob', 'Club Aprob');

select pg_temp.expect(
  (select status = 'activo' from public.clubs where id = 'ae000000-0000-0000-0000-000000000001'),
  'los clubes existentes siguen activos por defecto');
select public.set_club_status('ae000000-0000-0000-0000-000000000001', 'pendiente', '780000000000000009');
select pg_temp.expect(
  (select status = 'pendiente' from public.clubs where id = 'ae000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.audit_log where club_id = 'ae000000-0000-0000-0000-000000000001' and action = 'club.status'),
  'queda pendiente y auditado');
select public.set_club_status('ae000000-0000-0000-0000-000000000001', 'activo', '780000000000000009');
select pg_temp.expect(
  (select status = 'activo' from public.clubs where id = 'ae000000-0000-0000-0000-000000000001'),
  'aprobado: activo');
select pg_temp.expect_error($$
  select public.set_club_status('ae000000-0000-0000-0000-00000000ffff', 'activo', '780000000000000009')
$$, 'P0002', 'club inexistente');
select pg_temp.expect(
  not has_function_privilege('anon', 'public.set_club_status(uuid, public.club_status, text)', 'execute'),
  'anon no puede cambiar estados');

rollback;
