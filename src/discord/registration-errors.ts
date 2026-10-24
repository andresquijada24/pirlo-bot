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
