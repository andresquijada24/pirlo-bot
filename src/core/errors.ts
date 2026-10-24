/**
 * Errores de dominio. Su `message` está pensado para mostrarse al usuario en Discord
 * (en español, sin detalles internos). El `code` sirve para registros y pruebas.
 */
export type DomainErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'CLUB_NOT_REGISTERED'
  | 'CLUB_AMBIGUOUS'
  | 'NOT_A_MEMBER'
  | 'INTERNAL';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const permissionDenied = (msg = 'No tienes permiso para hacer esto en este club.') =>
  new DomainError('PERMISSION_DENIED', msg);
export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} no encontrado.`);
export const conflict = (msg: string) => new DomainError('CONFLICT', msg);
export const validation = (msg: string) => new DomainError('VALIDATION', msg);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
