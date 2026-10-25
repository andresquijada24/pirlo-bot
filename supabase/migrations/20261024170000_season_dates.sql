-- Fechas de una temporada (inicio y fin opcional) y reasignación de sus sesiones.
--
-- Hasta ahora /temporada crear solo guardaba el nombre: una temporada sin fecha de inicio cuenta
-- solo las sesiones jugadas desde el día en que se creó (public.season_for_date). Con esta función
-- un admin le pone fechas y TODAS las sesiones del club se vuelven a asignar según
-- public.season_for_date, así que lo jugado desde el inicio pasa a contar en esa temporada.
--
-- Solo cambia seasons.starts_on/ends_on y sessions.season_id. No borra nada ni toca estadísticas.

create function public.set_season_dates(
  p_club_id uuid,
  p_season_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_actor_discord_id text
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_moved integer;
begin
  if p_starts_on is null then
    raise exception 'La fecha de inicio es obligatoria.' using errcode = 'P0001';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'La fecha de fin no puede ser anterior a la de inicio.' using errcode = 'P0001';
  end if;

  select name into v_name from public.seasons where club_id = p_club_id and id = p_season_id;
  if not found then
    raise exception 'Temporada no encontrada' using errcode = 'P0002';
  end if;

  -- Dos temporadas con fechas no pueden solaparse: cada sesión debe tener una sola temporada.
  if exists (
    select 1 from public.seasons s
     where s.club_id = p_club_id and s.id <> p_season_id and s.starts_on is not null
       and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
  ) then
    raise exception 'Esas fechas se cruzan con otra temporada del club.' using errcode = 'P0001';
  end if;

  update public.seasons set starts_on = p_starts_on, ends_on = p_ends_on
   where club_id = p_club_id and id = p_season_id;

  -- Reasigna cada sesión del club a la temporada que le corresponde por su fecha.
  with nueva as (
    select s.id, public.season_for_date(p_club_id, s.played_on) as season_id
      from public.sessions s where s.club_id = p_club_id
  )
  update public.sessions s set season_id = nueva.season_id
    from nueva
   where s.id = nueva.id and s.season_id is distinct from nueva.season_id;
  get diagnostics v_moved = row_count;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'season.dates', 'season', p_season_id::text,
          jsonb_build_object('nombre', v_name, 'inicio', p_starts_on, 'fin', p_ends_on, 'sesiones_reasignadas', v_moved));

  return v_moved;
end;
$$;

-- Solo el servidor del bot puede ejecutarla.
revoke execute on function public.set_season_dates(uuid, uuid, date, date, text) from public, anon, authenticated;
grant execute on function public.set_season_dates(uuid, uuid, date, date, text) to service_role;
