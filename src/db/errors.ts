import { conflict, DomainError, notFound, validation } from '../core/errors.js';

/** Forma mínima de un error de PostgREST/Postgres devuelto por supabase-js. */
export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
}

/** Mensajes legibles para restricciones únicas conocidas. */
const UNIQUE_MESSAGES: Record<string, string> = {
  clubs_slug_key: 'Ese identificador de club ya está en uso.',
  club_memberships_active: 'Esa persona ya forma parte de la plantilla.',
  club_memberships_active_shirt: 'Ese dorsal ya está ocupado.',
  link_requests_one_pending: 'Ya tienes una solicitud pendiente en este club.',
  seasons_club_id_name_key: 'Ya existe una temporada con ese nombre.',
  club_channels_club_id_purpose_key: 'Ese propósito ya tiene un canal asignado.',
  provider_sync_runs_one_running: 'Ya hay una sincronización en curso.',
  external_players_one_link: 'Ese jugador ya está vinculado a otra ficha del proveedor.',
  club_ea_links_platform_ea_club_id_key: 'Ese club de EA ya está vinculado a otro club de PIRLO.',
};

/**
 * Convierte un error de base de datos en DomainError. Los detalles internos se descartan:
 * el mensaje resultante se puede mostrar al usuario.
 */
export function mapDbError(err: DbError): DomainError {
  switch (err.code) {
    case '23505': {
      const key = Object.keys(UNIQUE_MESSAGES).find((k) => err.message.includes(k));
      return conflict(key ? (UNIQUE_MESSAGES[key] as string) : 'Ese dato ya existe.');
    }
    case 'P0001':
      // Excepciones lanzadas a propósito en nuestras funciones: su mensaje ya es legible.
      return conflict(err.message);
    case 'P0002':
      return notFound('Registro');
    case '23503':
      return validation('Hace referencia a un dato que no existe o no pertenece a este club.');
    case '23514':
    case '22P02':
      return validation('Algún dato no es válido.');
    default:
      // Sin código Postgres conocido (p. ej. clave de API rechazada): se conserva el detalle para
      // los logs. El mensaje para el usuario sigue siendo genérico.
      return new DomainError('INTERNAL', 'No se pudo completar la operación. Inténtalo de nuevo.', {
        dbCode: err.code ?? null,
        dbMessage: err.message,
      });
  }
}

/** Lanza el error mapeado si la respuesta de supabase-js trae error. */
export function check<T>(res: { data: T; error: DbError | null }): T {
  if (res.error) throw mapDbError(res.error);
  return res.data;
}
