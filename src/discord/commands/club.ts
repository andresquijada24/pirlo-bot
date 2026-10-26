import {
  configureChannel,
  connectClubToGuild,
  disconnectFromGuild,
  registerClub,
  setClubCrest,
} from '../../core/clubs/service.js';
import { normalizeCrest } from '../../render/crest.js';
import {
  EA_PLATFORM_LABELS,
  eaStatus,
  importEaFile,
  linkEaClub,
  unlinkEaClub,
  type EaPlatform,
} from '../../core/ea/service.js';
import { permissionDenied, validation } from '../../core/errors.js';
import { DownloadError, MAX_ATTACHMENT_BYTES } from '../download.js';
import { EA_PLATFORMS } from '../../providers/ea/ingest.js';
import { discordTime } from '../../core/time.js';
import { setClubTimezone, setReminderMinutes } from '../../core/callups/service.js';
import { assertCan, can } from '../../core/permissions/index.js';
import { listSeasons } from '../../core/seasons/service.js';
import { CHANNEL_PURPOSES, type ChannelPurpose } from '../../core/types.js';
import { CHANNEL_ANNOUNCEMENT, CHANNEL_TEXT, CONTEXT_GUILD, OT } from '../constants.js';
import { optAttachment, optBoolean, optId, optInteger, optString } from '../interaction.js';
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

const RESULT_ICONS = { victoria: '🟢', empate: '🟡', derrota: '🔴' } as const;

/** Texto del consentimiento que acepta el admin al vincular (versión v1 en la base de datos). */
export const EA_CONSENT_TEXT =
  'Como admin del club, autorizas a PIRLO a guardar y procesar los partidos de este club de EA ' +
  '(resultados, marcadores y estadísticas de tus jugadores y de los rivales) solo para este club. ' +
  'Los gamertags de los rivales nunca se muestran en páginas públicas. Puedes retirarlo con `/club ea retirar`.';

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
        name: 'desconectar',
        description: 'Desconecta el club de ESTE servidor (solo admin del club; no el último servidor)',
        options: [clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'recordatorios',
        description: 'Recordatorio automático antes de cada convocatoria (solo admin)',
        options: [
          {
            type: OT.Integer,
            name: 'minutos',
            description: 'Minutos antes del inicio (15 a 1440). 0 desactiva.',
            required: true,
            min_value: 0,
            max_value: 1440,
          },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'escudo',
        description: 'Sube el escudo del club para las imágenes de partido (solo admin)',
        options: [
          {
            type: OT.Attachment,
            name: 'imagen',
            description: 'PNG o JPG del escudo, mejor cuadrado y con fondo transparente',
            required: false,
          },
          {
            type: OT.Boolean,
            name: 'quitar_fondo',
            description: 'Vuelve transparente el fondo oscuro de la imagen (p. ej. fondo negro)',
            required: false,
          },
          { type: OT.Boolean, name: 'quitar', description: 'Quita el escudo actual', required: false },
          clubOption,
        ],
      },
      {
        type: OT.SubcommandGroup,
        name: 'ea',
        description: 'Partidos de EA Pro Clubs del club',
        options: [
          {
            type: OT.Subcommand,
            name: 'vincular',
            description: 'Vincula el club de EA y da tu consentimiento como admin',
            options: [
              {
                type: OT.String,
                name: 'id',
                description: 'ID del club en EA (solo números, p. ej. 55341)',
                required: true,
                max_length: 12,
              },
              {
                type: OT.String,
                name: 'plataforma',
                description: 'Plataforma del club',
                required: true,
                choices: EA_PLATFORMS.map((p) => ({ name: EA_PLATFORM_LABELS[p], value: p })),
              },
              clubOption,
            ],
          },
          {
            type: OT.Subcommand,
            name: 'estado',
            description: 'Club de EA vinculado y últimos partidos procesados (DT o admin)',
            options: [clubOption],
          },
          {
            type: OT.Subcommand,
            name: 'retirar',
            description: 'Retira el consentimiento: no se procesan más partidos (solo admin)',
            options: [clubOption],
          },
          {
            type: OT.Subcommand,
            name: 'importar',
            description: 'Importa el archivo de partidos que guardaste desde EA en tu navegador (DT o admin)',
            options: [
              {
                type: OT.Attachment,
                name: 'archivo',
                description: 'Archivo .json o .txt con los partidos, tal como lo muestra EA',
                required: true,
              },
              {
                type: OT.String,
                name: 'tipo',
                description: 'Tipo de partidos del archivo (por defecto: liga)',
                required: false,
                choices: [
                  { name: 'Liga', value: 'leagueMatch' },
                  { name: 'Playoff', value: 'playoffMatch' },
                  { name: 'Amistosos', value: 'friendlyMatch' },
                ],
              },
              clubOption,
            ],
          },
        ],
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
    if (ctx.command.group === 'ea') return executeEa(ctx);
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
          {
            name: 'Recordatorios',
            value: c.club.reminderMinutes ? `${c.club.reminderMinutes} min antes` : 'Desactivados',
            inline: true,
          },
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

      case 'desconectar': {
        const c = await contextFor(ctx);
        await disconnectFromGuild(ctx.repos, c);
        return ok(
          `**${escapeMd(c.club.name)}** ya no está conectado a este servidor. Sus datos se conservan en los demás servidores del club.`,
        );
      }

      case 'recordatorios': {
        const c = await contextFor(ctx);
        const minutes = await setReminderMinutes(ctx.repos, c, optInteger(ctx.command, 'minutos') ?? -1);
        if (minutes === null) return ok('Recordatorios desactivados.');
        const channels = await ctx.repos.channels.list(c.club.id);
        const target =
          channels.find((ch) => ch.purpose === 'recordatorios') ?? channels.find((ch) => ch.purpose === 'convocatorias');
        return ok(
          `Recordatorios activados: ${minutes} minutos antes de cada convocatoria, mencionando solo a quien no respondió.` +
            (target
              ? ` Se publicarán en <#${target.channelId}>.`
              : '\n⚠️ Falta el canal: usa `/club canal` con uso **Recordatorios** o **Convocatorias**.'),
        );
      }

      case 'escudo': {
        const c = await contextFor(ctx);
        if (optBoolean(ctx.command, 'quitar')) {
          await setClubCrest(ctx.repos, c, null);
          return ok(`Escudo de **${escapeMd(c.club.name)}** quitado. Las imágenes usarán sus iniciales.`);
        }
        const file = optAttachment(ctx.interaction, ctx.command, 'imagen');
        if (!file) throw validation('Adjunta la imagen del escudo (PNG o JPG).');
        if (file.size > MAX_ATTACHMENT_BYTES) throw validation('La imagen es demasiado grande (máx. 2 MB).');
        // El permiso se comprueba antes de descargar nada (y otra vez al guardar).
        if (c.membership?.role !== 'admin') {
          throw permissionDenied('Solo un admin del club puede cambiar el escudo.');
        }
        if (!ctx.downloadBytes) throw validation('La subida de imágenes no está disponible ahora mismo.');
        const bytes = await ctx.downloadBytes(file.url).catch((err: unknown) => {
          throw validation(err instanceof DownloadError ? err.message : 'No se pudo leer la imagen.');
        });
        await setClubCrest(
          ctx.repos,
          c,
          await normalizeCrest(bytes, { removeDarkBackground: optBoolean(ctx.command, 'quitar_fondo') === true }),
        );
        return ok(
          `Escudo de **${escapeMd(c.club.name)}** guardado ✅. Aparecerá en las próximas imágenes de partido.`,
        );
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

async function executeEa(ctx: Parameters<SlashCommand['execute']>[0]) {
  const c = await contextFor(ctx);
  switch (ctx.command.sub) {
    case 'vincular': {
      const link = await linkEaClub(ctx.repos, c, {
        eaClubId: optString(ctx.command, 'id') ?? '',
        platform: optString(ctx.command, 'plataforma') ?? '',
      });
      return ok(
        `Club de EA **${link.eaClubId}** (${EA_PLATFORM_LABELS[link.platform]}) vinculado a **${escapeMd(c.club.name)}**.\n\n` +
          `📝 ${EA_CONSENT_TEXT}\n\n` +
          'ℹ️ PIRLO procesará los partidos en cuanto haya una fuente de datos de EA autorizada. Mientras tanto no se lee nada de EA.',
      );
    }

    case 'importar': {
      const file = optAttachment(ctx.interaction, ctx.command, 'archivo');
      if (!file) throw validation('Adjunta el archivo de partidos de EA.');
      if (file.size > MAX_ATTACHMENT_BYTES) throw validation('El archivo es demasiado grande (máx. 2 MB).');
      if (!ctx.download) throw validation('La importación no está disponible ahora mismo.');
      const text = await ctx.download(file.url).catch((err: unknown) => {
        throw validation(err instanceof DownloadError ? err.message : 'No se pudo leer el archivo.');
      });
      const r = await importEaFile(ctx.repos, c, {
        text,
        matchType: optString(ctx.command, 'tipo') ?? 'leagueMatch',
      });
      const lines = [
        `📥 **${r.received}** partidos en el archivo · **${r.stored}** nuevos · **${r.processed}** procesados.`,
      ];
      if (r.received - r.stored - r.rejected > 0) {
        lines.push(`↩️ ${r.received - r.stored - r.rejected} ya estaban importados.`);
      }
      if (r.rejected) lines.push(`⚠️ ${r.rejected} no eran del club de EA vinculado o tenían otro formato.`);
      if (r.processed < r.stored) {
        lines.push('⏳ El resto se procesa automáticamente en los próximos 15 minutos.');
      }
      const results = (await ctx.repos.channels.list(c.club.id)).find((ch) => ch.purpose === 'resultados');
      lines.push(
        results
          ? `📣 El resumen se publicará en <#${results.channelId}> en los próximos 15 minutos.`
          : '💡 Para que PIRLO publique el resumen de cada partido, elige un canal con `/club canal` (uso: Resultados).',
      );
      lines.push('Consulta los resultados con `/club ea estado`.');
      return ok(lines.join('\n'));
    }

    case 'retirar': {
      const removed = await unlinkEaClub(ctx.repos, c);
      return ok(
        removed
          ? 'Consentimiento retirado: no se procesarán más partidos de EA. Los ya procesados se conservan.'
          : 'Este club no tenía un club de EA vinculado.',
      );
    }

    case 'estado': {
      const { link, recent } = await eaStatus(ctx.repos, c);
      const fields = [
        {
          name: 'Club de EA',
          value: link
            ? `\`${link.eaClubId}\` · ${EA_PLATFORM_LABELS[link.platform as EaPlatform]}`
            : 'Sin vincular. Un admin puede usar `/club ea vincular`.',
          inline: false,
        },
      ];
      if (link) {
        fields.push({
          name: 'Consentimiento',
          value: `<@${link.consentedBy}> · ${discordTime(new Date(link.consentedAt), 'f')}`,
          inline: false,
        });
      }
      fields.push({
        name: 'Últimos partidos',
        value: recent.length
          ? recent
              .map((m) => {
                const score = m.goalsFor !== null && m.goalsAgainst !== null ? `${m.goalsFor}-${m.goalsAgainst}` : '¿?';
                const icon = m.result ? RESULT_ICONS[m.result] : '⚪';
                return `${icon} ${score} vs ${escapeMd(m.opponentName ?? 'rival sin nombre')} · ${discordTime(new Date(m.playedAt), 'R')}`;
              })
              .join('\n')
          : 'Todavía no hay partidos procesados.',
        inline: false,
      });
      return reply(null, { embeds: [embed({ title: `EA Pro Clubs · ${escapeMd(c.club.name)}`, fields })] });
    }

    default:
      return reply('Subcomando desconocido.');
  }
}
