import { Router } from 'express';
import { login, activarPin, logout, AuthError } from '../services/authService.js';
import { registrar } from '../services/auditService.js';
import { requiereSesion } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { normalizarNumero } from '../lib/validators.js';

export const authRouter = Router();

// POST /api/auth/login  { numero, pin }
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const ip = req.ip;
    const userAgent = req.get('user-agent');
    const numero = normalizarNumero(req.body?.numero);
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';

    if (!numero) {
      return res.status(400).json({ error: 'numero_invalido', mensaje: 'Numero de telefono invalido.' });
    }
    if (!/^[0-9]{6}$/.test(pin)) {
      return res.status(400).json({ error: 'pin_invalido', mensaje: 'El PIN debe tener 6 digitos.' });
    }

    const r = await login({ numero, pin, ip, userAgent });

    if (r.estado === 'requiere_activacion') {
      await registrar({ numero, nombre: r.agente?.nombre, accion: 'requiere_activacion', ip, userAgent });
      return res.status(200).json({
        estado: 'requiere_activacion',
        mensaje: 'Este numero aun no tiene PIN. Actívalo con tu codigo de activacion.',
      });
    }

    await registrar({ numero, nombre: r.agente.nombre, accion: 'login_ok', ip, userAgent });
    return res.status(200).json({
      estado: 'ok',
      token: r.token,
      expira_en: r.expiraEn,
      agente: r.agente,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const numero = normalizarNumero(req.body?.numero);
      const accion = err.code === 'cuenta_bloqueada' ? 'login_bloqueado' : 'login_fallido';
      await registrar({ numero, accion, ip: req.ip, userAgent: req.get('user-agent'), detalle: err.code });
      return res.status(err.httpStatus).json({ error: err.code, mensaje: err.message });
    }
    next(err);
  }
});

// POST /api/auth/activar  { numero, codigo_activacion, pin, pin_repeat }
authRouter.post('/activar', loginLimiter, async (req, res, next) => {
  try {
    const ip = req.ip;
    const userAgent = req.get('user-agent');
    const numero = normalizarNumero(req.body?.numero);
    if (!numero) {
      return res.status(400).json({ error: 'numero_invalido', mensaje: 'Numero de telefono invalido.' });
    }
    const r = await activarPin({
      numero,
      codigoActivacion: String(req.body?.codigo_activacion ?? ''),
      pin: String(req.body?.pin ?? ''),
      pinRepeat: String(req.body?.pin_repeat ?? ''),
    });
    await registrar({ numero, nombre: r.agente?.nombre, accion: 'pin_activado', ip, userAgent });
    return res.status(200).json({ estado: 'activado', mensaje: 'PIN configurado. Ya puedes iniciar sesion.' });
  } catch (err) {
    if (err instanceof AuthError) {
      await registrar({
        numero: normalizarNumero(req.body?.numero),
        accion: 'login_fallido',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        detalle: `activar:${err.code}`,
      });
      return res.status(err.httpStatus).json({ error: err.code, mensaje: err.message });
    }
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', requiereSesion, async (req, res, next) => {
  try {
    await logout(req.sessionToken);
    await registrar({
      numero: req.agente.numero,
      nombre: req.agente.nombre,
      accion: 'logout',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.status(200).json({ estado: 'cerrada' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/sesion  -> util para que la PWA valide el token al reanudar
authRouter.get('/sesion', requiereSesion, (req, res) => {
  res.json({ estado: 'ok', agente: { numero: req.agente.numero, nombre: req.agente.nombre }, expira_en: req.agente.expiraEn });
});
