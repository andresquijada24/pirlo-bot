-- PIRLO BOT · Fase 6.11: la página web del club se publica por defecto
--
-- Decisión del dueño: todo club aprobado aparece en el directorio (/clubes) y tiene su página
-- sin pasos manuales. Un admin del club puede retirarla cuando quiera con /club web activar: No.
-- Los clubes pendientes o rechazados nunca se muestran (lo filtran las consultas por estado).
-- No borra nada: cambia el valor por defecto y publica los clubes existentes.

alter table public.clubs alter column web_public set default true;
update public.clubs set web_public = true where not web_public;
