-- Utilidades de prueba. Se crean en pg_temp: desaparecen al cerrar la sesión.

-- Falla si la sentencia NO lanza el error esperado.
create function pg_temp.expect_error(stmt text, expected_state text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> expected_state then
      raise exception 'FALLO [%]: se esperaba SQLSTATE % y llegó % (%)', label, expected_state, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - %', label;
    return;
  end;
  raise exception 'FALLO [%]: la sentencia debía fallar y no falló', label;
end;
$$;

-- Falla si la condición no es verdadera.
create function pg_temp.expect(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FALLO [%]', label;
  end if;
  raise notice 'ok - %', label;
end;
$$;
