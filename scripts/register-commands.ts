/**
 * Registra los comandos slash.
 *
 * Por defecto SOLO en el servidor de pruebas (DISCORD_DEV_GUILD_ID): los cambios son instantáneos
 * y no afectan a ningún otro servidor.
 *
 * Registro global (todos los servidores donde esté instalado el bot): requiere --global y
 * CONFIRM_GLOBAL=yes. Hacerlo solo con aprobación explícita.
 *
 *   npm run commands:register
 *   CONFIRM_GLOBAL=yes npm run commands:register -- --global
 *
 * Solo necesita DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN y (para pruebas) DISCORD_DEV_GUILD_ID.
 */
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { z } from 'zod';
import { commands } from '../src/discord/commands/index.js';

/** Servidor que solo es una referencia: nunca se registran comandos en él desde este script. */
const REFERENCE_GUILD_ID = '853894813169614848';

const env = z
  .object({
    DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/),
    DISCORD_BOT_TOKEN: z.string().min(1),
    DISCORD_DEV_GUILD_ID: z
      .string()
      .regex(/^\d{17,20}$/)
      .optional(),
  })
  .safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)));

if (!env.success) {
  console.error(`Faltan variables: ${env.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  process.exit(1);
}

const { DISCORD_APPLICATION_ID: appId, DISCORD_BOT_TOKEN: token, DISCORD_DEV_GUILD_ID: guildId } = env.data;
const isGlobal = process.argv.includes('--global');
const body = commands.map((c) => c.definition);
const rest = new REST({ version: '10' }).setToken(token);

if (isGlobal) {
  if (process.env.CONFIRM_GLOBAL !== 'yes') {
    console.error('Registro global bloqueado. Usa CONFIRM_GLOBAL=yes si está aprobado.');
    process.exit(1);
  }
  await rest.put(Routes.applicationCommands(appId), { body });
  console.log(`Registrados ${body.length} comandos de forma GLOBAL.`);
} else {
  if (!guildId) {
    console.error('Falta DISCORD_DEV_GUILD_ID (tu servidor de pruebas).');
    process.exit(1);
  }
  if (guildId === REFERENCE_GUILD_ID) {
    console.error('Ese es el servidor de referencia: no se registran comandos en él sin autorización.');
    process.exit(1);
  }
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
  console.log(`Registrados ${body.length} comandos en el servidor de pruebas:`);
  for (const c of body) console.log(`  /${c.name}`);
}
