-- Resumen de sesión: cada sesión se reserva una sola vez. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name, stats_provider) values
  ('ad000000-0000-0000-0000-000000000001', 'club-resumen', 'Club Resumen', 'maritimo'),
  ('ad000000-0000-0000-0000-000000000002', 'club-ajeno', 'Club Ajeno', 'maritimo');
insert into public.sessions (id, club_id, played_on, source, external_id, matches_played, published_at, is_duplicate) values
  ('ad100000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000001', '2026-10-26', 'maritimo', 'r1', 5, now() - interval '2 hours', false),
  ('ad100000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000001', '2026-10-26', 'maritimo', 'r2', 5, now() - interval '1 hour', true),
  ('ad100000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-000000000002', '2026-10-26', 'maritimo', 'r3', 5, now(), false);

select pg_temp.expect(
  (select array_agg(x) from public.claim_session_recaps('ad000000-0000-0000-0000-000000000001', 5) x)
    = array['ad100000-0000-0000-0000-000000000001'::uuid],
  'reserva solo las sesiones de su club, sin las duplicadas');
select pg_temp.expect(
  not exists (select 1 from public.claim_session_recaps('ad000000-0000-0000-0000-000000000001', 5)),
  'una sesión ya reservada no se vuelve a anunciar');
select public.release_session_recaps('ad000000-0000-0000-0000-000000000001', array['ad100000-0000-0000-0000-000000000001'::uuid]);
select pg_temp.expect(
  (select count(*) from public.claim_session_recaps('ad000000-0000-0000-0000-000000000001', 5)) = 1,
  'tras un error temporal se puede volver a reservar');
select pg_temp.expect(
  (select recap_posted_at is null from public.sessions where id = 'ad100000-0000-0000-0000-000000000003'),
  'el otro club no se toca');

rollback;
