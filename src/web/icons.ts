/**
 * Íconos de línea propios (SVG en línea, color del texto). Sustituyen a los emojis en la web:
 * mismo trazo y tamaño en todos los navegadores y sistemas. Sin dependencias ni licencias externas.
 */
const PATHS = {
  goal: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z"/><path d="M12 3.5v4M20.2 9.4l-4.4.9M16.9 19l-2.6-4.3M7.1 19l2.6-4.3M3.8 9.4l4.4.9"/>',
  assist: '<path d="M4 18c3.5-6.5 8-9.5 14-10"/><path d="M14 4.5l4.5 3.5-3.5 4.5"/><circle cx="4.5" cy="18.5" r="1.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  keeper: '<path d="M3 19V6h18v13"/><path d="M3 10.5h18M7.5 6v13M12 6v13M16.5 6v13"/>',
  rating: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  camera: '<path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 18, filled = false): string {
  return (
    `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? 'currentColor' : 'none'}" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}
