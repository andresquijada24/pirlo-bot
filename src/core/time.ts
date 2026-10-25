import { validation } from './errors.js';

/**
 * Fechas escritas por el club → instante UTC, interpretadas en la zona horaria del club.
 * Sin dependencias: se usa Intl para conocer el desfase de la zona en cada fecha (respeta el
 * horario de verano).
 */

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Fecha y hora locales de un instante en una zona horaria. */
export function partsIn(date: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const get = (type: string) => Number(fmt.formatToParts(date).find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Desfase (ms) de la zona respecto a UTC en un instante dado. */
function offsetAt(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** Hora local de pared en una zona → instante UTC. */
export function zonedToUtc(p: Parts, tz: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  let utc = guess - offsetAt(new Date(guess), tz);
  // Segunda pasada por si el desfase cambia entre la estimación y el resultado (horario de verano).
  utc = guess - offsetAt(new Date(utc), tz);
  return new Date(utc);
}

const DATE_HELP = 'Escribe la fecha como 25/10, 25/10/2026, 2026-10-25, hoy o mañana.';
const TIME_HELP = 'Escribe la hora como 21:30 o 9:30pm.';

function validDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "25/10", "25/10/2026", "2026-10-25", "hoy", "mañana" → día local. */
export function parseDay(input: string, tz: string, now: Date = new Date()): { year: number; month: number; day: number } {
  const s = input.trim().toLowerCase();
  const today = partsIn(now, tz);
  if (s === 'hoy' || s === 'mañana' || s === 'manana') {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + (s === 'hoy' ? 0 : 1)));
    return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
  }
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    if (dmy[3]) {
      y = Number(dmy[3]);
      if (y < 100) y += 2000;
    } else {
      // Sin año: el próximo 25/10 (este año o, si ya pasó, el siguiente).
      y = today.year;
      if (m < today.month || (m === today.month && d < today.day)) y += 1;
    }
  } else {
    throw validation(`Fecha no válida. ${DATE_HELP}`);
  }
  if (!validDay(y, m, d)) throw validation(`Esa fecha no existe. ${DATE_HELP}`);
  return { year: y, month: m, day: d };
}

/** "21:30", "9:30pm", "9pm", "21h" → hora y minuto. */
export function parseTime(input: string): { hour: number; minute: number } {
  const s = input.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  const r = /^(\d{1,2})(?::|h)?(\d{2})?(am|pm|h)?$/.exec(s);
  if (!r) throw validation(`Hora no válida. ${TIME_HELP}`);
  let hour = Number(r[1]);
  const minute = r[2] ? Number(r[2]) : 0;
  const suffix = r[3];
  if (suffix === 'am' || suffix === 'pm') {
    if (hour < 1 || hour > 12) throw validation(`Hora no válida. ${TIME_HELP}`);
    hour = (hour % 12) + (suffix === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) throw validation(`Hora no válida. ${TIME_HELP}`);
  return { hour, minute };
}

/** Fecha + hora escritas por el club → instante UTC. */
export function parseLocalDateTime(day: string, time: string, tz: string, now: Date = new Date()): Date {
  return zonedToUtc({ ...parseDay(day, tz, now), ...parseTime(time) }, tz);
}

/** Marca de tiempo de Discord: cada usuario la ve en su propia hora local. */
export const discordTime = (d: Date | string, style: 'F' | 'R' | 'f' | 't' | 'D' = 'F') =>
  `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;
