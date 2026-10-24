import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createMemoryRepos } from '../fakes/memory-repos.js';
import { slash, textOf } from '../helpers/interactions.js';
import { createTestSigner } from '../helpers/keys.js';

async function setup() {
  const signer = await createTestSigner();
  const app = createApp({ discordPublicKey: signer.publicKey, repos: createMemoryRepos().repos });
  async function post(payload: unknown, opts: { tamper?: boolean; noSignature?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const { signature, timestamp } = await signer.sign(body);
    return app.request('/api/interactions', {
      method: 'POST',
      body: opts.tamper ? body + ' ' : body,
      headers: {
        'content-type': 'application/json',
        ...(opts.noSignature ? {} : { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp }),
      },
    });
  }
  return { app, post };
}

const someone = { userId: '800000000000000001' };

describe('POST /api/interactions', () => {
  it('responde PONG a un PING firmado', async () => {
    const { post } = await setup();
    const res = await post({ type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('devuelve 401 si la firma no coincide', async () => {
    const { post } = await setup();
    expect((await post({ type: 1 }, { tamper: true })).status).toBe(401);
  });

  it('devuelve 401 si falta la firma', async () => {
    const { post } = await setup();
    expect((await post({ type: 1 }, { noSignature: true })).status).toBe(401);
  });

  it('ejecuta /pirlo ayuda con respuesta efímera', async () => {
    const { post } = await setup();
    const json = (await (await post(slash(someone, 'pirlo', 'ayuda'))).json()) as {
      type: number;
      data: { flags: number };
    };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(textOf(json)).toMatch('PIRLO BOT');
  });

  it('responde de forma controlada a un comando desconocido', async () => {
    const { post } = await setup();
    const json = await (await post(slash(someone, 'no-existe', null))).json();
    expect(textOf(json)).toMatch('Comando desconocido.');
  });

  it('ejecuta un comando con base de datos de punta a punta', async () => {
    const { post } = await setup();
    const json = await (await post(slash(someone, 'club', 'info'))).json();
    expect(textOf(json)).toMatch('no tiene ningún club');
  });
});

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const { app } = await setup();
    const res = await app.request('/api/health');
    expect(await res.json()).toEqual({ ok: true, service: 'pirlo-bot' });
  });
});
