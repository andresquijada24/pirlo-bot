-- PIRLO BOT · Fase 6.18: sincronización con Marítimo cada minuto
--
-- La sesión llega a PIRLO como mucho 1 minuto después de que maritimo.app la tenga (antes, 5), y
-- se publica en Discord en la misma pasada. Si una consulta falla (p. ej. Marítimo responde 502),
-- la siguiente es al minuto. Solo cambia la frecuencia de la tarea; no toca datos.

do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'Programador de Supabase no disponible: no hay tarea que cambiar.';
    return;
  end if;
  perform cron.alter_job(job_id := jobid, schedule := '* * * * *')
    from cron.job where jobname = 'pirlo-sync';
end;
$$;
