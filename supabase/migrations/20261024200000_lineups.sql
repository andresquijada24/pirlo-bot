-- PIRLO BOT · Fase 7.2: alineaciones
--
-- Una alineación pertenece a una convocatoria (como mucho una por convocatoria). La formación
-- define los 11 huecos titulares con su posición; los suplentes ocupan los huecos 12 a 23.
-- Funciones atómicas, solo para el servidor del bot. Solo añade objetos.
--
-- lineup_remove y create_lineup(reemplazar) quitan jugadores o un borrador de alineación al
-- ejecutarse por orden de un DT: es su función, no algo que haga la migración.

create unique index lineups_one_per_callup on public.lineups (club_id, callup_id) where callup_id is not null;

-- Crea la alineación de una convocatoria con sus 11 huecos titulares vacíos.
-- p_replace = true sustituye la que hubiera (queda copia en la auditoría).
create function public.create_lineup(
  p_club_id uuid,
  p_callup_id uuid,
  p_formation text,
  p_positions public.position_code[],
  p_replace boolean,
  p_actor_discord_id text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old uuid;
  v_lineup uuid;
  v_player uuid;
begin
  if coalesce(array_length(p_positions, 1), 0) <> 11 then
    raise exception 'Una formación necesita 11 posiciones.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.callups where club_id = p_club_id and id = p_callup_id) then
    raise exception 'Convocatoria no encontrada' using errcode = 'P0002';
  end if;

  select id into v_old from public.lineups where club_id = p_club_id and callup_id = p_callup_id;
  if v_old is not null then
    if not p_replace then
      raise exception 'Esta convocatoria ya tiene alineación. Usa reemplazar: Sí para empezar otra.' using errcode = 'P0001';
    end if;
    insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
    select p_club_id, p_actor_discord_id, 'lineup.replace', 'lineup', l.id::text,
           jsonb_build_object('lineup', to_jsonb(l),
             'slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.slot) from public.lineup_slots s
                                 where s.club_id = p_club_id and s.lineup_id = l.id), '[]'::jsonb))
      from public.lineups l where l.club_id = p_club_id and l.id = v_old;
    delete from public.lineups where club_id = p_club_id and id = v_old;
  end if;

  select p.id into v_player
    from public.players p
    join public.club_memberships m on m.player_id = p.id and m.club_id = p_club_id and m.left_at is null
   where p.discord_user_id = p_actor_discord_id;

  insert into public.lineups (club_id, callup_id, formation, created_by)
  values (p_club_id, p_callup_id, p_formation, v_player)
  returning id into v_lineup;

  insert into public.lineup_slots (lineup_id, club_id, slot, position, is_substitute)
  select v_lineup, p_club_id, i::smallint, p_positions[i], false
    from generate_series(1, 11) as i;

  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id, details)
  values (p_club_id, p_actor_discord_id, 'lineup.create', 'lineup', v_lineup::text,
          jsonb_build_object('callup_id', p_callup_id, 'formation', p_formation));
  return v_lineup;
end;
$$;

-- Coloca a un jugador como titular en la posición indicada (primer hueco libre de esa posición)
-- o como suplente. Si ya estaba en la alineación, se mueve. Devuelve el número de hueco.
create function public.lineup_assign(
  p_club_id uuid,
  p_lineup_id uuid,
  p_player_id uuid,
  p_position public.position_code,
  p_substitute boolean
) returns smallint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot smallint;
begin
  perform 1 from public.lineups where club_id = p_club_id and id = p_lineup_id for update;
  if not found then
    raise exception 'Alineación no encontrada' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.club_memberships
     where club_id = p_club_id and player_id = p_player_id and left_at is null
  ) then
    raise exception 'Ese jugador no forma parte de la plantilla.' using errcode = 'P0001';
  end if;

  -- Si ya estaba, se libera su hueco: el titular deja la posición vacía; el suplente se retira.
  update public.lineup_slots set player_id = null
   where club_id = p_club_id and lineup_id = p_lineup_id and player_id = p_player_id and not is_substitute;
  delete from public.lineup_slots
   where club_id = p_club_id and lineup_id = p_lineup_id and player_id = p_player_id and is_substitute;

  if p_substitute then
    select min(n)::smallint into v_slot
      from generate_series(12, 23) as n
     where not exists (select 1 from public.lineup_slots s
                        where s.club_id = p_club_id and s.lineup_id = p_lineup_id and s.slot = n);
    if v_slot is null then
      raise exception 'El banquillo está lleno (12 suplentes).' using errcode = 'P0001';
    end if;
    insert into public.lineup_slots (lineup_id, club_id, slot, position, player_id, is_substitute)
    values (p_lineup_id, p_club_id, v_slot, null, p_player_id, true);
    return v_slot;
  end if;

  if p_position is null then
    raise exception 'Indica la posición del titular.' using errcode = 'P0001';
  end if;
  select slot into v_slot from public.lineup_slots
   where club_id = p_club_id and lineup_id = p_lineup_id and not is_substitute
     and position = p_position and player_id is null
   order by slot limit 1;
  if v_slot is null then
    if exists (select 1 from public.lineup_slots
                where club_id = p_club_id and lineup_id = p_lineup_id and not is_substitute and position = p_position) then
      raise exception 'Todas las posiciones % ya están ocupadas. Quita antes a alguien.', p_position using errcode = 'P0001';
    end if;
    raise exception 'La formación no tiene la posición %.', p_position using errcode = 'P0001';
  end if;
  update public.lineup_slots set player_id = p_player_id
   where club_id = p_club_id and lineup_id = p_lineup_id and slot = v_slot;
  return v_slot;
end;
$$;

-- Quita a un jugador de la alineación. Devuelve false si no estaba.
create function public.lineup_remove(p_club_id uuid, p_lineup_id uuid, p_player_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
  m integer;
begin
  update public.lineup_slots set player_id = null
   where club_id = p_club_id and lineup_id = p_lineup_id and player_id = p_player_id and not is_substitute;
  get diagnostics n = row_count;
  delete from public.lineup_slots
   where club_id = p_club_id and lineup_id = p_lineup_id and player_id = p_player_id and is_substitute;
  get diagnostics m = row_count;
  return n + m > 0;
end;
$$;

create function public.publish_lineup(p_club_id uuid, p_lineup_id uuid, p_actor_discord_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.lineups set status = 'publicada', published_at = now()
   where club_id = p_club_id and id = p_lineup_id;
  if not found then
    raise exception 'Alineación no encontrada' using errcode = 'P0002';
  end if;
  insert into public.audit_log (club_id, actor_discord_id, action, entity, entity_id)
  values (p_club_id, p_actor_discord_id, 'lineup.publish', 'lineup', p_lineup_id::text);
end;
$$;

revoke execute on function public.create_lineup(uuid, uuid, text, public.position_code[], boolean, text) from public, anon, authenticated;
revoke execute on function public.lineup_assign(uuid, uuid, uuid, public.position_code, boolean) from public, anon, authenticated;
revoke execute on function public.lineup_remove(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.publish_lineup(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_lineup(uuid, uuid, text, public.position_code[], boolean, text) to service_role;
grant execute on function public.lineup_assign(uuid, uuid, uuid, public.position_code, boolean) to service_role;
grant execute on function public.lineup_remove(uuid, uuid, uuid) to service_role;
grant execute on function public.publish_lineup(uuid, uuid, text) to service_role;
