// Crea (o actualiza) la vista dbo.VW_BOT_COBRANZA_CAMPO en SQL Server usando
// las MISMAS env vars que la app (SQLSERVER_*). Correr una sola vez:
//
//   node scripts/setup-sqlserver-view.mjs
//
// Requiere que la cuenta SQLSERVER_USER tenga permiso CREATE VIEW en la base
// BI. Si da "permission denied", lo tiene que correr el DBA.

import sql from 'mssql';
import { config } from '../src/config.js';

// Vista pass-through: mismos nombres de columna que la tabla, solo las
// necesarias. La app funciona igual apuntando a la tabla o a esta vista.
const VIEW_SQL = `
CREATE OR ALTER VIEW dbo.VW_BOT_COBRANZA_CAMPO AS
SELECT
  c.DNI, c.NOMBRECLIENTE, c.TELF_1, c.TELF_2, c.DIRECCION, c.DISTRITO,
  c.PROVINCIA, c.DEPARTAMENTO, c.Deuda_Actual, c.CAPITAL, c.Cuota_MayorAtraso,
  c.DIA_ATRASO, c.FECHAPROXPAGO, c.ESTATUS_CLIENTE, c.PDP_PENDIENTE_CALL,
  c.CAMP_LIQUIDACION, c.CAMP_REFINANCIADO, c.FEC_GESTION_CAMPO, c.REACCION_CAMPO,
  c.OBS_CAMPO, c.NOMBRE_EDC, c.GERENCIA, c.REGION, c.CUENTA_BT
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
