#!/usr/bin/env bash
# Bloquea migraciones que destruyen datos AL APLICARSE: borrar tablas, columnas, esquemas o filas.
# - Quitar una restricción (p. ej. "drop not null", "drop default", "drop constraint") se permite.
# - El cuerpo de las FUNCIONES ($$ … $$ tras "create function") se ignora: es lógica que se ejecuta
#   después, con sus propias pruebas. Los bloques "do $$ … $$" SÍ se revisan: se ejecutan al migrar.
set -euo pipefail
pattern='\bdrop[[:space:]]+(table|column|schema|database|view|materialized)\b|\btruncate\b|\bdelete[[:space:]]+from\b'
# "alter table x drop y" (sin la palabra column) también borra una columna.
alter_drop='\balter[[:space:]]+table\b.*\bdrop[[:space:]]+(if[[:space:]]+exists[[:space:]]+)?[a-z_"]+'
allowed_drop='\bdrop[[:space:]]+(not[[:space:]]+null|default|constraint|identity|expression)\b'
status=0
files=("$@")
[ ${#files[@]} -eq 0 ] && files=(supabase/migrations/*.sql)
for file in "${files[@]}"; do
  out=$(awk '
    { line = $0; low = tolower(line); n = gsub(/\$\$/, "&", line) }
    # Al abrir un bloque $$, se decide si es una función (se omite) o un bloque DO (se revisa).
    !inside && n % 2 == 1 { skipping = (low !~ /(^|[^a-z_])do[[:space:]]*\$\$/) && (infn || low ~ /function|procedure|returns|language|as[[:space:]]*\$\$/) }
    !inside || !skipping { l = $0; sub(/--.*/, "", l); print FILENAME ":" FNR ": " l }
    /create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?(function|procedure)/ { infn = 1 }
    n % 2 == 1 { inside = !inside; if (!inside) infn = 0 }
  ' "$file")
  hits=$( { printf '%s\n' "$out" | grep -iE "$pattern" || true;
            printf '%s\n' "$out" | grep -iE "$alter_drop" | grep -viE "$allowed_drop" | grep -viE '\bdrop[[:space:]]+(table|column|schema|database|view|materialized)\b' || true; } )
  if [ -n "$hits" ]; then echo "$hits"; status=1; fi
done
if [ "$status" -ne 0 ]; then
  echo "Migración destructiva detectada: requiere aprobación explícita."
fi
exit "$status"
