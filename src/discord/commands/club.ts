import { configureChannel, registerClub } from '../../core/clubs/service.js';
import { can } from '../../core/permissions/index.js';
import { listSeasons } from '../../core/seasons/service.js';
import { CHANNEL_PURPOSES, type ChannelPurpose } from '../../core/types.js';
import { CHANNEL_ANNOUNCEMENT, CHANNEL_TEXT, CONTEXT_GUILD, OT } from '../constants.js';
import { optId, optString } from '../interaction.js';
import { embed, escapeMd, ok, reply } from '../responses.js';
import { clubOption, contextFor, ROLE_LABELS } from './common.js';
import type { SlashCommand } from './types.js';

const PURPOSE_LABELS: Record<ChannelPurpose, string> = {
  anuncios: 'Anuncios',
  convocatorias: 'Convocatorias',
  alineaciones: 'Alineaciones',
  resultados: 'Resultados',
  rankings: 'Rankings',
  recordatorios: 'Recordatorios',
};

export const clubCommand: SlashCommand = {
  definition: {
    name: 'club',
    description: 'Registro y configuración del club',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.Subcommand,
        name: 'registrar',
        description: 'Registra un club en este servidor (requiere "Gestionar servidor")',
        options: [
          {
            type: OT.String,
            name: 'nombre',
            description: 'Nombre del club, p. ej. Marítimo CF',
            required: true,
            max_length: 80,
          },
          {
            type: OT.String,
            name: 'identificador',
            description: 'Identificador corto sin espacios, p. ej. maritimo-cf',
            required: true,
            max_length: 40,
          },
        ],
      },
      {
        type: OT.Subcommand,
        name: 'info',
        description: 'Muestra la información del club',
        options: [clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'canal',
        description: 'Asigna un canal a un uso del club (solo admin)',
        options: [
          {
            type: OT.String,
            name: 'uso',
            description: 'Para qué se usará el canal',
            required: true,
            choices: CHANNEL_PURPOSES.map((p) => ({ name: PURPOSE_LABELS[p], value: p })),
          },
          {
            type: OT.Channel,
            name: 'canal',
            description: 'Canal de texto',
            required: true,
            channel_types: [CHANNEL_TEXT, CHANNEL_ANNOUNCEMENT],
          },
          clubOption,
        ],
      },
    ],
  },

  async execute(ctx) {
    switch (ctx.command.sub) {
      case 'registrar': {
        const res = await registerClub(ctx.repos, ctx.actor, {
          name: optString(ctx.command, 'nombre') ?? '',
          slug: optString(ctx.command, 'identificador') ?? '',
          guildName: null,
        });
        return ok(
          `Club registrado con el identificador \`${res.slug}\`. Ahora eres admin del club.\n` +
            'Siguientes pasos: `/club canal` para elegir canales y `/temporada crear` para la temporada.',
        );
      }

      case 'info': {
        const c = await contextFor(ctx);
        const seasons = await listSeasons(ctx.repos, c);
        const current = seasons.find((s) => s.isCurrent);
        const fields = [
          { name: 'Identificador', value: `\`${c.club.slug}\``, inline: true },
          { name: 'Temporada actual', value: current ? escapeMd(current.name) : 'Sin definir', inline: true },
          {
            name: 'Tu rol',
            value: c.membership ? ROLE_LABELS[c.membership.role] : 'No eres miembro',
            inline: true,
          },
        ];
        if (can(c, 'roster.view')) {
          const channels = await ctx.repos.channels.list(c.club.id);
          fields.push({
            name: 'Canales',
            value: channels.length
              ? channels.map((ch) => `${PURPOSE_LABELS[ch.purpose]}: <#${ch.channelId}>`).join('\n')
              : 'Sin configurar',
            inline: false,
          });
        }
        return reply(null, { embeds: [embed({ title: escapeMd(c.club.name), fields })] });
      }

      case 'canal': {
        const c = await contextFor(ctx);
        const purpose = optString(ctx.command, 'uso') as ChannelPurpose;
        const channelId = optId(ctx.command, 'canal') ?? '';
        await configureChannel(ctx.repos, c, purpose, channelId);
        return ok(`Canal de ${PURPOSE_LABELS[purpose].toLowerCase()}: <#${channelId}>.`);
      }

      default:
        return reply('Subcomando desconocido.');
    }
  },
};
