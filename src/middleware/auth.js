import { validarSesion, AuthError } from '../services/authService.js';
import { registrar } from '../services/auditService.js';

function extraerToken(req) {
  const h = req.get('authorization') || '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9]+)$/);
  return m ? m[1] : null;
}

// Protege rutas: exige bearer token valido y adjunta req.agente.
export async function requiereSesion(req, res, next) {
  try {
    const token = extraerToken(req);
    const ctx = await validarSesion(token);
    req.agente = ctx;
    req.sessionToken = token;
    res.set('X-Session-Expira', ctx.expiraEn);
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'sesion_expirada') {
        registrar({ accion: 'sesion_expirada', ip: req.ip, userAgent: req.get('user-agent') });
      }
      return res.status(err.httpStatus).json({ error: err.code, mensaje: err.message });
    }
    next(err);
  }
}
