# Supabase — PIRLO BOT

Base de datos **exclusiva** de PIRLO BOT (proyecto `PIRLO-BOT`, us-east-1). No comparte nada con
MARÍTIMO CF.

- `migrations/` — SQL versionado. Se crea con `npm run db:new <nombre>`.
- Sin migraciones destructivas sin aprobación explícita.
- `config.toml` se generará con `supabase init` al inicio de la Fase 2.

Flujo:

1. Probar en local: `npm run db:start` y `npm run db:reset:local`.
2. Aplicar a desarrollo: `supabase link --project-ref <ref>` y `supabase db push`.
3. Producción: solo desde GitHub Actions con aprobación manual.
