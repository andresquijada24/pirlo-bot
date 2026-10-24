/** Traduce los errores habituales de la API de Discord al registrar comandos. Nunca incluye el token. */
export function explainDiscordError(status: number, code?: number | string): string {
  if (status === 401) {
    return 'Discord rechazó el token (401). Revisa el secreto DISCORD_BOT_TOKEN: puede estar incompleto, con espacios, o haber sido regenerado después.';
  }
  if (status === 403 || code === 50001) {
    return 'Sin acceso al servidor (403). El bot no está en ese servidor o DISCORD_DEV_GUILD_ID es incorrecto. Invita el bot con el scope applications.commands y revisa el ID.';
  }
  if (status === 404 || code === 10004) {
    return 'Servidor no encontrado (404). Revisa que DISCORD_DEV_GUILD_ID sea el ID del servidor (clic derecho en el servidor → Copiar ID).';
  }
  if (status === 400) {
    return 'Discord rechazó la definición de algún comando (400). Revisa nombres, descripciones y opciones.';
  }
  return `Error de Discord (${status}${code !== undefined ? `, código ${code}` : ''}).`;
}

export interface RegistrationFacts {
  /** ID de la aplicación que espera el proyecto (PIRLO BOT). */
  expectedAppId: string;
  /** ID y nombre de la aplicación a la que pertenece el token, según Discord. */
  tokenApp: { id: string; name: string };
  /** Servidor de pruebas configurado. */
  guildId: string;
  /** Servidores en los que está el bot del token. */
  botGuilds: { id: string; name: string }[];
}

/**
 * Comprueba la configuración ANTES de registrar y devuelve un mensaje accionable si algo no
 * cuadra, o null si todo está bien. No usa ni muestra el token.
 */
export function diagnoseRegistration(f: RegistrationFacts): string | null {
  if (f.tokenApp.id !== f.expectedAppId) {
    return (
      `El token de DISCORD_BOT_TOKEN pertenece a otra aplicación ("${f.tokenApp.name}", ${f.tokenApp.id}), ` +
      `no a PIRLO BOT (${f.expectedAppId}). Copia el token desde el portal de PIRLO BOT → Bot → Reset Token ` +
      'y actualiza el secreto en GitHub (y en Vercel).'
    );
  }
  if (!f.botGuilds.some((g) => g.id === f.guildId)) {
    const where = f.botGuilds.length
      ? `El bot está en: ${f.botGuilds.map((g) => `"${g.name}" (${g.id})`).join(', ')}.`
      : 'El bot no está en ningún servidor.';
    return (
      `PIRLO BOT no está en el servidor ${f.guildId}. ${where} ` +
      'Invítalo a tu servidor de pruebas o corrige DISCORD_DEV_GUILD_ID.'
    );
  }
  return null;
}
