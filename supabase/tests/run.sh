#!/usr/bin/env bash
# Ejecuta las pruebas SQL contra una base de datos con las migraciones ya aplicadas.
# Cada archivo corre en su propia sesión, con las utilidades de 00_helpers.sql, y revierte
# todos sus datos al terminar.
#
#   DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres supabase/tests/run.sh
set -uo pipefail

: "${DB_URL:?Define DB_URL con la conexión a la base de datos de PRUEBA}"
dir="$(cd "$(dirname "$0")" && pwd)"
failed=0

for test in "$dir"/[1-9]*.sql; do
  echo "== $(basename "$test")"
  out="$(cat "$dir/00_helpers.sql" "$test" | psql "$DB_URL" -q -X -v ON_ERROR_STOP=1 2>&1)"
  status=$?
  echo "$out" | sed -n 's/^.*NOTICE:  /  /p; s/^.*ERROR:  /  ERROR: /p'
  if [ "$status" -ne 0 ]; then failed=1; fi
done

if [ "$failed" -ne 0 ]; then
  echo "Pruebas SQL: FALLO"
  exit 1
fi
echo "Pruebas SQL: OK"
