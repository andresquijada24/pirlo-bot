import type { Club } from './types.js';
import type { Repositories } from '../db/repositories/types.js';
import type { GuildApi } from '../discord/onboarding.js';

/**
 * Operación interna de PIRLO BOT (no de un club): aprobación final de clubes nuevos por el dueño.
 *
 * Todo club nuevo queda 'pendiente'. El dueño recibe un DM con botones Aprobar / Rechazar (y lo
 * verá en el panel). Solo los IDs de Discord de PIRLO_OWNER_DISCORD_IDS pueden decidir.
 */

/** Dueño de PIRLO BOT por defecto (no es un secreto: es un ID público de Discord). */
export const DEFAULT_OWNER_IDS = ['1444572548133159073'];

const SNOWFLAKE = /^\d{17,20}$/;

export function ownerIdsFrom(env: string | undefined): ReadonlySet<string> {
  const ids = (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SNOWFLAKE.test(s));
  return new Set(ids.length ? ids : DEFAULT_OWNER_IDS);
}

export interface Platform {
  ownerIds: ReadonlySet<string>;
  api: GuildApi;
}

/** Deja el club pendiente y avisa al dueño con los botones. Un fallo del aviso no deshace nada. */
export async function requestApproval(
  deps: {
    repos: Pick<Repositories, 'clubs'>;
    platform: Platform;
    log?: { error: (o: object, m: string) => void };
  },
  club: { id: string; slug: string; name: string },
  requester: { userId: string; userName: string; guildName: string | null },
): Promise<void> {
  await deps.repos.clubs.setStatus(club.id, 'pendiente', requester.userId);
  const body = approvalMessage(club, requester);
  for (const owner of deps.platform.ownerIds) {
    await deps.platform.api.dm(owner, body).catch((err: unknown) => {
      deps.log?.error({ err }, 'No se pudo avisar al dueño de un club pendiente');
    });
  }
}

export function approvalMessage(
  club: { id: string; slug: string; name: string },
  requester: { userId: string; userName: string; guildName: string | null },
): Record<string, unknown> {
  const clean = (s: string) => s.replace(/[*_`~|>\\]/g, '').slice(0, 80);
  return {
    content: [
      '🆕 **Nuevo club pendiente de aprobación**',
      `**Club:** ${clean(club.name)} (\`${club.slug}\`)`,
      requester.guildName ? `**Servidor:** ${clean(requester.guildName)}` : '',
      `**Solicitado por:** <@${requester.userId}> (${clean(requester.userName)})`,
    ]
      .filter(Boolean)
      .join('\n'),
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Aprobar',
            custom_id: `owner:approve:${club.id}:${requester.userId}`,
          },
          {
            type: 2,
            style: 4,
            label: 'Rechazar',
            custom_id: `owner:reject:${club.id}:${requester.userId}`,
          },
        ],
      },
    ],
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Decisión del dueño. Devuelve el texto con el que se actualiza su mensaje. */
export async function decideClub(
  deps: { repos: Pick<Repositories, 'clubs'>; platform: Platform },
  actorId: string,
  action: string,
  clubId: string,
  requesterId: string,
): Promise<string> {
  if (!deps.platform.ownerIds.has(actorId))
    return 'Solo el dueño de PIRLO BOT puede aprobar clubes.';
  if ((action !== 'approve' && action !== 'reject') || !UUID.test(clubId))
    return 'Botón no válido.';
  const club: Club | null = await deps.repos.clubs.findById(clubId);
  if (!club) return 'Ese club ya no existe.';
  const status = action === 'approve' ? 'activo' : 'rechazado';
  await deps.repos.clubs.setStatus(clubId, status, actorId);
  if (SNOWFLAKE.test(requesterId)) {
    await deps.platform.api
      .dm(requesterId, {
        content:
          status === 'activo'
            ? `✅ **${club.name}** fue aprobado. Ya puedes usar PIRLO BOT en tu servidor: empieza con \`/club info\`.`
            : `**${club.name}** no fue aprobado en PIRLO BOT. Si crees que es un error, contacta con el equipo.`,
        allowed_mentions: { parse: [] },
      })
      .catch(() => undefined);
  }
  return status === 'activo'
    ? `✅ **${club.name}** (\`${club.slug}\`) aprobado.`
    : `❌ **${club.name}** (\`${club.slug}\`) rechazado.`;
}
