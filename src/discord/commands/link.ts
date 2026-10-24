import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord-api-types/v10';
import { listPendingLinks, approveLink, rejectLink, requestLink } from '../../core/roster/service.js';
import { resolveContext } from '../../core/context.js';
import { notFound } from '../../core/errors.js';
import {
  BUTTON_DANGER,
  BUTTON_SUCCESS,
  COMPONENT_ACTION_ROW,
  COMPONENT_BUTTON,
  CONTEXT_GUILD,
  OT,
} from '../constants.js';
import { optString } from '../interaction.js';
import { embed, escapeMd, ok, reply, updateMessage } from '../responses.js';
import { clubOption, contextFor, mention } from './common.js';
import type { ComponentHandler, SlashCommand } from './types.js';

/** Discord permite 5 filas de componentes por mensaje: una fila (aprobar/rechazar) por solicitud. */
const MAX_LISTED = 5;
const UUID = /^[0-9a-f-]{36}$/i;

export const vincularCommand: SlashCommand = {
  definition: {
    name: 'vincular',
    description: 'Solicita unirte a la plantilla del club',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.String,
        name: 'nombre',
        description: 'Tu nombre en la plantilla',
        required: true,
        max_length: 60,
      },
      {
        type: OT.String,
        name: 'gamertag',
        description: 'Tu ID de EA / PlayStation / Xbox (opcional)',
        required: false,
        max_length: 40,
      },
      clubOption,
    ],
  },
  async execute(ctx) {
    const c = await contextFor(ctx);
    await requestLink(ctx.repos, c, {
      displayName: optString(ctx.command, 'nombre') ?? '',
      eaGamertag: optString(ctx.command, 'gamertag') ?? null,
    });
    return ok(
      `Solicitud enviada a **${escapeMd(c.club.name)}**. Un DT o admin la revisará con \`/solicitudes\`.`,
    );
  },
};

export const solicitudesCommand: SlashCommand = {
  definition: {
    name: 'solicitudes',
    description: 'Revisa las solicitudes para unirse al club (DT o admin)',
    contexts: [CONTEXT_GUILD],
    options: [clubOption],
  },
  async execute(ctx) {
    const c = await contextFor(ctx);
    const pending = await listPendingLinks(ctx.repos, c);
    if (pending.length === 0) return ok('No hay solicitudes pendientes.');

    const shown = pending.slice(0, MAX_LISTED);
    const lines = shown.map(
      (r, i) =>
        `**${i + 1}.** ${escapeMd(r.displayName)} · ${mention(r.discordUserId)}` +
        (r.eaGamertag ? ` · \`${r.eaGamertag.replace(/`/g, '')}\`` : ''),
    );
    const components: APIActionRowComponent<APIComponentInMessageActionRow>[] = shown.map((r, i) => ({
      type: COMPONENT_ACTION_ROW,
      components: [
        {
          type: COMPONENT_BUTTON,
          style: BUTTON_SUCCESS,
          label: `Aprobar ${i + 1}`,
          custom_id: `link:approve:${c.club.slug}:${r.id}`,
        },
        {
          type: COMPONENT_BUTTON,
          style: BUTTON_DANGER,
          label: `Rechazar ${i + 1}`,
          custom_id: `link:reject:${c.club.slug}:${r.id}`,
        },
      ],
    }));
    const extra = pending.length > MAX_LISTED ? `\n…y ${pending.length - MAX_LISTED} más.` : '';
    return reply(null, {
      embeds: [embed({ title: `Solicitudes · ${escapeMd(c.club.name)}`, description: lines.join('\n') + extra })],
      components,
    });
  },
};

/**
 * Botones de /solicitudes. custom_id = "link:<approve|reject>:<slug>:<requestId>".
 * El custom_id lo controla el cliente, así que NO se confía en él: el club se vuelve a resolver
 * entre los del servidor actual y los permisos se comprueban de nuevo.
 */
export const linkButtons: ComponentHandler = {
  prefix: 'link',
  async handle(ctx) {
    const [action, slug, requestId] = ctx.args;
    if ((action !== 'approve' && action !== 'reject') || !slug || !requestId || !UUID.test(requestId)) {
      throw notFound('Solicitud');
    }
    const c = await resolveContext(ctx.repos, ctx.actor, slug);
    if (action === 'approve') {
      await approveLink(ctx.repos, c, requestId);
      return updateMessage('✅ Solicitud aprobada. El jugador ya forma parte de la plantilla.');
    }
    await rejectLink(ctx.repos, c, requestId);
    return updateMessage('Solicitud rechazada.');
  },
};
