# Proveedores de estadísticas

Todos implementan el contrato `StatsProvider` de `src/providers/types.ts`.

## Principios

- Cada proveedor **declara sus capacidades** (`ProviderCapabilities`). El bot oculta o marca como
  no disponible lo que un proveedor no ofrece.
- Dato no ofrecido = `null`. Nunca se rellena con `0` ni se estima.
- Sincronización **incremental** mediante un cursor opaco propio del proveedor.
- `sourceVersion` permite detectar correcciones en origen y registrarlas en `stat_revisions`.
- Los secretos de cada proveedor viven en variables de entorno o Supabase Vault.

## Estado

| Proveedor  | Acceso                                  | Estado                                                                            |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `maritimo` | API autenticada de solo lectura de maritimo.app | **Pendiente de confirmar** si la API existe. No se accede nunca a su base de datos. |
| `ourproclub` | Integración autorizada                | **Pendiente de confirmar** si ofrecen acceso autorizado.                          |
| `ea`       | Acceso verificable de EA                | Stub. EA no ofrece API pública oficial a la fecha.                                |
| `manual`   | Registro por DT / capitán desde Discord | Se implementa en la Fase 7.                                                       |

## Contrato esperado de la API de Marítimo (borrador)

Si maritimo.app no expone aún una API, este es el mínimo que necesitaría PIRLO BOT. Su
implementación corresponde al repositorio de Marítimo, en una tarea aparte y autorizada.

- Autenticación: cabecera `Authorization: Bearer <clave de solo lectura>`.
- `GET /players` — lista de jugadores con id estable.
- `GET /matches?since=<cursor>` — partidos con estadísticas por jugador, paginados, con
  `updated_at` o versión para detectar correcciones.
- `GET /seasons` y `GET /sessions` — si existen en origen.
