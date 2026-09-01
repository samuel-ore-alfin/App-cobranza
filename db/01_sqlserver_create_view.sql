/* ============================================================================
   bot_cobranza_v2 — Vista de solo lectura para la app de agentes de campo
   ----------------------------------------------------------------------------
   Ejecutar en:  instancia BDRIESGOS\PROD  ->  base de datos  BI
   Ejecutalo TU con tus credenciales. La app NO tiene acceso para crear esto.

   Antes de ejecutar, confirma con el DBA:
     1) Esquema real de la tabla base:
          SELECT SCHEMA_NAME(schema_id) AS esquema
          FROM sys.tables WHERE name = 'BD_BOT_CLIENTES';
        (se asume dbo; si es otro, ajusta el FROM de abajo)
     2) Tipo de la columna DNI (char(8) / varchar(8) / nvarchar):
          SELECT c.name, t.name AS tipo, c.max_length
          FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
          WHERE c.object_id = OBJECT_ID('dbo.BD_BOT_CLIENTES') AND c.name = 'DNI';

   Frescura del dato: la tabla base la repuebla un ETL de Planeamiento
   Cobranza cada hora al minuto :30. La vista hereda ese desfase (~1h max).

   Campos expuestos: solo los necesarios para la gestion de campo.
   NO se exponen: correo, cronograma completo, historial de pagos,
   numero de cuenta completo (se enmascara a los ultimos 4), scoring,
   datos de terceros/avales.
   ============================================================================ */

CREATE OR ALTER VIEW dbo.VW_BOT_COBRANZA_CAMPO
AS
SELECT
    -- identificador de consulta
    CONVERT(varchar(8), c.DNI)                                   AS dni,

    -- identificacion del cliente
    RTRIM(c.NOMBRECLIENTE)                                       AS nombre_completo,
    NULLIF(RTRIM(LTRIM(CONVERT(varchar(30), c.TELF_1))), '')     AS telefono_1,
    NULLIF(RTRIM(LTRIM(CONVERT(varchar(30), c.TELF_2))), '')     AS telefono_2,

    -- ubicacion (para ruteo de visita)
    NULLIF(RTRIM(c.DIRECCION), '')                               AS direccion,
    NULLIF(RTRIM(c.DISTRITO), '')                                AS distrito,
    NULLIF(RTRIM(c.PROVINCIA), '')                               AS provincia,
    NULLIF(RTRIM(c.DEPARTAMENTO), '')                            AS departamento,

    -- deuda / gestion
    c.Deuda_Actual                                              AS monto_adeudado,
    c.CAPITAL                                                   AS capital,
    c.Cuota_MayorAtraso                                         AS cuota_mayor_atraso,
    c.DIA_ATRASO                                                AS dias_atraso,
    CONVERT(varchar(10), TRY_CONVERT(date, c.FECHAPROXPAGO), 23) AS fecha_prox_pago,
    NULLIF(RTRIM(c.ESTATUS_CLIENTE), '')                         AS estatus_cliente,
    NULLIF(RTRIM(CONVERT(varchar(50), c.PDP_PENDIENTE_CALL)), '') AS pdp_pendiente,

    -- ofertas disponibles en el momento
    NULLIF(RTRIM(c.CAMP_LIQUIDACION), 'Sin_Campaña')             AS camp_liquidacion,
    NULLIF(RTRIM(c.CAMP_REFINANCIADO), 'Sin_Campaña')            AS camp_refinanciado,

    -- ultima gestion de campo (1 registro, NO historial)
    CONVERT(varchar(10), TRY_CONVERT(date, c.FEC_GESTION_CAMPO), 23) AS fec_ultima_gestion_campo,
    NULLIF(RTRIM(c.REACCION_CAMPO), '')                          AS ultima_reaccion_campo,
    NULLIF(RTRIM(c.OBS_CAMPO), '')                               AS ultima_obs_campo,

    -- titularidad de la gestion (hoy solo se muestra; validacion server-side
    -- lista para activar cuando cada agente tenga cargado su nombre_edc)
    NULLIF(RTRIM(c.NOMBRE_EDC), '')                              AS gestor_asignado,
    NULLIF(RTRIM(c.GERENCIA), '')                                AS gerencia,
    NULLIF(RTRIM(c.REGION), '')                                  AS region,

    -- referencia de cuenta ENMASCARADA (ultimos 4). El numero completo
    -- nunca sale de SQL Server.
    RIGHT(RTRIM(CONVERT(varchar(50), c.CUENTA_BT)), 4)           AS cuenta_ref_mask
FROM BI.dbo.BD_BOT_CLIENTES AS c;
GO

/* ----------------------------------------------------------------------------
   Cuenta de servicio de SOLO LECTURA para la app.
   Crea el login/usuario y da permiso UNICAMENTE sobre la vista.
   Cambia 'PON_UNA_CLAVE_FUERTE_AQUI' y guardala en el .env del backend
   (SQLSERVER_USER / SQLSERVER_PASSWORD). NO reutilices una cuenta con escritura.
   ---------------------------------------------------------------------------- */

-- 1) Login a nivel de servidor (ejecutar en la base 'master' o con permisos):
--    CREATE LOGIN app_bot_cobranza WITH PASSWORD = 'PON_UNA_CLAVE_FUERTE_AQUI',
--        CHECK_POLICY = ON;

-- 2) Usuario dentro de la base BI:
USE BI;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'app_bot_cobranza')
    CREATE USER app_bot_cobranza FOR LOGIN app_bot_cobranza;
GO

-- 3) Permiso minimo: SELECT solo sobre la vista, nada mas.
GRANT SELECT ON dbo.VW_BOT_COBRANZA_CAMPO TO app_bot_cobranza;
GO

-- 4) Verificacion: esto debe devolver filas...
--    EXECUTE AS USER = 'app_bot_cobranza';
--    SELECT TOP 1 * FROM dbo.VW_BOT_COBRANZA_CAMPO;
--    REVERT;
-- ...y esto debe FALLAR con error de permiso (correcto):
--    EXECUTE AS USER = 'app_bot_cobranza';
--    SELECT TOP 1 * FROM dbo.BD_BOT_CLIENTES;
--    REVERT;
