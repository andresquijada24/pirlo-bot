# Despliegue

## Servicios

| Servicio       | Uso                                                       |
| -------------- | --------------------------------------------------------- |
| Vercel         | Endpoint `/api/interactions` y `/api/cron/tick`           |
| Supabase       | Postgres, `pg_cron` + `pg_net` para tareas programadas    |
| GitHub Actions | CI (lint, formato, tipos, pruebas) y migraciones aprobadas |

## Configuración en Vercel

1. Importar el repositorio `pirlo-bot` como proyecto nuevo (no reutilizar el de Marítimo).
2. Cargar las variables de `.env.example` en *Settings → Environment Variables*, separando
   Preview (desarrollo) y Production.
3. Tras el primer despliegue, copiar `https://<dominio>/api/interactions` en Discord Developer
   Portal → *General Information* → *Interactions Endpoint URL*. Discord envía un PING firmado
   para validarlo.

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
