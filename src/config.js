import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return v;
}

function num(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`La variable ${name} debe ser numerica`);
  return n;
}

function bool(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return raw === 'true' || raw === '1';
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num('PORT', 3000),
  trustProxyHops: num('TRUST_PROXY_HOPS', 0),
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  sqlserver: {
    host: req('SQLSERVER_HOST'),
    instance: process.env.SQLSERVER_INSTANCE || undefined,
    port: num('SQLSERVER_PORT', 1433),
    database: req('SQLSERVER_DATABASE'),
    user: req('SQLSERVER_USER'),
    password: req('SQLSERVER_PASSWORD'),
    // Objeto a consultar. Por defecto la tabla base (misma fuente que la v1);
    // si el DBA crea la vista restringida dbo.VW_BOT_COBRANZA_CAMPO se apunta
    // aqui a esa vista. Se interpola en el texto SQL -> se restringe a un
    // identificador de objeto valido.
    source: (() => {
      const v =
        process.env.SQLSERVER_SOURCE ||
        process.env.SQLSERVER_VIEW ||
        'BI..BD_BOT_CLIENTES';
      if (!/^[A-Za-z0-9_.\[\]]+$/.test(v)) {
        throw new Error('SQLSERVER_SOURCE contiene caracteres no permitidos');
      }
      return v;
    })(),
    encrypt: bool('SQLSERVER_ENCRYPT', true),
    trustServerCertificate: bool('SQLSERVER_TRUST_SERVER_CERT', true),
    connectTimeout: num('SQLSERVER_CONNECT_TIMEOUT_MS', 15000),
    requestTimeout: num('SQLSERVER_REQUEST_TIMEOUT_MS', 15000),
  },

  supabase: {
    url: req('SUPABASE_URL'),
    serviceRoleKey: req('SUPABASE_SERVICE_ROLE_KEY'),
    schema: process.env.SUPABASE_SCHEMA || 'public',
  },

  auth: {
    activationCode: req('AGENTE_ACTIVATION_CODE'),
    sessionTtlMinutes: num('SESSION_TTL_MINUTES', 60),
    loginMaxAttempts: num('LOGIN_MAX_ATTEMPTS', 5),
    loginLockMinutes: num('LOGIN_LOCK_MINUTES', 15),
    bcryptRounds: num('BCRYPT_ROUNDS', 12),
  },

  rate: {
    searchPerMinute: num('SEARCH_RATE_PER_MINUTE', 10),
    searchPerDay: num('SEARCH_RATE_PER_DAY', 300),
    searchGlobalPerDay: num('SEARCH_RATE_GLOBAL_PER_DAY', 5000),
    searchAnomalyPerHour: num('SEARCH_ANOMALY_PER_HOUR', 60),
    loginPerMinute: num('LOGIN_RATE_PER_MINUTE', 10),
  },
};
