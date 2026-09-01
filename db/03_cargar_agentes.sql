-- ============================================================================
-- bot_cobranza_v2 — agentes
-- Los 128 agentes del HC AGO26 YA ESTAN cargados en `usuarios_autorizados`
-- (se reutiliza la tabla de la v1 del bot de WhatsApp, dado de baja). NO hay
-- que volver a insertarlos. Este archivo solo trae la verificacion y el
-- template para altas nuevas — ver docs/ALTA_DE_AGENTES.md para el resto de
-- operaciones (baja, bloqueo, reset de PIN).
-- ============================================================================

-- Verificacion: deberia dar 128 (o mas, si ya diste de alta agentes nuevos).
select count(*) as total_agentes from usuarios_autorizados;

-- Deberian salir en NULL / 0 / false para todos hasta que cada agente active
-- su PIN por primera vez desde la app.
select numero, nombre, activo, pin_hash, intentos_fallidos, bloqueado_hasta
from usuarios_autorizados
order by nombre
limit 10;

-- ----------------------------------------------------------------------------
-- Alta de UN agente nuevo (fuera del HC original):
-- ----------------------------------------------------------------------------
-- insert into usuarios_autorizados (numero, nombre)
-- values ('51900000000', 'APELLIDOS, NOMBRES')
-- on conflict (numero) do nothing;
--
-- No se inserta el PIN aqui: el agente lo define en su primer ingreso con el
-- codigo de activacion (AGENTE_ACTIVATION_CODE del .env). pin_hash queda NULL
-- hasta entonces. El trigger `trg_crear_sesion` (ya existente de la v1) crea
-- automaticamente su fila en `sesiones`.
