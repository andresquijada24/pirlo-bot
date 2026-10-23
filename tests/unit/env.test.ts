import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const base = {
  DISCORD_APPLICATION_ID: '1562889315657195530',
  DISCORD_PUBLIC_KEY: 'a'.repeat(64),
  DISCORD_BOT_TOKEN: 'test-token-no-real',
};

describe('loadEnv', () => {
  it('acepta la configuración mínima y aplica valores por defecto', () => {
    const env = loadEnv(base);
    expect(env.APP_ENV).toBe('development');
    expect(env.SUPABASE_URL).toBeUndefined();
  });

  it('trata cadenas vacías como ausentes', () => {
    expect(() => loadEnv({ ...base, SUPABASE_URL: '' })).not.toThrow();
  });

  it('informa los nombres de las variables inválidas sin revelar valores', () => {
    const secret = 'valor-secreto-que-no-debe-aparecer';
    try {
      loadEnv({ ...base, DISCORD_PUBLIC_KEY: secret });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('DISCORD_PUBLIC_KEY');
      expect(msg).not.toContain(secret);
    }
  });
});
