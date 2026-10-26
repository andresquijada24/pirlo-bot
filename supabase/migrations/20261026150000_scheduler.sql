-- PIRLO BOT · Fase 6.16: sincronización puntual cada 5 minutos con el programador de Supabase
--
-- Las tareas programadas de GitHub se retrasan (en la práctica corrían cada 2–3 horas). Supabase
-- tiene su propio programador (pg_cron) y peticiones HTTP desde la base de datos (pg_net):
-- - Cada 5 minutos llama a /api/cron/sync (Marítimo) y, desfasado 2 minutos, a /api/cron/tick
--   (recordatorios, EA, escudos). El workflow de GitHub queda como respaldo.
-- - La clave de esas llamadas se GENERA AQUÍ, se guarda cifrada en Supabase Vault y nunca sale de
--   la base de datos. PIRLO solo guarda su huella (SHA-256) en public.scheduler_keys para
--   comprobarla; no es CRON_SECRET ni ninguna otra clave existente.
-- Solo añade una tabla, extensiones y dos tareas; no borra ni modifica datos.

create table public.scheduler_keys (
  name text primary key check (name ~ '^[a-z_]{3,40}$'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.scheduler_keys enable row level security;
revoke all on public.scheduler_keys from anon, authenticated;
grant select on public.scheduler_keys to service_role;

-- En entornos sin pg_cron/pg_net/Vault (p. ej. las pruebas locales) solo se crea la tabla.
do $$
declare
  v_token text;
begin
  if to_regnamespace('vault') is null
     or not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'Programador de Supabase no disponible: se omiten las tareas.';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'pirlo_scheduler_token';
  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(v_token, 'pirlo_scheduler_token', 'Clave del programador de Supabase para /api/cron/*');
  end if;
  insert into public.scheduler_keys (name, token_hash)
  values ('supabase', encode(extensions.digest(v_token, 'sha256'), 'hex'))
  on conflict (name) do update set token_hash = excluded.token_hash;

  perform cron.schedule('pirlo-sync', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://pirlo-bot.vercel.app/api/cron/sync',
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                        where name = 'pirlo_scheduler_token'),
        'content-type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000)
  $job$);
  perform cron.schedule('pirlo-tick', '2-59/5 * * * *', $job$
    select net.http_post(
      url := 'https://pirlo-bot.vercel.app/api/cron/tick',
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                        where name = 'pirlo_scheduler_token'),
        'content-type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000)
  $job$);
end;
$$;
