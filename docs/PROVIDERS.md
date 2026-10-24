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
| `maritimo` | API `api_v1` de solo lectura de maritimo.app | Sesión | Conector listo y probado contra el contrato. **Pendiente**: que maritimo.app publique `api_v1`. |
| `ourproclub` | Resúmenes de OurProClub | Sesión | Fase 6. Leerlos directamente de Discord requeriría permisos que hoy la regla 10 no permite. |
| `ea` | — | — | Stub. EA rechaza las consultas desde servidores. |
| `manual` | Registro por DT/capitán desde Discord | Partido | Fase 7. |

## MARÍTIMO CF

- Contrato: [`docs/integrations/maritimo-api-v1.md`](integrations/maritimo-api-v1.md).
- Conector: `src/providers/maritimo/` (`MaritimoStatsProvider`).
- Variables: `MARITIMO_API_BASE_URL`, `MARITIMO_API_KEY` (clave de solo lectura emitida por
  maritimo.app; solo en Vercel).
- Datos que Marítimo **no** tiene y PIRLO BOT muestra como "sin dato": estadísticas por partido
  individual, porterías imbatidas y temporadas (en PIRLO BOT cada club define las suyas y las
  sesiones se asignan por fecha).
- Sesiones duplicadas (`duplicada_de`): se guardan marcadas (`sessions.is_duplicate`) y no
  cuentan en los totales.
- Jugadores sin vincular: sus estadísticas se guardan con el id del proveedor
  (`player_session_stats.source_player_id`) y pasan al jugador de PIRLO BOT al vincularlo.
