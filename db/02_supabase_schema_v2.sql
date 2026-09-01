-- ============================================================================
-- bot_cobranza_v2 — MIGRACION sobre las tablas existentes de Supabase
-- ----------------------------------------------------------------------------
-- El bot de WhatsApp (v1) esta dado de baja. La v2 REUTILIZA las mismas
-- tablas en el esquema `public` (usuarios_autorizados, sesiones, auditoria)
-- en vez de crear un esquema nuevo: mismos 128 agentes ya cargados, mismo
-- historial de auditoria (se conserva por compliance).
--
-- Esta migracion es ADITIVA: solo agrega columnas y triggers nuevos. No
-- borra ni modifica columnas ni filas existentes de v1 (password_hash,
-- password_salt, estado, intentos, autenticado_expira quedan intactas y sin
-- uso por la v2 — se pueden limpiar mas adelante si se confirma que nadie
-- las necesita).
--
-- Ejecutar en el SQL Editor de Supabase (proyecto Pro, el mismo de la v1).
-- Es seguro correrlo varias veces (todo con IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- usuarios_autorizados: agrega credencial de PIN para la app movil.
-- IMPORTANTE: el PIN NO reutiliza password_hash/password_salt (esas son del
-- hash propio FNV-1a que usaba n8n por no tener `crypto` disponible, y son
-- para una contraseña de longitud libre, no un PIN de 6 digitos). El backend
-- v2 usa bcrypt sobre esta columna nueva.
-- ----------------------------------------------------------------------------
alter table usuarios_autorizados add column if not exists pin_hash             text;
alter table usuarios_autorizados add column if not exists pin_actualizado_en   timestamptz;
alter table usuarios_autorizados add column if not exists intentos_fallidos    int not null default 0;
alter table usuarios_autorizados add column if not exists bloqueado_hasta      timestamptz;
-- Opcional, para validar titularidad de cartera a futuro (ver ALTA_DE_AGENTES.md).
alter table usuarios_autorizados add column if not exists nombre_edc           text;

-- ----------------------------------------------------------------------------
-- sesiones: agrega el modelo de token Bearer de la app movil, sin tocar las
-- columnas del bot (estado, intentos, autenticado_expira). `numero` ya es
-- primary key -> se mantiene "una sesion activa por agente" (cada login
-- pisa la fila anterior de ese agente, invalidandola).
-- ----------------------------------------------------------------------------
alter table sesiones add column if not exists token_hash        text;
alter table sesiones add column if not exists expira_en         timestamptz;
alter table sesiones add column if not exists ultima_actividad  timestamptz;
alter table sesiones add column if not exists revocada          boolean not null default false;
alter table sesiones add column if not exists ip                text;
alter table sesiones add column if not exists user_agent        text;

create unique index if not exists idx_sesiones_token_hash
  on sesiones (token_hash) where token_hash is not null;

-- ----------------------------------------------------------------------------
-- auditoria: agrega resultado/ip/user_agent (la v1 solo tenia `detalle`).
-- ----------------------------------------------------------------------------
alter table auditoria add column if not exists resultado   text;
alter table auditoria add column if not exists ip          text;
alter table auditoria add column if not exists user_agent  text;

create index if not exists idx_auditoria_accion on auditoria (accion);

-- ----------------------------------------------------------------------------
-- APPEND-ONLY: la v1 no lo tenia. Requisito de la v2 (Ley N° 29733) — se
-- aplica retroactivamente a TODA la tabla, beneficiando tambien el historial
-- del bot. Bloquea UPDATE/DELETE para cualquier rol, incluido service_role
-- (la Service Role Key ignora RLS, por eso la garantia real es este trigger,
-- no una politica RLS).
-- ----------------------------------------------------------------------------
create or replace function auditoria_bloquear_cambios()
returns trigger language plpgsql as $$
begin
  raise exception 'auditoria es append-only: % no permitido', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_auditoria_no_update on auditoria;
create trigger trg_auditoria_no_update
  before update on auditoria
  for each row execute function auditoria_bloquear_cambios();

drop trigger if exists trg_auditoria_no_delete on auditoria;
create trigger trg_auditoria_no_delete
  before delete on auditoria
  for each row execute function auditoria_bloquear_cambios();

-- Nota: el trigger de v1 `trg_auditoria_creado_en_pe` (before insert or
-- update of creado_en) sigue funcionando igual para los INSERT — no colisiona
-- con el bloqueo de arriba porque los UPDATE ahora nunca llegan a ejecutarse.

-- ----------------------------------------------------------------------------
-- Defensa en profundidad: RLS activo, sin politicas para anon/authenticated.
-- El backend usa la Service Role Key (bypassa RLS) — la API publica (anon
-- key) no debe poder leer ni escribir nada de estas 3 tablas.
-- ----------------------------------------------------------------------------
alter table usuarios_autorizados enable row level security;
alter table sesiones             enable row level security;
alter table auditoria            enable row level security;

revoke all on usuarios_autorizados from anon, authenticated;
revoke all on sesiones             from anon, authenticated;
revoke all on auditoria            from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Helper para el administrador: desbloquear un agente al instante.
--   select desbloquear_agente('51999999999');
-- ----------------------------------------------------------------------------
create or replace function desbloquear_agente(p_numero text)
returns void language sql as $$
  update usuarios_autorizados
     set bloqueado_hasta = null, intentos_fallidos = 0
   where numero = p_numero;
$$;

-- ----------------------------------------------------------------------------
-- Verificacion post-migracion
-- ----------------------------------------------------------------------------
-- select count(*) from usuarios_autorizados;                 -- deberia dar 128
-- select numero, nombre, pin_hash, activo from usuarios_autorizados limit 5;
-- select column_name from information_schema.columns where table_name = 'sesiones';
