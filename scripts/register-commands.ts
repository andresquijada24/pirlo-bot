/**
 * Registra los comandos slash.
 *
 * Por defecto SOLO en el servidor de pruebas (DISCORD_DEV_GUILD_ID): los cambios son instantáneos
 * y no afectan a ningún otro servidor.
 *
 * Registro global (todos los servidores donde esté instalado el bot): requiere --global y
 * CONFIRM_GLOBAL=yes. Hacerlo solo con aprobación explícita (variable DISCORD_COMMANDS_GLOBAL=true
 * del repositorio, que fija el dueño). Después quita las copias por servidor para no duplicarlas.
 *
 *   npm run commands:register
 *   CONFIRM_GLOBAL=yes npm run commands:register -- --global
 *
 * Solo necesita DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN y (para pruebas) DISCORD_DEV_GUILD_ID.
 *
 * Servidores reales de clubes: DISCORD_CLUB_GUILD_IDS (IDs separados por comas, variable del
 * repositorio que fija el dueño). Ahí también se registran, por servidor (instantáneo y sin tocar
 * ningún otro servidor). Incluir un ID en esa lista es la autorización explícita para ese servidor.
 */
import { DiscordAPIError, REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { z } from 'zod';
import { commands } from '../src/discord/commands/index.js';
import { diagnoseRegistration, explainDiscordError } from '../src/discord/registration-errors.js';

/** Servidor que solo es una referencia: nunca se registran comandos en él desde este script. */
const REFERENCE_GUILD_ID = '853894813169614848';

/**
 * Muestra un error y termina. En GitHub Actions usa "::error::" para que el mensaje aparezca
 * como anotación del job. Nunca imprime el token.
 */
function fail(message: string): never {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
  process.exit(1);
}

const env = z
  .object({
    DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/, 'DISCORD_APPLICATION_ID debe ser numérico'),
    DISCORD_BOT_TOKEN: z.string().trim().min(1, 'falta DISCORD_BOT_TOKEN'),
    DISCORD_DEV_GUILD_ID: z
      .string()
      .trim()
      .regex(/^\d{17,20}$/, 'DISCORD_DEV_GUILD_ID debe ser un ID numérico de 17 a 20 dígitos')
      .optional(),
    DISCORD_CLUB_GUILD_IDS: z
      .string()
      .trim()
      .regex(/^\d{17,20}(\s*,\s*\d{17,20})*$/, 'DISCORD_CLUB_GUILD_IDS: IDs numéricos separados por comas')
      .optional(),
  })
  .safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)));

if (!env.success) {
  fail(`Configuración inválida: ${env.error.issues.map((i) => i.message).join('; ')}`);
}

const { DISCORD_APPLICATION_ID: appId, DISCORD_BOT_TOKEN: token, DISCORD_DEV_GUILD_ID: guildId } = env.data;
const clubGuildIds = [...new Set((env.data.DISCORD_CLUB_GUILD_IDS ?? '').split(',').map((g) => g.trim()).filter(Boolean))];
const isGlobal = process.argv.includes('--global');
const body = commands.map((c) => c.definition);
const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  if (isGlobal) {
    if (process.env.CONFIRM_GLOBAL !== 'yes') {
      fail('Registro global bloqueado. Usa CONFIRM_GLOBAL=yes si está aprobado.');
    }
    await rest.put(Routes.applicationCommands(appId), { body });
    console.log(`Registrados ${body.length} comandos de forma GLOBAL (todos los servidores con el bot).`);
    // Las copias por servidor saldrían duplicadas junto a las globales: se quitan (no borra datos).
    const guilds = (await rest.get(Routes.userGuilds())) as { id: string }[];
    for (const id of new Set([guildId, ...clubGuildIds].filter((g): g is string => Boolean(g)))) {
      if (id === REFERENCE_GUILD_ID || !guilds.some((g) => g.id === id)) continue;
      await rest.put(Routes.applicationGuildCommands(appId, id), { body: [] });
      console.log(`Quitadas las copias por servidor en ${id} (ya usa las globales).`);
    }
    return;
  }
  if (!guildId) fail('Falta DISCORD_DEV_GUILD_ID (el ID de tu servidor de pruebas).');
  if (guildId === REFERENCE_GUILD_ID) {
    fail('Ese es el servidor de referencia: no se registran comandos en él sin autorización.');
  }
  // Diagnóstico previo: a qué aplicación pertenece el token y en qué servidores está el bot.
  const app = (await rest.get(Routes.currentApplication())) as { id: string; name: string };
  const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];
  console.log(`Token de la aplicación "${app.name}" (${app.id}); el bot está en ${guilds.length} servidor(es).`);
  const problem = diagnoseRegistration({
    expectedAppId: appId,
    tokenApp: { id: app.id, name: app.name },
    guildId,
    botGuilds: guilds.map((g) => ({ id: g.id, name: g.name })),
  });
  if (problem) fail(problem);

  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
  console.log(`Registrados ${body.length} comandos en el servidor de pruebas:`);
  for (const c of body) console.log(`  /${c.name}`);

  // Servidores reales de clubes autorizados por el dueño (variable DISCORD_CLUB_GUILD_IDS).
  if (clubGuildIds.includes(REFERENCE_GUILD_ID)) {
    fail('DISCORD_CLUB_GUILD_IDS incluye el servidor de referencia: no se registran comandos en él sin autorización.');
  }
  for (const id of clubGuildIds.filter((g) => g !== guildId)) {
    const where = guilds.find((g) => g.id === id);
    if (!where) fail(`PIRLO BOT no está en el servidor ${id}: invítalo antes de registrar los comandos allí.`);
    await rest.put(Routes.applicationGuildCommands(appId, id), { body });
    console.log(`Registrados ${body.length} comandos en el servidor del club "${where.name}" (${id}).`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof DiscordAPIError) fail(`${explainDiscordError(err.status, err.code)} [código ${err.code}]`);
  fail(`Error inesperado al registrar comandos: ${err instanceof Error ? err.name : 'desconocido'}`);
});
