-- Pruebas de la caché de partidos de EA. Datos ficticios; todo se deshace al final.
begin;

insert into public.ea_match_cache (platform, ea_club_id, match_id, match_type, played_at, payload)
values ('common-gen5', '12345', '900001', 'leagueMatch', now(), '{"matchId":"900001"}');
select pg_temp.expect_error($$
  insert into public.ea_match_cache (platform, ea_club_id, match_id, match_type, played_at, payload)
  values ('common-gen5', '12345', '900001', 'leagueMatch', now(), '{}')
$$, '23505', 'un partido no se guarda dos veces');
select pg_temp.expect_error($$
  insert into public.ea_match_cache (platform, ea_club_id, match_id, match_type, played_at, payload)
  values ('pc', '12345', '900002', 'leagueMatch', now(), '{}')
$$, '23514', 'solo plataformas conocidas');
select pg_temp.expect(
  not has_table_privilege('anon', 'public.ea_match_cache', 'select')
  and has_table_privilege('service_role', 'public.ea_match_cache', 'insert'),
  'solo el servidor accede a la caché de EA');

rollback;
