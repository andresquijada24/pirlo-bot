/**
 * Versión publicada de PIRLO BOT (para el aviso «Hay una actualización»). En Vercel es el commit
 * del despliegue; en local, "dev". Solo letras y números: se inserta en HTML.
 */
export function currentVersion(env: Record<string, string | undefined> = process.env): string {
  const raw = env.VERCEL_GIT_COMMIT_SHA ?? env.VERCEL_DEPLOYMENT_ID ?? 'dev';
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'dev';
}

/** Etiquetas para el <head>/<body> de las páginas: versión y script del aviso. */
export function updateTags(version: string): { meta: string; script: string } {
  return {
    meta: `<meta name="pirlo-version" content="${version.replace(/[^A-Za-z0-9_-]/g, '')}">`,
    script: '<script src="/update.js" defer></script>',
  };
}
