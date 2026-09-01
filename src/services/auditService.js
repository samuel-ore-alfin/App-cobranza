import { tabla } from '../db/supabase.js';

// Escribe una fila en `auditoria` (tabla reutilizada de la v1, extendida con
// resultado/ip/user_agent). Es append-only a nivel de base (trigger que
// bloquea UPDATE/DELETE), por lo que la app solo inserta.
//
// Acciones usadas por la v2 (conviven con las historicas del bot v1 en la
// misma columna `accion`, que es texto libre):
//   login_ok | login_fallido | login_bloqueado | requiere_activacion |
//   pin_activado | logout | sesion_expirada | consulta_dni | alerta_anomalia |
//   rate_limit_excedido | error_sqlserver
//
// NUNCA se registra el PIN ni el token de sesion.

export async function registrar(evento) {
  const fila = {
    numero: evento.numero || null,
    nombre: evento.nombre || null,
    accion: evento.accion,
    dni_consultado: evento.dni || null,
    resultado: evento.resultado || null,
    ip: evento.ip || null,
    user_agent: evento.userAgent ? String(evento.userAgent).slice(0, 300) : null,
    detalle: evento.detalle ? String(evento.detalle).slice(0, 500) : null,
  };

  const { error } = await tabla('auditoria').insert(fila);
  if (error) {
    // La auditoria es critica pero no debe tumbar la request del agente.
    // Se deja rastro en el log del servidor para conciliacion posterior.
    console.error('[auditoria] no se pudo registrar el evento', {
      accion: fila.accion,
      numero: fila.numero,
      error: error.message,
    });
  }
}
