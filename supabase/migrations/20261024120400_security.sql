-- PIRLO BOT · Migración 5: seguridad
--
-- Modelo:
--   * El bot accede solo desde el servidor con la clave de servicio (rol service_role).
--   * Las claves públicas (anon / authenticated) NO tienen acceso a nada en la v1.
--   * RLS activado en todas las tablas sin políticas = denegación por defecto.
--     Cuando exista el panel web se añadirán políticas explícitas por club.

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    -- ENABLE (no FORCE): el rol postgres del panel de Supabase sigue viendo los datos.
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end;
$$;

-- Quitar los permisos que Supabase concede por defecto a los roles públicos.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- Y para las tablas, secuencias y funciones que se creen en el futuro.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- El servidor (service_role) mantiene acceso completo.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
