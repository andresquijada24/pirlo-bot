import { DomainError, validation } from '../../core/errors.js';
import { assignRole, linkGamertag, listRoster, removeMember, setPositions } from '../../core/roster/service.js';
import { POSITION_CODES, type ClubRole, type Membership, type PositionCode } from '../../core/types.js';
import { CONTEXT_GUILD, OT } from '../constants.js';
import { optId, optString } from '../interaction.js';
import { embed, escapeMd, ok, reply } from '../responses.js';
import { clubOption, contextFor, mention, ROLE_LABELS, roleChoices } from './common.js';
import type { CommandContext, SlashCommand } from './types.js';

const ROLE_ORDER: ClubRole[] = ['admin', 'dt', 'capitan', 'jugador'];
const MAX_EMBED_DESCRIPTION = 4000;

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
        const roster = await listRoster(ctx.repos, c);
        const sorted = [...roster].sort(
          (a, b) =>
            ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
            a.displayName.localeCompare(b.displayName, 'es'),
        );
        let description = sorted
          .map((m) => {
            const num = m.shirtNumber !== null ? `\`#${m.shirtNumber}\` ` : '';
            const pos = m.positions.length ? ` · ${m.positions.join('/')}` : '';
            return `${num}**${escapeMd(m.displayName)}** · ${ROLE_LABELS[m.role]}${pos} · ${mention(m.discordUserId)}`;
          })
          .join('\n');
        if (description.length > MAX_EMBED_DESCRIPTION) {
          description = description.slice(0, MAX_EMBED_DESCRIPTION - 1) + '…';
        }
        return reply(null, {
          embeds: [
            embed({
              title: `Plantilla · ${escapeMd(c.club.name)}`,
              description: description || 'Todavía no hay miembros.',
              footer: { text: `${roster.length} miembro(s)` },
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
