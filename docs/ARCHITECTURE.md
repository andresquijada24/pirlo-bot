# Arquitectura de PIRLO BOT

## Decisiones principales

| Decisión            | Elección                                     | Motivo                                                                                                   |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Modelo Discord      | Interacciones HTTP (sin Gateway)             | La v1 solo necesita comandos, botones y publicaciones por REST. Cero intents. Escala a muchos servidores. |
| Runtime             | Node 22 + TypeScript estricto                |                                                                                                          |
| Framework HTTP      | Hono                                         | Ligero, funciona igual en Vercel y en local, fácil de probar con `app.request()`.                        |
| Hosting             | Vercel (Preview + Production)                | Compatible con HTTP; no se necesita conexión persistente.                                                |
| Base de datos       | Supabase (Postgres) propio                   | Independiente de Marítimo.                                                                               |
| Tareas programadas  | `pg_cron` + `pg_net` → `/api/cron/tick`      | Frecuencia de minutos para recordatorios; el cron de Vercel Hobby es muy limitado.                       |
| Gateway (futuro)    | Railway / Fly.io                             | Solo si algún día se necesitan eventos en tiempo real (p. ej. altas de miembros).                        |

## Flujo de una interacción

```
Discord ──POST firmado──▶ /api/interactions (Vercel)
                           │ 1. Verificar firma Ed25519 → 401 si falla
                           │ 2. Parsear JSON
                           ▼
                     src/discord/router.ts
                           │ PING → PONG
                           │ comando → registro de comandos
                           ▼
                     src/core/* (lógica + permisos por club)   [Fase 3]
                           ▼
                     src/db/repositories/* (Supabase)          [Fase 2-3]
```

Discord exige responder en menos de 3 segundos. Las operaciones lentas responderán con una
respuesta diferida ("pensando…") y editarán el mensaje después.

## Estructura de carpetas

```
api/                 Entrada de Vercel
src/
  app.ts             App Hono (inyección de dependencias para pruebas)
  config/            Validación de variables de entorno
  discord/           Firma, router, comandos, componentes, embeds, cliente REST
  core/              Lógica de negocio por dominio
  providers/         Contrato StatsProvider e implementaciones
  sync/              Motor de sincronización incremental
  db/                Cliente y repositorios (siempre con club_id)
  lib/               Logger con redacción de secretos, errores
scripts/             Registro de comandos y utilidades
supabase/            Migraciones SQL versionadas
tests/               Pruebas unitarias e integración
docs/                Documentación y logo original
```

## Seguridad y aislamiento

1. Toda tabla de club lleva `club_id` con claves foráneas compuestas.
2. Cada función de repositorio exige `clubId` y pasa por `permissions.assert(actor, club, acción)`.
3. RLS activado con denegación por defecto en todas las tablas. El bot usa la clave de servicio
   (que salta RLS), por eso la capa 2 es la protección efectiva del bot; RLS protege el futuro
   panel web y cualquier acceso con clave pública.
4. Logger con redacción de campos sensibles; los errores de configuración solo citan nombres de
   variables, nunca valores.
5. Comandos de administración con `default_member_permissions` como primera barrera, más los
   roles internos (admin, DT, capitán, jugador).

## Entornos

| Entorno     | Supabase                     | Vercel       | Discord                         |
| ----------- | ---------------------------- | ------------ | ------------------------------- |
| development | `PIRLO-BOT` (actual)         | Preview      | Servidor de pruebas propio      |
| production  | proyecto separado (futuro)   | Production   | Instalación pública, con aprobación |
