# CLAUDE.md — Instrucciones permanentes de PIRLO BOT

Este archivo lo lee Claude al inicio de cada sesión en este repositorio. Sus reglas son obligatorias.

## Qué es este proyecto

- **PIRLO BOT** es un bot de Discord **multiclub** para gestionar estadísticas deportivas y la
  operación de clubes de **EA SPORTS FC 27**.
- Es un proyecto **completamente independiente de MARÍTIMO CF (maritimo.app)**: repositorio,
  base de datos (Supabase propio), despliegue, variables de entorno, logs y configuración de
  Discord propios.
- **MARÍTIMO CF es solo un proveedor externo de datos**: el primer club conectado, consumido
  mediante una API autenticada de solo lectura a través de `MaritimoStatsProvider`.
- Alcance v1: estadísticas y gestión (plantillas, roles, convocatorias, alineaciones, calendario,
  recordatorios, rankings, récords). **No** se desarrolla IA conversacional.

## Reglas obligatorias

1. **No modificar otros repositorios** (incluido maritimo.app) sin autorización explícita del dueño.
2. **No acceder a la base de datos de Marítimo** ni usar sus credenciales. Solo su API autorizada.
3. **No inventar estadísticas.** Un dato que la fuente no ofrece se guarda como `NULL`, nunca `0`.
   No crear datos ficticios en la base de datos; los fixtures solo existen en `tests/`.
4. **Aislamiento entre clubes.** Toda tabla de club lleva `club_id`; toda función de repositorio
   exige `clubId` y pasa por el control de permisos. Nunca mezclar datos de clubes distintos.
5. **Secretos.** Nunca en el código, el repositorio, logs, mensajes de Discord ni el chat.
   `.env*` está ignorado (excepto `.env.example`). La clave de servicio de Supabase solo en servidor.
6. **Migraciones versionadas** en `supabase/migrations/`. Prohibidas las migraciones destructivas
   (DROP, TRUNCATE, borrado de columnas con datos) sin aprobación explícita.
7. **Todo cambio incluye pruebas** y debe pasar `npm run check`.
8. **No desplegar a producción** ni registrar comandos globales sin aprobación explícita.
9. **Discord:** no publicar en servidores o canales ajenos. Los comandos se prueban solo en el
   servidor de pruebas (`DISCORD_DEV_GUILD_ID`). El Guild 853894813169614848 y el canal
   938312479660965919 son solo referencias: no publicar en ellos sin autorización.
10. **Intents:** la v1 usa interacciones HTTP, sin conexión Gateway ni intents privilegiados.

## Identidad

- Nombre: PIRLO BOT · nombre técnico `pirlo-bot` · Discord Application ID 1562889315657195530.
- Logo: usar exclusivamente el archivo original en `docs/assets/`. No generar logos alternativos.

## Arquitectura en una línea

Discord → HTTPS firmado (Ed25519) → `api/index.ts` (Vercel, Hono) → `src/discord/router.ts` →
`src/core/*` (lógica, permisos) → `src/db/repositories/*` (Supabase). Proveedores externos en
`src/providers/*`, sincronizados por `src/sync/`. Detalle en `docs/ARCHITECTURE.md`.

## Comandos útiles

- `npm run check` — lint + formato + tipos + pruebas (obligatorio antes de cada commit).
- `npm run dev` — servidor local.
- `npm run commands:register` — registra comandos SOLO en el servidor de pruebas.
- `npm run db:new <nombre>` — nueva migración.

## Plan de fases

1. Proyecto independiente y repositorio ✅
2. Supabase y base de datos ✅
3. Núcleo multiclub y permisos ✅
4. Discord y comandos slash ✅
5. MARÍTIMO CF como primer proveedor ✅ (sincronización activa cada 15 min)
6. Proveedores de otros clubes
7. Rankings, estadísticas, convocatorias y alineaciones (convocatorias, alineaciones y recordatorios ✅)
8. Pruebas completas y despliegue
