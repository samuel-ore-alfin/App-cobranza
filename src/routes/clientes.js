import { Router } from 'express';
import { buscarPorDni } from '../services/clienteService.js';
import { registrar } from '../services/auditService.js';
import { requiereSesion } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimit.js';
import { esDniValido } from '../lib/validators.js';

export const clientesRouter = Router();

// GET /api/clientes/:dni
clientesRouter.get('/:dni', requiereSesion, searchLimiter, async (req, res, next) => {
  const { dni } = req.params;
  const ip = req.ip;
  const userAgent = req.get('user-agent');
  const { numero, nombre } = req.agente;

  // Nunca cachear datos de cliente en el dispositivo / proxies.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  if (!esDniValido(dni)) {
    await registrar({ numero, nombre, accion: 'consulta_dni', dni, resultado: 'dni_invalido', ip, userAgent });
    return res.status(400).json({ error: 'dni_invalido', mensaje: 'El DNI debe tener exactamente 8 digitos.' });
  }

  try {
    const r = await buscarPorDni(dni);

    // Auditoria SIEMPRE, exista o no el cliente.
    await registrar({
      numero, nombre, accion: 'consulta_dni', dni,
      resultado: r.encontrado ? 'encontrado' : 'no_encontrado',
      ip, userAgent,
    });

    if (!r.encontrado) {
      return res.status(404).json({
        estado: 'no_encontrado',
        mensaje: 'Ese DNI no se encuentra en la base de clientes.',
      });
    }

    return res.status(200).json({ estado: 'ok', cliente: r.cliente });
  } catch (err) {
    await registrar({
      numero, nombre, accion: 'consulta_dni', dni, resultado: 'error',
      ip, userAgent, detalle: String(err.message).slice(0, 300),
    });
    if (err.code === 'dni_invalido') {
      return res.status(400).json({ error: 'dni_invalido', mensaje: 'DNI invalido.' });
    }
    // Error de conectividad / SQL Server
    return res.status(502).json({
      error: 'origen_no_disponible',
      mensaje: 'No se pudo consultar la base de clientes en este momento. Intenta de nuevo.',
    });
  }
});
