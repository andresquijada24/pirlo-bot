# Despliegue

## Servicios

| Servicio       | Uso                                                       |
| -------------- | --------------------------------------------------------- |
| Vercel         | Endpoints `/api/interactions` y `/api/cron/sync`          |
| Supabase       | Postgres, `pg_cron` + `pg_net` para tareas programadas    |
| GitHub Actions | CI, migraciones aprobadas, registro de comandos y sincronización programada (cada 15 min) |

## Configuración en Vercel

1. Importar el repositorio `pirlo-bot` como proyecto nuevo (no reutilizar el de Marítimo).
2. Cargar las variables de `.env.example` en *Settings → Environment Variables*, separando
   Preview (desarrollo) y Production.
3. Tras el primer despliegue, copiar `https://<dominio>/api/interactions` en Discord Developer
   Portal → *General Information* → *Interactions Endpoint URL*. Discord envía un PING firmado
   para validarlo.

## Sincronización con Marítimo

1. Vercel: `MARITIMO_API_BASE_URL`, `MARITIMO_API_KEY`, `MARITIMO_CLUB_ID` y `CRON_SECRET`
   (texto aleatorio de 32+ caracteres; marcar como *Sensitive*).
2. GitHub → *Settings → Secrets → Actions*: `CRON_SECRET` con el mismo valor.
3. *Actions → Sincronizar Marítimo → Run workflow* para la primera pasada; luego corre sola.

## Reglas

- No se despliega a producción sin aprobación explícita.
- Los comandos se registran solo en el servidor de pruebas hasta tener aprobación para el
  registro global (`CONFIRM_GLOBAL=yes npm run commands:register -- --global`).
- Las migraciones a producción solo se aplican desde un entorno protegido de GitHub Actions con
  aprobación manual.

## Instalación del bot en servidores

- Scopes: `bot`, `applications.commands`.
- Permisos: Ver canales, Enviar mensajes, Insertar enlaces, Adjuntar archivos.
- Sin intents privilegiados.
