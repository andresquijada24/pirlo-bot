import { DomainError, permissionDenied, validation } from '../../core/errors.js';
import { normalizePhoto } from '../../render/photo.js';
import { PUBLIC_BASE_URL } from '../../core/clubs/service.js';
import { DownloadError, MAX_ATTACHMENT_BYTES } from '../download.js';
import { assignRole, linkGamertag, listRoster, removeMember, setPositions } from '../../core/roster/service.js';
import { POSITION_CODES, type ClubRole, type Membership, type PositionCode } from '../../core/types.js';
import { CONTEXT_GUILD, OT } from '../constants.js';
import { optAttachment, optBoolean, optId, optString } from '../interaction.js';
import { embed, escapeMd, ok, reply } from '../responses.js';
import { clubOption, contextFor, mention, ROLE_LABELS, roleChoices } from './common.js';
import type { CommandContext, SlashCommand } from './types.js';

const ROLE_ORDER: ClubRole[] = ['admin', 'dt', 'capitan', 'jugador'];

/** Instructivo para subir la foto (se muestra con /plantilla foto sin imagen). */
export const PHOTO_GUIDE = [
  '**1.** En EA SPORTS FC 27 entra en **Clubes → The Grounds** con tu Pro.',
  '**2.** Ponte de frente a la cámara y quita los menús de la pantalla.',
  '**3.** Haz una captura: **PS5** botón *Crear* → Captura de pantalla · **Xbox** botón *Compartir* · **PC** tecla de captura (p. ej. F12 en Steam).',
  '**4.** Pásala al móvil o al PC: app de **PlayStation** o **Xbox** (Biblioteca de capturas), o la carpeta de capturas en PC.',
  '**5.** Aquí en Discord escribe `/plantilla foto` y adjunta la captura en **imagen**.',
  '',
  'Para que salga tu tarjeta tal cual, recorta la captura a la tarjeta en el móvil antes de subirla (o súbela desde tu ficha en la web, que tiene un marco para encuadrarla). Si subes la captura completa, PIRLO la recorta centrada en tu jugador. Para tener ficha con foto debes estar en la plantilla (`/vincular`) con tu gamertag de EA vinculado.',
  'Un DT o admin puede subirla por ti con `/plantilla foto usuario:@jugador`.',
].join('\n');
const MAX_EMBED_DESCRIPTION = 4000;

/**
 * Plantilla: jugadores y capitanes siempre; admins y DT solo si han jugado con el club (tienen
 * estadísticas). Los que no juegan (`staff`) no se muestran en la plantilla.
 */
export function splitRoster(roster: Membership[], played: ReadonlySet<string>) {
  const sorted = [...roster].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      a.displayName.localeCompare(b.displayName, 'es'),
  );
  const plays = (m: Membership) =>
    m.role === 'jugador' || m.role === 'capitan' || played.has(m.playerId);
  return { players: sorted.filter(plays), staff: sorted.filter((m) => !plays(m)) };
}

/** Convierte "mc, MCO dc" en ['MC','MCO','DC'] y rechaza códigos desconocidos. */
export function parsePositions(input: string): PositionCode[] {
  const tokens = input
    .toUpperCase()
    .split(/[\s,;/]+/)
    .filter(Boolean);
  if (tokens.length === 0) throw validation('Indica al menos una posición.');
  const invalid = tokens.filter((t) => !(POSITION_CODES as readonly string[]).includes(t));
  if (invalid.length) {
    throw validation(
      `Posición no válida: ${invalid.join(', ')}. Usa: ${POSITION_CODES.join(', ')}.`,
    );
  }
  return tokens as PositionCode[];
}

async function memberOf(ctx: CommandContext, clubId: string, userOption: string): Promise<Membership> {
  const userId = optId(ctx.command, userOption);
  const m = userId ? await ctx.repos.memberships.findActiveByDiscordUser(clubId, userId) : null;
  if (!m) throw new DomainError('NOT_FOUND', 'Ese usuario no forma parte de la plantilla.');
  return m;
}

const userOption = (description: string, required = true) => ({
  type: OT.User,
  name: 'usuario',
  description,
  required,
});

export const plantillaCommand: SlashCommand = {
  definition: {
    name: 'plantilla',
    description: 'Plantilla del club',
    contexts: [CONTEXT_GUILD],
    options: [
      {
        type: OT.Subcommand,
        name: 'ver',
        description: 'Muestra la plantilla (miembros del club)',
        options: [clubOption],
      },
      {
        type: OT.Subcommand,
        name: 'rol',
        description: 'Cambia el rol de un miembro (DT o admin)',
        options: [
          userOption('Miembro de la plantilla'),
          { type: OT.String, name: 'rol', description: 'Nuevo rol', required: true, choices: roleChoices },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'posiciones',
        description: 'Define posiciones (las tuyas, o las de otro si eres DT o admin)',
        options: [
          {
            type: OT.String,
            name: 'posiciones',
            description: 'Códigos separados por coma, p. ej. MC, MCO',
            required: true,
            max_length: 100,
          },
          userOption('Miembro (si no se indica, eres tú)', false),
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'foto',
        description: 'Sube tu foto de The Grounds para tu ficha (sin imagen: ver el instructivo)',
        options: [
          {
            type: OT.Attachment,
            name: 'imagen',
            description: 'Captura de tu Pro en The Grounds (PNG o JPG)',
            required: false,
          },
          userOption('Jugador (solo DT o admin; si no se indica, eres tú)', false),
          { type: OT.Boolean, name: 'quitar', description: 'Quita la foto', required: false },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'gamertag',
        description: 'Vincula el gamertag del juego para asignarle sus estadísticas (DT o admin)',
        options: [
          userOption('Miembro de la plantilla'),
          {
            type: OT.String,
            name: 'gamertag',
            description: 'Gamertag tal como aparece en las estadísticas',
            required: true,
            max_length: 40,
          },
          clubOption,
        ],
      },
      {
        type: OT.Subcommand,
        name: 'baja',
        description: 'Da de baja a un miembro; conserva su historial (DT o admin)',
        options: [userOption('Miembro de la plantilla'), clubOption],
      },
    ],
  },

  async execute(ctx) {
    const c = await contextFor(ctx);
    switch (ctx.command.sub) {
      case 'ver': {
        const [roster, played] = await Promise.all([
          listRoster(ctx.repos, c),
          ctx.repos.memberships.playedIds(c.club.id).catch(() => new Set<string>()),
        ]);
        // Solo los que forman parte real del equipo: los admins y DT que no juegan no salen.
        const { players } = splitRoster(roster, played);
        const line = (m: Membership) => {
          const num = m.shirtNumber !== null ? `\`#${m.shirtNumber}\` ` : '';
          const pos = m.positions.length ? ` · ${m.positions.join('/')}` : '';
          return `${num}**${escapeMd(m.displayName)}** · ${ROLE_LABELS[m.role]}${pos} · ${mention(m.discordUserId)}`;
        };
        let description = players.map(line).join('\n') || 'Todavía no hay jugadores.';
        if (description.length > MAX_EMBED_DESCRIPTION) {
          description = description.slice(0, MAX_EMBED_DESCRIPTION - 1) + '…';
        }
        return reply(null, {
          embeds: [
            embed({
              title: `Plantilla · ${escapeMd(c.club.name)}`,
              description,
              footer: { text: `${players.length} jugador(es)` },
            }),
          ],
        });
      }

      case 'rol': {
        const target = await memberOf(ctx, c.club.id, 'usuario');
        const role = optString(ctx.command, 'rol') as ClubRole;
        await assignRole(ctx.repos, c, target.id, role);
        return ok(`${escapeMd(target.displayName)} ahora es **${ROLE_LABELS[role]}**.`);
      }

      case 'posiciones': {
        const positions = parsePositions(optString(ctx.command, 'posiciones') ?? '');
        const target = optId(ctx.command, 'usuario') ? await memberOf(ctx, c.club.id, 'usuario') : c.membership;
        if (!target) throw new DomainError('NOT_A_MEMBER', 'No formas parte de la plantilla de este club.');
        await setPositions(ctx.repos, c, target.id, positions);
        return ok(`Posiciones de ${escapeMd(target.displayName)}: ${[...new Set(positions)].join(', ')}.`);
      }

      case 'foto': {
        const target = optId(ctx.command, 'usuario') ? await memberOf(ctx, c.club.id, 'usuario') : c.membership;
        if (!target) throw new DomainError('NOT_A_MEMBER', 'No formas parte de la plantilla de este club. Únete con `/vincular`.');
        const own = target.discordUserId === ctx.actor.discordUserId;
        // Permiso antes de descargar nada (y otra vez en la base de datos al guardar).
        if (!own && c.membership?.role !== 'admin' && c.membership?.role !== 'dt') {
          throw permissionDenied('Solo puedes cambiar tu propia foto (o la de otros si eres DT o admin).');
        }
        if (optBoolean(ctx.command, 'quitar')) {
          await ctx.repos.memberships.setPhoto(c.club.id, target.id, null, ctx.actor.discordUserId);
          return ok(`Foto de ${escapeMd(target.displayName)} quitada.`);
        }
        const file = optAttachment(ctx.interaction, ctx.command, 'imagen');
        if (!file) return reply(null, { embeds: [embed({ title: '📸 Tu foto de The Grounds en PIRLO', description: PHOTO_GUIDE })] });
        if (file.size > MAX_ATTACHMENT_BYTES) throw validation('La imagen es demasiado grande (máx. 2 MB).');
        if (!ctx.downloadBytes) throw validation('La subida de imágenes no está disponible ahora mismo.');
        const bytes = await ctx.downloadBytes(file.url).catch((err: unknown) => {
          throw validation(err instanceof DownloadError ? err.message : 'No se pudo leer la imagen.');
        });
        await ctx.repos.memberships.setPhoto(c.club.id, target.id, await normalizePhoto(bytes), ctx.actor.discordUserId);
        const ficha = `${PUBLIC_BASE_URL}/club/${c.club.slug}/jugador/${target.playerId}`;
        return ok(`Foto de ${escapeMd(target.displayName)} guardada 📸. Ya aparece en su ficha: ${ficha}`);
      }

      case 'gamertag': {
        const member = await memberOf(ctx, c.club.id, 'usuario');
        const res = await linkGamertag(ctx.repos, c, member.id, optString(ctx.command, 'gamertag') ?? '');
        const who = escapeMd(res.target.displayName);
        const gt = escapeMd(res.gamertag);
        return ok(
          res.linked > 0
            ? `${who} quedó vinculado a **${gt}**. Sus estadísticas ya cuentan para él.`
            : `Gamertag de ${who}: **${gt}**. Aún no hay estadísticas con ese nombre; se asignarán solas cuando lleguen.`,
        );
      }

      case 'baja': {
        const target = await memberOf(ctx, c.club.id, 'usuario');
        await removeMember(ctx.repos, c, target.id);
        return ok(`${escapeMd(target.displayName)} ya no forma parte de la plantilla. Su historial se conserva.`);
      }

      default:
        return reply('Subcomando desconocido.');
    }
  },
};
