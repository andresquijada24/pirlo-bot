import { z } from 'zod';

/**
 * Esquemas de las respuestas de api_v1 de MARÍTIMO CF (docs/integrations/maritimo-api-v1.md).
 * Toda respuesta se valida: si el proveedor cambia el formato, la sincronización falla de forma
 * explícita en vez de guardar datos incorrectos.
 */

const iso = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().nullable();

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: z.string().min(1).nullable(),
    server_time: iso,
  });

export const estadoSchema = z.object({
  version: z.string(),
  club: z.object({ nombre: z.string() }),
  server_time: iso,
});

export const jugadorSchema = z.object({
  id: z.string().min(1),
  gamertag: z.string().min(1),
  plataforma: z.enum(['ps', 'xbox', 'pc']).nullable(),
  pos1: z.string().nullable(),
  posiciones: z.array(z.string()),
  dorsal: z.number().int().nullable(),
  foto_url: z.string().nullable(),
  estado: z.enum(['activo', 'baja', 'pendiente', 'rechazado']),
  en_plantilla: z.boolean(),
  actualizado_at: iso,
});

export const jugadorSesionSchema = z
  .object({
    jugador_id: z.string().min(1).nullable(),
    gamertag: z.string().min(1),
    partidos_jugados: count,
    nota: z.number().min(0).max(10).nullable(),
    goles: count,
    asistencias: count,
    goles_manuales: count,
    asistencias_manuales: count,
    tiros: count,
    regates: count,
    pases_ok: count,
    pases_tot: count,
    entradas_ok: count,
    entradas_tot: count,
    intercepciones: count,
    bloqueos: count,
    despejes: count,
    paradas: count,
  })
  .refine((j) => j.pases_ok === null || j.pases_tot === null || j.pases_ok <= j.pases_tot, {
    message: 'pases_ok > pases_tot',
  })
  .refine((j) => j.entradas_ok === null || j.entradas_tot === null || j.entradas_ok <= j.entradas_tot, {
    message: 'entradas_ok > entradas_tot',
  });

export const sesionSchema = z.object({
  id: z.string().min(1),
  publicada_at: iso,
  fecha_juego: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partidos: count,
  victorias: count,
  empates: count,
  derrotas: count,
  duplicada_de: z.string().min(1).nullable(),
  actualizado_at: iso,
  jugadores: z.array(jugadorSesionSchema),
});

export const partidoSchema = z.object({
  id: z.string().min(1),
  competicion: z.enum(['relampago', 'torneo', 'amistoso', 'liga', 'copa']),
  nombre: z.string().nullable(),
  rival: z.string().nullable(),
  inicio: iso,
  estado: z.string().min(1),
  goles_favor: count,
  goles_contra: count,
  actualizado_at: iso,
});

export const eliminadoSchema = z.object({
  tipo: z.enum(['jugador', 'sesion', 'partido']),
  id: z.string().min(1),
  eliminado_at: iso,
});
