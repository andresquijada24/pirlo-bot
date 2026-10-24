#!/usr/bin/env bash
# Bloquea migraciones que destruyen datos AL APLICARSE: borrar tablas, columnas, esquemas o filas.
# - Quitar una restricción (p. ej. "drop not null") no destruye datos y se permite.
# - El cuerpo de las funciones ($$ ... $$) se ignora: es lógica que se ejecuta después, con sus
#   propias pruebas (p. ej. reflejar un borrado del proveedor), no algo que la migración haga.
set -euo pipefail
pattern='\bdrop[[:space:]]+(table|column|schema|database|view|materialized)\b|\btruncate\b|\bdelete[[:space:]]+from\b'
status=0
for f in "${@:-supabase/migrations/*.sql}"; do
  for file in $f; do
    out=$(awk '
      { line = $0; n = gsub(/\$\$/, "&", line) }
      !inside { sub(/--.*/, "", line); print FILENAME ":" FNR ": " line }
      n % 2 == 1 { inside = !inside }
    ' "$file" | grep -iE "$pattern" || true)
    if [ -n "$out" ]; then echo "$out"; status=1; fi
  done
done
if [ "$status" -ne 0 ]; then
  echo "Migración destructiva detectada: requiere aprobación explícita."
fi
exit "$status"
