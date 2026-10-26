-- Pruebas del directorio de clubes públicos. Datos ficticios; todo se deshace al final.
begin;

insert into public.clubs (id, slug, name, web_public, crest_png) values
  ('a1000000-0000-0000-0000-000000000001', 'club-pub', 'B Público', true, 'iVBORw0KGgo='),
  ('a1000000-0000-0000-0000-000000000002', 'club-priv', 'Privado', false, null),
  ('a1000000-0000-0000-0000-000000000003', 'club-pub2', 'A Público', true, null);

select pg_temp.expect(
  (select array_agg(slug) = array['club-pub2', 'club-pub'] from public.list_public_clubs() where slug like 'club-pub%' or slug = 'club-priv'),
  'solo los clubes con la página publicada, por nombre');
select pg_temp.expect(
  (select has_crest from public.list_public_clubs() where slug = 'club-pub')
  and not (select has_crest from public.list_public_clubs() where slug = 'club-pub2'),
  'indica si tienen escudo sin devolver la imagen');

rollback;
