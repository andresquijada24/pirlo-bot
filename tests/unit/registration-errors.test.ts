import { describe, expect, it } from 'vitest';
import { explainDiscordError } from '../../src/discord/registration-errors.js';

describe('explainDiscordError', () => {
  it('explica un token inválido', () => {
    expect(explainDiscordError(401)).toMatch('DISCORD_BOT_TOKEN');
  });
  it('explica la falta de acceso al servidor', () => {
    expect(explainDiscordError(403, 50001)).toMatch('no está en ese servidor');
  });
  it('explica un servidor inexistente', () => {
    expect(explainDiscordError(404, 10004)).toMatch('DISCORD_DEV_GUILD_ID');
  });
  it('da un mensaje genérico con el código en otros casos', () => {
    expect(explainDiscordError(500, 0)).toBe('Error de Discord (500, código 0).');
  });
});
