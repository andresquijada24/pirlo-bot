# Proveedores de estadísticas

Todos implementan el contrato `StatsProvider` de `src/providers/types.ts`.

## Principios

- Cada proveedor **declara sus capacidades** (`ProviderCapabilities`): granularidad (partido o
  sesión), qué métricas ofrece y si informa borrados. El bot oculta o marca como "sin dato" lo
  que un proveedor no ofrece.
- Dato no ofrecido = `null`. Nunca se rellena con `0` ni se estima.
- Sincronización **incremental**: "lo que cambió desde <fecha>". El proveedor devuelve la hora de
  su servidor, que será el punto de partida de la siguiente sincronización.
- Las respuestas se **validan** (zod). Un formato inesperado detiene la sincronización en vez de
  guardar datos dudosos.
- Los secretos de cada proveedor viven en variables de entorno y nunca aparecen en errores ni
  logs.

## Estado

| Proveedor | Acceso | Granularidad | Estado |
| --- | --- | --- | --- |
| `maritimo` | API `api_v1` de solo lectura de maritimo.app | Sesión | Conector y sincronización listos y probados contra el contrato. **Pendiente**: que maritimo.app publique `api_v1`. |
| `ourproclub` | Resúmenes de OurProClub | Sesión | Fase 6. Leerlos directamente de Discord requeriría permisos que hoy la regla 10 no permite. |
| `ea` | Pendiente de una fuente autorizada por EA | Partido | Consentimiento por club (`/club ea`) y procesamiento listos. **No se lee nada de EA**: EA no ofrece una API pública de Clubs y bloquea el acceso automático; se pidió acceso oficial en su foro. |
| `manual` | Registro por DT/capitán desde Discord | Partido | Fase 7. |

## MARÍTIMO CF

- Contrato: [`docs/integrations/maritimo-api-v1.md`](integrations/maritimo-api-v1.md).
- Conector: `src/providers/maritimo/` (`MaritimoStatsProvider`).
- Variables (solo en Vercel): `MARITIMO_API_BASE_URL`, `MARITIMO_API_KEY` (clave de solo
  lectura emitida por maritimo.app) y `MARITIMO_CLUB_ID` (uuid del club de PIRLO BOT que recibe
  los datos; se ve con `/club sincronizacion`). El club debe tener `stats_provider = 'maritimo'`:
  si no coincide, la sincronización se omite (aislamiento).
- Datos que Marítimo **no** tiene y PIRLO BOT muestra como "sin dato": estadísticas por partido
  individual, porterías imbatidas y temporadas (en PIRLO BOT cada club define las suyas y las
  sesiones se asignan por fecha).
- Sesiones duplicadas (`duplicada_de`): se guardan marcadas (`sessions.is_duplicate`) y no
  cuentan en los totales.
- Jugadores sin vincular: sus estadísticas se guardan con el id del proveedor
  (`player_session_stats.source_player_id`) y pasan al jugador de PIRLO BOT al vincularlo.

### Sincronización

- `src/sync/engine.ts` descarga lo cambiado desde el último cursor (jugadores, sesiones y
  borrados) y lo aplica con funciones atómicas e idempotentes de la base de datos
  (`sync_apply_players`, `sync_apply_session`, `sync_apply_deletion`). Repetir una pasada no
  duplica nada; una sesión con la misma versión se salta.
- Cursor: la hora de servidor más antigua de las descargas. Si se agota el tiempo (45 s), se
  guarda la versión de la última sesión aplicada y la siguiente pasada continúa desde ahí.
- Correcciones en origen: se aplican y quedan en `stat_revisions` con el motivo
  "sincronización maritimo". Una sesión borrada en origen se elimina, con copia completa en
  `audit_log` (`sync.session_deleted`). Un jugador borrado queda inactivo.
- Temporada de cada sesión: la temporada cuyo rango de fechas la incluye o, si las temporadas no
  tienen fechas, la más reciente creada en o antes del día de juego. Las sesiones anteriores a la
  primera temporada quedan sin temporada y cuentan en el historial (`temporada: Todas`).
- Disparo: `POST /api/cron/sync` con `Authorization: Bearer <CRON_SECRET>`, que llama el
  workflow **Sincronizar Marítimo** cada 15 minutos (o a mano). Sin el secreto `CRON_SECRET` en
  GitHub, el workflow no hace nada.

### Vinculación de jugadores

- Al aprobar `/vincular`, el gamertag de la solicitud se vincula solo con la ficha de Marítimo
  del mismo gamertag (sin distinguir mayúsculas), si no pertenece ya a otro jugador.
- Un DT o admin puede vincularlo después con `/plantilla gamertag`. Las estadísticas ya
  importadas pasan al jugador en ese momento, y las nuevas llegan asignadas.
- Un gamertag nunca se reasigna en silencio: si ya pertenece a otro jugador del club, se rechaza.

## EA SPORTS (Pro Clubs)

- **Regla**: PIRLO no esquiva protecciones de EA. Solo procesará partidos que lleguen por una vía
  autorizada por EA. Hasta entonces la captura está parada (el puente `bridge/` está apagado: EA
  responde 403 a las peticiones automáticas).
- **Consentimiento por club**: un admin vincula su club de EA con `/club ea vincular` (tabla
  `club_ea_links`, versión de consentimiento `v1`, auditado). Un club de EA pertenece a un único
  club de PIRLO. `/club ea retirar` detiene el procesamiento y conserva lo ya procesado.
- **Importación manual** (`/club ea importar`, DT o admin): la persona abre en su navegador la
  página de partidos de su club en EA, la guarda y la adjunta. PIRLO la descarga solo del CDN de
  Discord (máx. 2 MB), acepta únicamente partidos del club de EA vinculado y los procesa al momento
  (lo que no quepa en ~1 s lo procesa la tarea programada). EA solo muestra los 5 últimos partidos
  de cada tipo, así que conviene importar después de cada sesión.
- **Captura**: `POST /api/ingest/ea` solo guarda partidos de clubes de EA con consentimiento
  (403 en otro caso) en `ea_match_cache`.
- **Procesamiento**: la tarea programada (`/api/cron/tick`) convierte la caché en `ea_matches` y
  `ea_match_players` de cada club (`src/providers/ea/matches.ts`). Datos ausentes = `NULL`.
- **Estadísticas**: `v_ea_player_season_stats` convierte los partidos procesados (solo el lado
  propio) en filas como las de las sesiones, así que `/stats` y `/ranking` suman EA y los demás
  proveedores. El jugador se reconoce por el gamertag de su ficha en ese club (`/plantilla
  gamertag`); sin coincidencia aparece con su gamertag de EA. Temporada = fecha local del partido.
- **Rivales**: nombre, marcador, gamertags y estadísticas se guardan solo dentro del club que jugó
  el partido; nunca entran en rankings ni estadísticas de la plantilla, y sus gamertags no se
  muestran en páginas públicas.
