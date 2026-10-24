import { z } from 'zod';
import { validation } from './errors.js';

/** Esquemas de entrada compartidos. Reflejan las restricciones CHECK de la base de datos. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(40, 'El identificador admite hasta 40 caracteres.')
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'El identificador solo admite letras minúsculas, números y guiones (p. ej. maritimo-cf).',
  );

export const clubNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío.')
  .max(80, 'El nombre admite hasta 80 caracteres.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío.')
  .max(60, 'El nombre admite hasta 60 caracteres.');

export const gamertagSchema = z
  .string()
  .trim()
  .max(40, 'El gamertag admite hasta 40 caracteres.')
  .transform((v) => (v === '' ? null : v))
  .nullable();

export const seasonNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre de la temporada no puede estar vacío.')
  .max(60, 'El nombre de la temporada admite hasta 60 caracteres.');

/**
 * Fecha de calendario. Acepta AAAA-MM-DD o DD/MM/AAAA (como se escribe en español) y devuelve
 * AAAA-MM-DD. Rechaza fechas que no existen (p. ej. 31/02/2026).
 */
export const calendarDateSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    const es = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    const [y, m, d] = iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : es
        ? [Number(es[3]), Number(es[2]), Number(es[1])]
        : [NaN, NaN, NaN];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      !Number.isFinite(y) ||
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha no válida. Usa DD/MM/AAAA, p. ej. 18/09/2026.' });
      return z.NEVER;
    }
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Identificador de Discord inválido.');

/** Valida con zod y convierte el primer error en un DomainError legible. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw validation(r.error.issues[0]?.message ?? 'Dato inválido.');
  return r.data;
}
