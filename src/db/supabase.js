import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Cliente Supabase por API REST (PostgREST). Se usa REST y no conexion
// directa a Postgres porque el firewall del banco bloquea 5432/6543 desde
// la red interna (documentado en el README de la v1).
//
// Reutiliza las tablas de la v1 (bot de WhatsApp, dado de baja) en el
// esquema `public`: usuarios_autorizados, sesiones, auditoria — extendidas
// con columnas nuevas via migracion aditiva (db/02_supabase_schema_v2.sql).
//
// La Service Role Key evita RLS: por eso el modelo append-only de la tabla
// `auditoria` NO se apoya en RLS, sino en un trigger de base que rechaza
// UPDATE/DELETE para cualquier rol (ver db/02_supabase_schema_v2.sql).

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: config.supabase.schema },
  }
);

export function tabla(nombre) {
  return supabase.from(nombre);
}
