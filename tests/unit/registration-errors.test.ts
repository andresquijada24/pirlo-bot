import { describe, expect, it } from 'vitest';
import { diagnoseRegistration, explainDiscordError } from '../../src/discord/registration-errors.js';

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

describe('diagnoseRegistration', () => {
  const base = {
    expectedAppId: '1562889315657195530',
    tokenApp: { id: '1562889315657195530', name: 'PIRLO BOT' },
    guildId: '1444572548133159073',
    botGuilds: [{ id: '1444572548133159073', name: 'pruebas' }],
  };

  it('todo correcto → null', () => {
    expect(diagnoseRegistration(base)).toBeNull();
  });

  it('detecta un token de otra aplicación', () => {
    const msg = diagnoseRegistration({ ...base, tokenApp: { id: '111111111111111111', name: 'OTRO BOT' } });
    expect(msg).toMatch('pertenece a otra aplicación');
    expect(msg).toMatch('OTRO BOT');
  });

  it('detecta que el bot no está en el servidor configurado y dice dónde está', () => {
    const msg = diagnoseRegistration({ ...base, botGuilds: [{ id: '222222222222222222', name: 'otro' }] });
    expect(msg).toMatch('no está en el servidor 1444572548133159073');
    expect(msg).toMatch('"otro" (222222222222222222)');
  });

  it('avisa si el bot no está en ningún servidor', () => {
    expect(diagnoseRegistration({ ...base, botGuilds: [] })).toMatch('no está en ningún servidor');
  });
});
