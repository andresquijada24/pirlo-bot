import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTestSigner } from '../helpers/keys.js';

async function setup() {
  const signer = await createTestSigner();
  const app = createApp({ discordPublicKey: signer.publicKey });
  async function post(payload: unknown, opts: { tamper?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const { signature, timestamp } = await signer.sign(body);
    return app.request('/api/interactions', {
      method: 'POST',
      body: opts.tamper ? body + ' ' : body,
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': signature,
        'x-signature-timestamp': timestamp,
      },
    });
  }
  return { app, post };
}

describe('POST /api/interactions', () => {
  it('responde PONG a un PING firmado', async () => {
    const { post } = await setup();
    const res = await post({ type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('devuelve 401 si la firma no coincide', async () => {
    const { post } = await setup();
    const res = await post({ type: 1 }, { tamper: true });
    expect(res.status).toBe(401);
  });

  it('ejecuta /pirlo ayuda con respuesta efímera', async () => {
    const { post } = await setup();
    const res = await post({
      type: 2,
      data: { type: 1, name: 'pirlo', options: [{ type: 1, name: 'ayuda' }] },
    });
    const json = (await res.json()) as { type: number; data: { flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
  });

  it('responde de forma controlada a un comando desconocido', async () => {
    const { post } = await setup();
    const res = await post({ type: 2, data: { type: 1, name: 'no-existe' } });
    const json = (await res.json()) as { data: { content: string } };
    expect(json.data.content).toBe('Comando desconocido.');
  });
});

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const { app } = await setup();
    const res = await app.request('/api/health');
    expect(await res.json()).toEqual({ ok: true, service: 'pirlo-bot' });
  });
});
