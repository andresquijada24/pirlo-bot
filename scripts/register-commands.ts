/**
 * Registra los comandos slash.
 *
 * Por defecto SOLO en el servidor de pruebas (DISCORD_DEV_GUILD_ID): los cambios son instantáneos
 * y no afectan a ningún servidor ajeno.
 *
 * Registro global (todos los servidores donde esté instalado el bot): requiere --global y
 * CONFIRM_GLOBAL=yes. Hacerlo solo con aprobación explícita.
 *
 *   npm run commands:register
 *   CONFIRM_GLOBAL=yes npm run commands:register -- --global
 */
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { loadEnv } from '../src/config/env.js';
import { commands } from '../src/discord/commands/index.js';

const env = loadEnv();
const isGlobal = process.argv.includes('--global');
const body = commands.map((c) => c.definition);
const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);

if (isGlobal) {
  if (process.env.CONFIRM_GLOBAL !== 'yes') {
    console.error('Registro global bloqueado. Usa CONFIRM_GLOBAL=yes si está aprobado.');
    process.exit(1);
  }
  await rest.put(Routes.applicationCommands(env.DISCORD_APPLICATION_ID), { body });
  console.log(`Registrados ${body.length} comandos de forma GLOBAL.`);
} else {
  if (!env.DISCORD_DEV_GUILD_ID) {
    console.error('Falta DISCORD_DEV_GUILD_ID (tu servidor de pruebas).');
    process.exit(1);
  }
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_DEV_GUILD_ID),
    { body },
  );
  console.log(`Registrados ${body.length} comandos en el servidor de pruebas.`);
}
