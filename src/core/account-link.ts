import { isDomainError } from './errors.js';
import type { DiscordAccountMembership, Repositories } from '../db/repositories/types.js';

/**
 * Vinculación automática del gamertag al entrar con Discord.
 *
 * Discord informa (scope "connections") las cuentas de juego que el usuario conectó en su perfil:
 * PlayStation, Xbox, Steam o Epic. Solo se usan las VERIFICADAS por Discord: así nadie puede
 * apropiarse del gamertag de otro.
 *
 * Para cada club donde el usuario ya está en la plantilla y aún no tiene gamertag, se vincula
 * el nombre de una de esas cuentas SI el club ya lo conoce (aparece en sus estadísticas de EA o del
 * proveedor). Nunca se crean fichas, no se cambia un gamertag ya puesto y no se toca otro club.
 */

export const GAMING_CONNECTIONS = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
  steam: 'Steam',
  epicgames: 'Epic Games',
} as const;
export type GamingPlatform = keyof typeof GAMING_CONNECTIONS;

export interface GamingAccount {
  platform: GamingPlatform;
  name: string;
}

/** Filtra la respuesta de GET /users/@me/connections: solo cuentas de juego verificadas. */
export function gamingAccounts(raw: unknown): GamingAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: GamingAccount[] = [];
  for (const c of raw) {
    const o = c as { type?: unknown; name?: unknown; verified?: unknown; revoked?: unknown };
    if (typeof o.type !== 'string' || !Object.hasOwn(GAMING_CONNECTIONS, o.type)) continue;
    if (o.verified !== true || o.revoked === true) continue;
    if (typeof o.name !== 'string') continue;
    const name = o.name.trim();
    if (name.length < 2 || name.length > 40) continue;
    if (!out.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      out.push({ platform: o.type as GamingPlatform, name });
    }
  }
  return out.slice(0, 10);
}

export type LinkOutcome =
  | { status: 'vinculado'; gamertag: string; platform: GamingPlatform }
  /** Ya tenía gamertag: no se cambia. */
  | { status: 'ya_tenia'; gamertag: string }
  /** El club no conoce ninguno de sus nombres (aún no ha jugado con ellos). */
  | { status: 'sin_coincidencia' }
  /** El gamertag ya es de otro jugador del club. */
  | { status: 'ocupado'; gamertag: string };

export interface AccountLinkResult {
  membership: DiscordAccountMembership;
  outcome: LinkOutcome;
}

export async function autoLinkAccounts(
  repos: Pick<Repositories, 'externalPlayers'>,
  discordUserId: string,
  accounts: GamingAccount[],
  log?: { error: (obj: object, msg: string) => void },
): Promise<AccountLinkResult[]> {
  const memberships = await repos.externalPlayers.accountsOf(discordUserId);
  const results: AccountLinkResult[] = [];
  for (const m of memberships) {
    if (m.gamertag) {
      results.push({ membership: m, outcome: { status: 'ya_tenia', gamertag: m.gamertag } });
      continue;
    }
    let outcome: LinkOutcome = { status: 'sin_coincidencia' };
    for (const acc of accounts) {
      if (!(await repos.externalPlayers.knowsGamertag(m.clubId, acc.name))) continue;
      try {
        // Solo su propia ficha: el actor es el mismo usuario.
        await repos.externalPlayers.linkGamertag(m.clubId, m.playerId, acc.name, discordUserId);
        outcome = { status: 'vinculado', gamertag: acc.name, platform: acc.platform };
        m.gamertag = acc.name;
      } catch (err) {
        if (isDomainError(err) && err.code !== 'INTERNAL') {
          outcome = { status: 'ocupado', gamertag: acc.name };
          continue;
        }
        log?.error({ err, clubId: m.clubId }, 'No se pudo vincular el gamertag automáticamente');
        continue;
      }
      break;
    }
    results.push({ membership: m, outcome });
  }
  return results;
}
