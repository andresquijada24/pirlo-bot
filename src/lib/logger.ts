import pino from 'pino';

/**
 * Logger estructurado con redacción de secretos.
 * Cualquier campo con estos nombres se reemplaza por "[REDACTED]" antes de escribirse.
 */
export const REDACT_PATHS = [
  'token',
  'authorization',
  'apiKey',
  'password',
  '*.token',
  '*.authorization',
  '*.apiKey',
  '*.password',
  'headers.authorization',
  'env.DISCORD_BOT_TOKEN',
  'env.SUPABASE_SERVICE_ROLE_KEY',
  'env.MARITIMO_API_KEY',
  'env.OURPROCLUB_API_KEY',
  'env.CRON_SECRET',
  'env.DATABASE_URL',
];

export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'pirlo-bot' },
  });
}

export const logger = createLogger();
