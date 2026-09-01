// Crea (o actualiza) la vista dbo.VW_BOT_COBRANZA_CAMPO en SQL Server usando
// las MISMAS env vars que la app (SQLSERVER_*). Correr una sola vez:
//
//   node scripts/setup-sqlserver-view.mjs
//
// Requiere que la cuenta SQLSERVER_USER tenga permiso CREATE VIEW en la base
// BI. Si da "permission denied", lo tiene que correr el DBA.

import sql from 'mssql';
import { config } from '../src/config.js';

const VIEW_SQL = `
CREATE OR ALTER VIEW dbo.VW_BOT_COBRANZA_CAMPO AS
SELECT
  CONVERT(varchar(8), c.DNI)                                       AS dni,
  RTRIM(c.NOMBRECLIENTE)                                           AS nombre_completo,
  NULLIF(RTRIM(LTRIM(CONVERT(varchar(30), c.TELF_1))), '')         AS telefono_1,
  NULLIF(RTRIM(LTRIM(CONVERT(varchar(30), c.TELF_2))), '')         AS telefono_2,
  NULLIF(RTRIM(c.DIRECCION), '')                                   AS direccion,
  NULLIF(RTRIM(c.DISTRITO), '')                                    AS distrito,
  NULLIF(RTRIM(c.PROVINCIA), '')                                   AS provincia,
  NULLIF(RTRIM(c.DEPARTAMENTO), '')                                AS departamento,
  c.Deuda_Actual                                                  AS monto_adeudado,
  c.CAPITAL                                                       AS capital,
  c.Cuota_MayorAtraso                                             AS cuota_mayor_atraso,
  c.DIA_ATRASO                                                    AS dias_atraso,
  CONVERT(varchar(10), TRY_CONVERT(date, c.FECHAPROXPAGO), 23)     AS fecha_prox_pago,
  NULLIF(RTRIM(c.ESTATUS_CLIENTE), '')                             AS estatus_cliente,
  NULLIF(RTRIM(CONVERT(varchar(50), c.PDP_PENDIENTE_CALL)), '')    AS pdp_pendiente,
  NULLIF(RTRIM(c.CAMP_LIQUIDACION), 'Sin_Campana')                 AS camp_liquidacion,
  NULLIF(RTRIM(c.CAMP_REFINANCIADO), 'Sin_Campana')                AS camp_refinanciado,
  CONVERT(varchar(10), TRY_CONVERT(date, c.FEC_GESTION_CAMPO), 23) AS fec_ultima_gestion_campo,
  NULLIF(RTRIM(c.REACCION_CAMPO), '')                              AS ultima_reaccion_campo,
  NULLIF(RTRIM(c.OBS_CAMPO), '')                                   AS ultima_obs_campo,
  NULLIF(RTRIM(c.NOMBRE_EDC), '')                                  AS gestor_asignado,
  NULLIF(RTRIM(c.GERENCIA), '')                                    AS gerencia,
  NULLIF(RTRIM(c.REGION), '')                                      AS region,
  RIGHT(RTRIM(CONVERT(varchar(50), c.CUENTA_BT)), 4)               AS cuenta_ref_mask
FROM BI..BD_BOT_CLIENTES AS c;
`;

const cfg = {
  server: config.sqlserver.host,
  port: config.sqlserver.port,
  database: config.sqlserver.database,
  user: config.sqlserver.user,
  password: config.sqlserver.password,
  options: {
    encrypt: config.sqlserver.encrypt,
    trustServerCertificate: config.sqlserver.trustServerCertificate,
    enableArithAbort: true,
    ...(config.sqlserver.instance ? { instanceName: config.sqlserver.instance } : {}),
  },
  connectionTimeout: config.sqlserver.connectTimeout,
  requestTimeout: 30000,
};

try {
  console.log(`Conectando a ${cfg.server}:${cfg.port}/${cfg.database} como ${cfg.user} ...`);
  const pool = await sql.connect(cfg);
  console.log('Conectado. Creando/actualizando dbo.VW_BOT_COBRANZA_CAMPO ...');
  await pool.request().batch(VIEW_SQL);
  const test = await pool.request().query('SELECT TOP (1) * FROM dbo.VW_BOT_COBRANZA_CAMPO');
  console.log('OK. Columnas de la vista:', Object.keys(test.recordset.columns).join(', '));
  console.log(`Filas de prueba devueltas: ${test.recordset.length}`);
  await pool.close();
  console.log('Listo.');
  process.exit(0);
} catch (err) {
  console.error('ERROR:', err.message);
  if (/permission|denied/i.test(err.message)) {
    console.error('-> La cuenta no puede crear vistas. Debe correrlo el DBA (ver db/01_sqlserver_create_view.sql).');
  }
  process.exit(1);
}
