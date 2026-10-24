import type { webcrypto } from 'node:crypto';

/**
 * Verificación de firma Ed25519 de las interacciones HTTP de Discord.
 * Discord exige rechazar con 401 cualquier petición cuya firma no sea válida.
 * https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint
 *
 * Usa WebCrypto nativo (Node >= 22), sin dependencias externas.
 */

const keyCache = new Map<string, Promise<webcrypto.CryptoKey>>();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error('Hex inválido');
  }
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function importPublicKey(publicKeyHex: string): Promise<webcrypto.CryptoKey> {
  let key = keyCache.get(publicKeyHex);
  if (!key) {
    key = crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    keyCache.set(publicKeyHex, key);
  }
  return key;
}

export async function verifyDiscordRequest(params: {
  body: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  publicKey: string;
}): Promise<boolean> {
  const { body, signature, timestamp, publicKey } = params;
  if (!signature || !timestamp) return false;
  try {
    const key = await importPublicKey(publicKey);
    const message = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify('Ed25519', key, hexToBytes(signature), message);
  } catch {
    return false;
  }
}
