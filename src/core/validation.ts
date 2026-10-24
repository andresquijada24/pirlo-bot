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

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Identificador de Discord inválido.');

/** Valida con zod y convierte el primer error en un DomainError legible. */
export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw validation(r.error.issues[0]?.message ?? 'Dato inválido.');
  return r.data;
}
