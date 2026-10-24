import type {
  APIChatInputApplicationCommandInteraction,
  APIInteraction,
  APIInteractionResponse,
  APIMessageComponentInteraction,
} from 'discord-api-types/v10';
import { isDomainError } from '../core/errors.js';
import type { Repositories } from '../db/repositories/types.js';
import type { ComponentHandler, SlashCommand } from './commands/types.js';
import { IT, RT } from './constants.js';
import { actorFrom, parseCommand } from './interaction.js';
import { fail } from './responses.js';

/** ApplicationCommandType.ChatInput (comandos slash). */
const CHAT_INPUT = 1;

export interface RouterDeps {
  commands: ReadonlyMap<string, SlashCommand>;
  components: ReadonlyMap<string, ComponentHandler>;
  /** Puede faltar si la base de datos no está configurada. */
  repos: Repositories | null;
  log?: { error: (obj: object, msg: string) => void };
}

const NOT_IN_GUILD = 'PIRLO BOT solo funciona dentro de un servidor de Discord.';
const NO_DATABASE = 'PIRLO BOT todavía no está conectado a su base de datos. Avisa a un administrador.';
const UNEXPECTED = 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.';

/**
 * Despacha una interacción YA VERIFICADA. Nunca lanza: cualquier error se convierte en una
 * respuesta efímera. Los errores de dominio muestran su mensaje; el resto, uno genérico
 * (el detalle solo va al log).
 */
export async function routeInteraction(
  interaction: APIInteraction,
  deps: RouterDeps,
): Promise<APIInteractionResponse> {
  try {
    switch (interaction.type) {
      case IT.Ping:
        return { type: RT.Pong };
      case IT.ApplicationCommand:
        if (interaction.data.type !== CHAT_INPUT) return fail('Este tipo de comando no está disponible.');
        return await runCommand(interaction as APIChatInputApplicationCommandInteraction, deps);
      case IT.MessageComponent:
        return await runComponent(interaction, deps);
      default:
        return fail('Esta interacción todavía no está disponible.');
    }
  } catch (err) {
    if (isDomainError(err)) return fail(err.message);
    deps.log?.error({ err }, 'Error al procesar interacción');
    return fail(UNEXPECTED);
  }
}

async function runCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  deps: RouterDeps,
): Promise<APIInteractionResponse> {
  const command = deps.commands.get(interaction.data.name);
  if (!command) return fail('Comando desconocido.');
  const actor = actorFrom(interaction);
  if (!actor) return fail(NOT_IN_GUILD);
  if (command.needsDatabase !== false && !deps.repos) return fail(NO_DATABASE);
  return command.execute({
    interaction,
    command: parseCommand(interaction),
    actor,
    // Si el comando no necesita base de datos, nunca accede a repos.
    repos: deps.repos as Repositories,
  });
}

async function runComponent(
  interaction: APIMessageComponentInteraction,
  deps: RouterDeps,
): Promise<APIInteractionResponse> {
  const [prefix, ...args] = interaction.data.custom_id.split(':');
  const handler = prefix ? deps.components.get(prefix) : undefined;
  if (!handler) return fail('Este botón ya no está disponible.');
  const actor = actorFrom(interaction);
  if (!actor) return fail(NOT_IN_GUILD);
  if (!deps.repos) return fail(NO_DATABASE);
  return handler.handle({ interaction, args, actor, repos: deps.repos });
}
