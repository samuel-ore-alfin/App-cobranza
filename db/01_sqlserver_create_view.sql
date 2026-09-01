/* ============================================================================
   bot_cobranza_v2 — Vista restringida + login dedicado (ENDURECIMIENTO DBA)
   ----------------------------------------------------------------------------
   NO es imprescindible para que la app funcione: por defecto la app consulta
   BI..BD_BOT_CLIENTES directo (igual que la v1) con la cuenta existente.
   Esto es el hardening que pide el brief: una cuenta de SOLO LECTURA con
   acceso UNICAMENTE a una vista que expone solo las columnas necesarias.

   Ejecutar en:  10.165.42.10  (BDRIESGOS\PROD)  base de datos  BI
   Requiere una cuenta con permisos de servidor (securityadmin/sysadmin) para
   el CREATE LOGIN -> normalmente lo corre el DBA.

   La vista NO renombra columnas (deja los nombres crudos de la tabla): asi la
   app funciona igual apuntando a la tabla o a la vista. El enmascarado de la
   cuenta y el formato de fechas los hace la app.
   ============================================================================ */

CREATE OR ALTER VIEW dbo.VW_BOT_COBRANZA_CAMPO
AS
SELECT
    c.DNI,
    c.NOMBRECLIENTE,
    c.TELF_1,
    c.TELF_2,
    c.DIRECCION,
    c.DISTRITO,
    c.PROVINCIA,
    c.DEPARTAMENTO,
    c.Deuda_Actual,
    c.CAPITAL,
    c.Cuota_MayorAtraso,
    c.DIA_ATRASO,
    c.FECHAPROXPAGO,
    c.ESTATUS_CLIENTE,
    c.PDP_PENDIENTE_CALL,
    c.CAMP_LIQUIDACION,
    c.CAMP_REFINANCIADO,
    c.FEC_GESTION_CAMPO,
    c.REACCION_CAMPO,
    c.OBS_CAMPO,
    c.NOMBRE_EDC,
    c.GERENCIA,
    c.REGION,
    c.CUENTA_BT
FROM BI..BD_BOT_CLIENTES AS c;
GO

/* --- Login de SOLO LECTURA con acceso unicamente a la vista ---------------- */

-- 1) En master:
--    CREATE LOGIN app_bot_cobranza WITH PASSWORD = 'PON_UNA_CLAVE_FUERTE', CHECK_POLICY = ON;

-- 2) En BI:
USE BI;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'app_bot_cobranza')
    CREATE USER app_bot_cobranza FOR LOGIN app_bot_cobranza;
GO

-- 3) Permiso minimo: SELECT solo sobre la vista.
GRANT SELECT ON dbo.VW_BOT_COBRANZA_CAMPO TO app_bot_cobranza;
GO

-- 4) Pruebas:
--    EXECUTE AS USER = 'app_bot_cobranza';
--      SELECT TOP 1 * FROM dbo.VW_BOT_COBRANZA_CAMPO;   -- debe devolver filas
--      SELECT TOP 1 * FROM dbo.BD_BOT_CLIENTES;         -- debe FALLAR por permiso
--    REVERT;

/* Cuando esto este hecho, en las env vars de la app:
     SQLSERVER_USER=app_bot_cobranza
     SQLSERVER_PASSWORD=<la clave del login>
     SQLSERVER_SOURCE=dbo.VW_BOT_COBRANZA_CAMPO
   y redeploy. */
