import { configureChannel, connectClubToGuild, registerClub } from '../../core/clubs/service.js';
import { setClubTimezone } from '../../core/callups/service.js';
import { assertCan, can } from '../../core/permissions/index.js';
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

const PROVIDER_LABELS: Record<string, string> = {
  maritimo: 'MARÍTIMO CF (API)',
  ourproclub: 'OurProClub',
  ea: 'EA SPORTS',
  manual: 'Manual',
};

const RUN_LABELS = { en_curso: '⏳ En curso', ok: '✅ Correcta', error: '❌ Con error' } as const;

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
        name: 'conectar',
        description: 'Conecta a este servidor un club que ya existe (admin del club y "Gestionar servidor")',
        options: [
          {
            type: OT.String,
            name: 'identificador',
            description: 'Identificador del club, el que muestra /club info (p. ej. maritimo-cf)',
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
      {
        type: OT.Subcommand,
        name: 'sincronizacion',
        description: 'Estado de la sincronización con el proveedor de estadísticas (DT o admin)',
        options: [clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'zona',
        description: 'Zona horaria con la que se leen las horas de convocatorias (solo admin)',
        options: [
          {
            type: OT.String,
            name: 'zona',
            description: 'p. ej. America/Caracas, America/Santo_Domingo, Europe/Madrid',
            required: true,
            max_length: 40,
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

      case 'conectar': {
        const res = await connectClubToGuild(ctx.repos, ctx.actor, {
          slug: optString(ctx.command, 'identificador') ?? '',
          guildName: null,
        });
        return ok(
          `Club \`${res.slug}\` conectado a este servidor, con su plantilla, estadísticas y temporadas.\n` +
            'Los jugadores pueden unirse con `/vincular`; un DT los aprueba con `/solicitudes`.',
        );
      }

      case 'info': {
        const c = await contextFor(ctx);
        const seasons = await listSeasons(ctx.repos, c);
        const current = seasons.find((s) => s.isCurrent);
        const fields = [
          { name: 'Identificador', value: `\`${c.club.slug}\``, inline: true },
          { name: 'Zona horaria', value: c.club.timezone, inline: true },
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

      case 'zona': {
        const c = await contextFor(ctx);
        const tz = await setClubTimezone(ctx.repos, c, optString(ctx.command, 'zona') ?? '');
        return ok(`Zona horaria del club: **${tz}**. Las horas de las convocatorias se leerán en esa zona.`);
      }

      case 'sincronizacion': {
        const c = await contextFor(ctx);
        assertCan(c, 'sync.view');
        const provider = c.club.statsProvider;
        const fields = [
          { name: 'Proveedor', value: PROVIDER_LABELS[provider] ?? provider, inline: true },
          { name: 'Id del club', value: `\`${c.club.id}\``, inline: false },
        ];
        if (provider === 'manual') {
          return reply(null, {
            embeds: [
              embed({
                title: `Sincronización · ${escapeMd(c.club.name)}`,
                description: 'Este club carga sus estadísticas a mano: no hay sincronización automática.',
                fields,
              }),
            ],
          });
        }
        const run = await ctx.repos.sync.lastRun(c.club.id, provider);
        if (!run) {
          fields.push({ name: 'Última ejecución', value: 'Todavía no se ha sincronizado.', inline: false });
        } else {
          const when = Math.floor(Date.parse(run.finishedAt ?? run.startedAt) / 1000);
          fields.push(
            { name: 'Estado', value: RUN_LABELS[run.status], inline: true },
            { name: 'Cuándo', value: `<t:${when}:R>`, inline: true },
            { name: 'Sesiones nuevas · actualizadas', value: `${run.rowsInserted} · ${run.rowsUpdated}`, inline: true },
          );
          if (run.errorMessage) fields.push({ name: 'Detalle', value: escapeMd(run.errorMessage), inline: false });
        }
        return reply(null, { embeds: [embed({ title: `Sincronización · ${escapeMd(c.club.name)}`, fields })] });
      }

      default:
        return reply('Subcomando desconocido.');
    }
  },
};
