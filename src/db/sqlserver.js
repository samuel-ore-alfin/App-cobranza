import sql from 'mssql';
import { config } from '../config.js';

// Pool unico hacia SQL Server. La cuenta configurada debe ser de SOLO LECTURA
// sobre SQLSERVER_SOURCE (por defecto la tabla base; idealmente una vista
// restringida creada por el DBA — ver db/01_sqlserver_create_view.sql).

const poolConfig = {
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
  requestTimeout: config.sqlserver.requestTimeout,
  pool: { max: 8, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;

export function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(poolConfig)
      .connect()
      .catch((err) => {
        poolPromise = null; // permite reintentar en la proxima llamada
        throw err;
      });
  }
  return poolPromise;
}

export { sql };
