import { z } from 'zod';

/**
 * Validación central de variables de entorno.
 * Las claves privilegiadas solo existen en el servidor; nunca se envían a Discord ni a logs.
 */
const EnvSchema = z.object({
  APP_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/, 'Debe ser un ID numérico de Discord'),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'Debe ser la Public Key hexadecimal'),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().regex(/^\d+$/).optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  MARITIMO_API_BASE_URL: z.string().url().optional(),
  MARITIMO_API_KEY: z.string().min(1).optional(),
  /** Club de PIRLO BOT al que escribe el proveedor Marítimo (aislamiento: un proveedor, un club). */
  MARITIMO_CLUB_ID: z.string().uuid('Debe ser el id (uuid) del club en PIRLO BOT').optional(),
  OURPROCLUB_API_KEY: z.string().min(1).optional(),

  CRON_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Convierte cadenas vacías en undefined para que los opcionales funcionen con .env.example. */
function stripEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(stripEmpty(source));
  if (!parsed.success) {
    // Solo se reportan los NOMBRES de las variables, nunca sus valores.
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración inválida o incompleta: ${fields}`);
  }
  return parsed.data;
}
