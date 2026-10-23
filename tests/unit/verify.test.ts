import { describe, expect, it } from 'vitest';
import { verifyDiscordRequest } from '../../src/discord/verify.js';
import { createTestSigner } from '../helpers/keys.js';

describe('verifyDiscordRequest', () => {
  it('acepta una firma válida', async () => {
    const { publicKey, sign } = await createTestSigner();
    const body = JSON.stringify({ type: 1 });
    const { signature, timestamp } = await sign(body);
    expect(await verifyDiscordRequest({ body, signature, timestamp, publicKey })).toBe(true);
  });

  it('rechaza un cuerpo alterado', async () => {
    const { publicKey, sign } = await createTestSigner();
    const { signature, timestamp } = await sign('{"type":1}');
    expect(
      await verifyDiscordRequest({ body: '{"type":2}', signature, timestamp, publicKey }),
    ).toBe(false);
  });

  it('rechaza firma de otra clave', async () => {
    const a = await createTestSigner();
    const b = await createTestSigner();
    const body = '{"type":1}';
    const { signature, timestamp } = await b.sign(body);
    expect(
      await verifyDiscordRequest({ body, signature, timestamp, publicKey: a.publicKey }),
    ).toBe(false);
  });

  it('rechaza cabeceras ausentes o malformadas', async () => {
    const { publicKey } = await createTestSigner();
    expect(
      await verifyDiscordRequest({ body: '{}', signature: null, timestamp: '1', publicKey }),
    ).toBe(false);
    expect(
      await verifyDiscordRequest({ body: '{}', signature: 'zz', timestamp: '1', publicKey }),
    ).toBe(false);
  });
});
