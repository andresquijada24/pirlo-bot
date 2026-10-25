# Modelo de datos multiclub

Implementado en la Fase 2 (`supabase/migrations/`). Nombres de tablas y columnas en inglés;
valores de enumeraciones en español (`voy`, `no_voy`, `jugado`, `POR`, `DC`…).

Las referencias entre tablas de un club usan claves foráneas compuestas `(club_id, id)`: la base
de datos rechaza cualquier fila que apunte a datos de otro club.

## Identidad y servidores

| Tabla           | Columnas clave                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| `clubs`         | id, slug, nombre, escudo, `ea_club_id`, plataforma, `stats_provider`, estado        |
| `guilds`        | id (= guild_id de Discord), nombre, `multi_club_enabled`, fecha de instalación      |
| `club_guilds`   | club_id, guild_id, `is_primary` — permite varios clubes por servidor                |
| `club_channels` | club_id, guild_id, canal, propósito (anuncios, convocatorias, alineaciones, resultados, rankings, recordatorios) |

## Personas

| Tabla              | Columnas clave                                                                          |
| ------------------ | --------------------------------------------------------------------------------------- |
| `players`          | identidad global: nombre, gamertag EA, `discord_user_id` único y verificado             |
| `club_memberships` | club_id, player_id, rol (`admin`/`dt`/`capitan`/`jugador`), posiciones, dorsal, alta, baja |

Un jugador puede cambiar de club sin perder su historial.

## Competición

| Tabla                | Columnas clave                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `seasons`            | club_id, nombre, inicio, fin, `is_current`                                                      |
| `sessions`           | club_id, season_id, fecha, etiqueta                                                             |
| `matches`            | club_id, season_id, session_id, rival, fecha, marcador, resultado, fuente, `external_id`, estado (`programado`/`jugado`/`verificado`/`anulado`) |
| `player_match_stats` | match_id, club_id, player_id, posición, goles, asistencias, entradas exitosas, entradas intentadas, `clean_sheet_verified`, fuente |

**Regla:** las columnas de estadísticas admiten `NULL`. Un dato que la fuente no ofrece es `NULL`,
nunca `0`.

## Gestión

Cada club tiene `clubs.timezone` (por defecto `America/Caracas`): las fechas que escribe el club
se interpretan en esa zona y Discord las muestra en la hora local de cada usuario.
Las convocatorias se crean con `create_callup` (también crea su evento del calendario) y se
responden con `respond_callup` (solo miembros activos, mientras esté abierta y en plazo).
Cada convocatoria tiene como mucho una alineación (`create_lineup`); la formación fija los 11
huecos titulares y los suplentes ocupan los huecos 12 a 23 (`lineup_assign`, `lineup_remove`).

`events` (calendario), `callups` + `callup_responses` (Voy / No voy / Duda), `lineups` +
`lineup_slots`, `scheduled_posts` (recordatorios y publicaciones automáticas).

## Integridad e historial

| Tabla                | Propósito                                                        |
| -------------------- | ---------------------------------------------------------------- |
| `external_refs`      | proveedor + id externo ↔ id interno; evita duplicados            |
| `external_players`   | plantilla informada por el proveedor (gamertag, posiciones) y su vínculo con `players` |
| `provider_sync_runs` | cursor incremental, conteos, errores                             |
| `stat_revisions`     | valor anterior/nuevo, motivo, autor, fecha (correcciones)        |
| `audit_log`          | quién hizo qué en cada club                                      |

## Cálculos derivados

Efectividad defensiva, rankings y récords se calculan con **vistas SQL** a partir de los conteos
brutos; no se duplican en tablas. Las porterías imbatidas solo cuentan si
`clean_sheet_verified = true`. Si un proveedor entrega un porcentaje oficial propio, se respeta.

## Secretos de proveedores

Nunca en tablas en texto plano: Supabase Vault o variables de entorno.
