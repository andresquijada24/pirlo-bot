import type { webcrypto } from 'node:crypto';

/** Genera un par de claves Ed25519 de PRUEBA y firma cuerpos igual que Discord. */
export async function createTestSigner() {
  const generated: unknown = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const pair = generated as webcrypto.CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const publicKey = Buffer.from(raw).toString('hex');

  async function sign(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    const sig = await crypto.subtle.sign(
      'Ed25519',
      pair.privateKey,
      new TextEncoder().encode(timestamp + body),
    );
    return { signature: Buffer.from(new Uint8Array(sig)).toString('hex'), timestamp };
  }

  return { publicKey, sign };
}
