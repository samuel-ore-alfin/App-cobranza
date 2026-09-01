import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { registrar } from '../services/auditService.js';

// --- Rate limit del login (por IP) -----------------------------------------
export const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.rate.loginPerMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limit', mensaje: 'Demasiados intentos de login. Espera un minuto.' },
});

// --- Rate limit de la busqueda por DNI ------------------------------------
// Combina 3 topes: por agente/minuto, por agente/dia y global/dia. Ademas
// emite una alerta de anomalia (sin bloquear) si un agente supera el umbral
// de consultas por hora.
//
// Estado en memoria: valido para UNA instancia del backend (el caso on-prem
// tipico). Si en el futuro hay varias instancias, mover esto a un store
// compartido (Redis) o a un contador en Supabase.

const dia = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

const perMinuto = new Map();   // numero -> { ventana: epochMin, n }
const perDia = new Map();      // numero -> { d: 'YYYY-MM-DD', n }
const perHora = new Map();     // numero -> number[] (timestamps ms, ultima hora)
let global = { d: dia(), n: 0 };

function bump(map, key, limit) {
  const d = dia();
  const cur = map.get(key);
  if (!cur || cur.d !== d) {
    map.set(key, { d, n: 1 });
    return { ok: true, n: 1 };
  }
  cur.n += 1;
  return { ok: cur.n <= limit, n: cur.n };
}

export async function searchLimiter(req, res, next) {
  const numero = req.agente?.numero || 'desconocido';
  const nombre = req.agente?.nombre;
  const now = Date.now();
  const minWin = Math.floor(now / 60_000);

  // por minuto
  const m = perMinuto.get(numero);
  if (!m || m.ventana !== minWin) {
    perMinuto.set(numero, { ventana: minWin, n: 1 });
  } else {
    m.n += 1;
    if (m.n > config.rate.searchPerMinute) {
      await registrar({
        numero, nombre, accion: 'rate_limit_excedido', ip: req.ip,
        userAgent: req.get('user-agent'), detalle: `por_minuto n=${m.n}`,
      });
      return res.status(429).json({
        error: 'rate_limit', mensaje: 'Vas muy rapido. Espera unos segundos.',
      });
    }
  }

  // global por dia
  const d = dia();
  if (global.d !== d) global = { d, n: 0 };
  global.n += 1;
  if (global.n > config.rate.searchGlobalPerDay) {
    await registrar({
      numero, nombre, accion: 'rate_limit_excedido', ip: req.ip,
      userAgent: req.get('user-agent'), detalle: `global_dia n=${global.n}`,
    });
    return res.status(429).json({
      error: 'rate_limit_global',
      mensaje: 'Se alcanzo el limite diario global de consultas. Contacta al administrador.',
    });
  }

  // por agente por dia
  const pd = bump(perDia, numero, config.rate.searchPerDay);
  if (!pd.ok) {
    await registrar({
      numero, nombre, accion: 'rate_limit_excedido', ip: req.ip,
      userAgent: req.get('user-agent'), detalle: `por_dia n=${pd.n}`,
    });
    return res.status(429).json({
      error: 'rate_limit_dia',
      mensaje: 'Alcanzaste el limite de consultas por hoy. Se reinicia mañana.',
    });
  }

  // alerta de anomalia por hora (no bloquea)
  const arr = (perHora.get(numero) || []).filter((t) => now - t < 3_600_000);
  arr.push(now);
  perHora.set(numero, arr);
  if (arr.length === config.rate.searchAnomalyPerHour + 1) {
    await registrar({
      numero, nombre, accion: 'alerta_anomalia', ip: req.ip,
      userAgent: req.get('user-agent'),
      detalle: `${arr.length} consultas en 60 min (umbral ${config.rate.searchAnomalyPerHour})`,
    });
    console.warn(`[anomalia] agente ${numero} supero ${config.rate.searchAnomalyPerHour} consultas/hora`);
  }

  next();
}
