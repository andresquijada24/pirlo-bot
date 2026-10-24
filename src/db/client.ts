import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase SOLO para el servidor. Usa la clave de servicio, que nunca debe salir
 * del backend (ni a Discord, ni a logs, ni a un frontend).
 */
export function createServerClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: 'public' },
  });
}
