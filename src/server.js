import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { clientesRouter } from './routes/clientes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();

// Detras de reverse proxy corporativo: confia en X-Forwarded-For para
// registrar la IP real del celular en la auditoria.
app.set('trust proxy', config.trustProxyHops);
app.disable('x-powered-by');

// --- Seguridad de cabeceras ---------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: config.env === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

// --- CORS (solo si se declara un origen distinto para la PWA) -----------
if (config.corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(express.json({ limit: '8kb' }));

// --- Log de acceso, con DNI redactado de la URL ------------------------
morgan.token('safeurl', (req) =>
  req.originalUrl.replace(/\/api\/clientes\/\d+/, '/api/clientes/[DNI]')
);
app.use(
  morgan(':remote-addr :method :safeurl :status :response-time ms', {
    skip: (req) => req.path === '/healthz',
  })
);

// --- API --------------------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api/clientes', clientesRouter);

app.get('/healthz', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// --- PWA estatica ---------------------------------------------------
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('service-worker.js')) {
        res.set('Cache-Control', 'no-cache');
      }
    },
  })
);
// Fallback SPA: cualquier ruta no-API devuelve la app.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`bot_cobranza_v2 escuchando en :${config.port}  (env=${config.env})`);
});

function shutdown(sig) {
  console.log(`\n${sig} recibido, cerrando...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
