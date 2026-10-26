-- PIRLO BOT · Fase 6.19: tarea «tick» cada minuto
--
-- Procesa los partidos de EA importados y publica su tarjeta como mucho ~1 minuto después de la
-- importación (antes, hasta 5). También adelanta recordatorios. Solo cambia la frecuencia de la
-- tarea; no toca datos.

do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'Programador de Supabase no disponible: no hay tarea que cambiar.';
    return;
  end if;
  perform cron.alter_job(job_id := jobid, schedule := '* * * * *')
    from cron.job where jobname = 'pirlo-tick';
end;
$$;
