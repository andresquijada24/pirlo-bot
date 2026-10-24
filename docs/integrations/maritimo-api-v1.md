# Contrato `api_v1` de MARÍTIMO CF (solo lectura)

Contrato entre **maritimo.app** (proveedor) y **PIRLO BOT** (consumidor). Lo implementa
maritimo.app en su propio proyecto; PIRLO BOT lo consume a través de `MaritimoStatsProvider`
(`src/providers/maritimo/`). Cualquier cambio de este contrato se versiona (`/v2`).

## Principios

- **Solo lectura**: únicamente `GET`. Ninguna ruta modifica datos.
- **Sin datos privados**: nunca se exponen `email`, `nombre`, `contacto`, `contacto_medio`,
  `dias`, `franja`, `zona_horaria`, `experiencia`, `motivo_rechazo`, `revisado_*`,
  `valor_mercado` ni nada equivalente.
- **Dato ausente = `null`**, nunca `0`. Un `0` significa "se midió y fue cero".
- **Identificadores estables**: los `id` no cambian nunca, aunque cambie el gamertag.
- **Sincronización incremental**: todo recurso trae `actualizado_at` y se puede pedir desde
  una fecha.

## Base y autenticación

- Base: `https://<ref-de-maritimo>.supabase.co/functions/v1/api_v1` (Edge Function de servidor
  a servidor, sin CORS).
- Cabecera obligatoria: `Authorization: Bearer <clave>`.
- Las claves se guardan **solo como hash** en maritimo.app, con nombre, alcances y fecha de
  revocación. La clave para PIRLO BOT tiene el alcance `lectura`.

| Código | Cuándo |
| --- | --- |
| `200` | Correcto |
| `400` | Parámetros inválidos. Cuerpo: `{ "error": "parametro_invalido", "detalle": "..." }` |
| `401` | Falta la clave o no existe |
| `403` | Clave revocada o sin alcance |
| `404` | Ruta o id inexistente |
| `429` | Demasiadas peticiones. Cabecera `Retry-After` en segundos |
| `5xx` | Error del servidor. El consumidor reintenta más tarde |

Los cuerpos de error nunca incluyen trazas, SQL ni datos internos.

## Paginación incremental (todas las listas)

Parámetros:

| Parámetro | Tipo | Defecto |
| --- | --- | --- |
| `updated_since` | ISO 8601 UTC (incluido) | desde el principio |
| `limit` | entero 1–200 | 100 |
| `cursor` | texto opaco devuelto por la página anterior | — |

- Orden estable: `actualizado_at` ascendente y, a igualdad, `id` ascendente.
- Respuesta:

```json
{ "data": [ ... ], "next_cursor": "opaco-o-null", "server_time": "2026-10-24T15:00:00Z" }
```

- El consumidor pide páginas hasta `next_cursor = null` y guarda el `server_time` de la
  **primera** página como próximo `updated_since`. Puede recibir repetidos: deduplica por `id`.

## `GET /estado`

Comprobación de conexión y clave.

```json
{ "version": "1", "club": { "nombre": "Marítimo CF" }, "server_time": "2026-10-24T15:00:00Z" }
```

## `GET /jugadores`

```json
{
  "id": "uuid",
  "gamertag": "texto",
  "plataforma": "ps | xbox | pc | null",
  "pos1": "texto | null",
  "posiciones": ["texto"],
  "dorsal": 10,
  "foto_url": "https://... | null",
  "estado": "activo | baja | pendiente | rechazado",
  "en_plantilla": true,
  "actualizado_at": "ISO 8601"
}
```

`GET /jugadores/{id}` devuelve un único objeto con la misma forma.

## `GET /sesiones`

Una sesión es un "Session Recap" de OurProClub: varios partidos seguidos.

```json
{
  "id": "msg_id de la sesión",
  "publicada_at": "ISO 8601",
  "fecha_juego": "AAAA-MM-DD",
  "partidos": 4,
  "victorias": 3,
  "empates": 0,
  "derrotas": 1,
  "duplicada_de": "msg_id | null",
  "actualizado_at": "ISO 8601",
  "jugadores": [
    {
      "jugador_id": "uuid | null",
      "gamertag": "texto tal como lo publica OurProClub",
      "partidos_jugados": 4,
      "nota": 7.4,
      "goles": 3,
      "asistencias": 1,
      "goles_manuales": 1,
      "asistencias_manuales": 0,
      "tiros": 6,
      "regates": 4,
      "pases_ok": 52,
      "pases_tot": 61,
      "entradas_ok": 5,
      "entradas_tot": 9,
      "intercepciones": 2,
      "bloqueos": 1,
      "despejes": 0,
      "paradas": 0
    }
  ]
}
```

Reglas:
- `fecha_juego` usa **un único corte de día** para toda la API (hora de Caracas). El corte se
  documenta en la respuesta de `/estado` cuando se defina.
- `duplicada_de`: si OurProClub publicó la misma sesión dos veces, la copia apunta a la
  original. PIRLO BOT ignora las copias.
- `goles` y `asistencias` son el **total oficial** (incluye lo manual). `goles_manuales` y
  `asistencias_manuales` indican cuánto de ese total se cargó a mano.
- `jugador_id = null` cuando quien jugó no tiene ficha en el club.
- `asistencias` debe ser la asistencia real (no la secundaria).
- Cualquier cambio en una sesión o en sus filas de jugador actualiza el `actualizado_at` de la
  sesión.

`GET /sesiones/{id}` devuelve una única sesión.

## `GET /partidos`

Calendario del club.

```json
{
  "id": "uuid",
  "competicion": "relampago | torneo | amistoso | liga | copa",
  "nombre": "texto | null",
  "rival": "texto | null",
  "inicio": "ISO 8601",
  "estado": "borrador | abierto | preparacion | publicada | finalizado | archivado | cancelado | pospuesto",
  "goles_favor": 2,
  "goles_contra": 0,
  "actualizado_at": "ISO 8601"
}
```

`goles_favor` y `goles_contra` son `null` salvo que exista un marcador cargado.

## `GET /eliminados`

Registros borrados desde `updated_since`.

```json
{ "tipo": "jugador | sesion | partido", "id": "texto", "eliminado_at": "ISO 8601" }
```

## Qué NO ofrece la v1 (y PIRLO BOT mostrará como "sin dato")

- Estadísticas por partido individual (solo por sesión).
- Porterías imbatidas: OurProClub no informa goles recibidos.
- Temporadas: cada club las define en PIRLO BOT y las sesiones se asignan por fecha.

## Requisitos previos en maritimo.app

1. `actualizado_at` con disparador en las tablas de estadísticas por sesión y por jugador
   (y en convocatorias y disponibilidad).
2. Registro de eliminaciones.
3. Marcado de sesiones duplicadas (`duplicada_de`) con la misma firma que ya usa
   `clasificaciones`.
4. Corte de día unificado.
5. Corrección de las asistencias secundarias guardadas como asistencias.
