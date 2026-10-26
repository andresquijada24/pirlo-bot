-- PIRLO BOT · Fase 6.9: directorio de clubes con página pública (/clubes)
-- Devuelve solo los clubes activos que un admin publicó con /club web, sin datos internos
-- (identificador, nombre y si tienen escudo). Solo añade una función.

create function public.list_public_clubs()
returns table (slug text, name text, has_crest boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.slug, c.name, c.crest_png is not null
    from public.clubs c
   where c.web_public and c.status = 'activo'
   order by lower(c.name)
   limit 500;
$$;

revoke execute on function public.list_public_clubs() from public, anon, authenticated;
grant execute on function public.list_public_clubs() to service_role;
