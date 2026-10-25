# PIRLO BOT

Bot de Discord multiclub para estadísticas y gestión de clubes de **EA SPORTS FC 27**.

> Proyecto independiente. MARÍTIMO CF (maritimo.app) es el primer club conectado, como proveedor
> externo de datos mediante API.

## Estado

Fases 1-4 completadas: proyecto, base de datos multiclub, núcleo y permisos, y comandos de
Discord funcionando en el servidor de pruebas. Siguiente: Fase 5 (MARÍTIMO CF como proveedor).

## Comandos de Discord

| Comando | Quién |
| --- | --- |
| `/pirlo ayuda` | Todos |
| `/club registrar` · `/club conectar` · `/club info` · `/club canal` | Gestor del servidor · gestor del servidor y admin del club · todos · admin |
| `/vincular` · `/solicitudes` (con botones) | Todos · DT/admin |
| `/plantilla ver` · `rol` · `posiciones` · `baja` | Miembros · DT/admin · cada jugador · DT/admin |
| `/temporada crear` · `/temporada fechas` · `/temporada ver` | Admin · admin · todos |

Los comandos se registran **solo en el servidor de pruebas** desde GitHub Actions →
**Registrar comandos de Discord** (secretos `DISCORD_BOT_TOKEN` y `DISCORD_DEV_GUILD_ID`).

## Requisitos

- Node.js 22 o superior
- Supabase CLI (incluida como dependencia de desarrollo; necesita Docker para la base local)

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # rellena los valores (nunca los subas a git)
npm run check                # lint + formato + tipos + pruebas
npm run dev                  # servidor local en http://localhost:3000
```

Para probar con Discord en local, expón el puerto con un túnel HTTPS y configura esa URL +
`/api/interactions` como *Interactions Endpoint URL* de una aplicación de pruebas.

## Scripts

| Script                      | Qué hace                                         |
| --------------------------- | ------------------------------------------------ |
| `npm run dev`               | Servidor local con recarga                       |
| `npm run check`             | Lint, formato, tipos y pruebas                   |
| `npm test`                  | Pruebas (Vitest)                                 |
| `npm run commands:register` | Registra comandos en el servidor de pruebas      |
| `npm run db:new <nombre>`   | Crea una migración nueva                         |
| `npm run db:types`          | Genera tipos TypeScript desde la base local      |

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Modelo de datos](docs/DATA_MODEL.md)
- [Proveedores de estadísticas](docs/PROVIDERS.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Permisos y roles](docs/PERMISSIONS.md)
- [Instrucciones permanentes para Claude](CLAUDE.md)
