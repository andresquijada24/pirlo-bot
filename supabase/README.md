# Supabase — PIRLO BOT

Base de datos **exclusiva** de PIRLO BOT (proyecto `PIRLO-BOT`, us-east-1). No comparte nada con
MARÍTIMO CF.

## Contenido

| Ruta | Qué es |
| --- | --- |
| `migrations/` | SQL versionado. Nunca se editan migraciones ya aplicadas: se crea una nueva. |
| `tests/` | Pruebas SQL. Cada archivo corre en una transacción que se revierte. |
| `tests/bootstrap_roles.sql` | Crea los roles de Supabase en un Postgres vacío. Solo para pruebas. |
| `config.toml` | Configuración mínima de la CLI. |

## Migraciones actuales

1. `core` — clubes, servidores, canales, jugadores, membresías, temporadas, sesiones, partidos,
   estadísticas por partido.
2. `management` — calendario, convocatorias y respuestas, alineaciones, publicaciones programadas.
3. `integrity` — referencias externas, ejecuciones de sincronización, historial de correcciones
   (automático), auditoría.
4. `stats_views` — estadísticas por temporada y carrera, balance del club, récords por partido.
5. `security` — RLS activado en todas las tablas y sin acceso para las claves públicas.

## Pruebas

En CI se aplican todas las migraciones a un Postgres 17 vacío y se ejecuta `tests/run.sh`.
En local, con una base de pruebas:

```bash
psql "$DB_URL" -f supabase/tests/bootstrap_roles.sql
for f in supabase/migrations/*.sql; do psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
DB_URL=... supabase/tests/run.sh
```

## Aplicar al proyecto real

Solo desde GitHub Actions → **Aplicar migraciones** → Run workflow (rama `main`):

- `simulacion` (por defecto): muestra qué migraciones se aplicarían, sin tocar nada.
- `aplicar`: las ejecuta.

Requiere el secreto `SUPABASE_DB_URL` en el repositorio. Las migraciones destructivas (DROP,
TRUNCATE) bloquean la CI y requieren aprobación explícita.
