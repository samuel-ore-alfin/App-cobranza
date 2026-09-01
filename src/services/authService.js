import bcrypt from 'bcryptjs';
import { tabla } from '../db/supabase.js';
import { config } from '../config.js';
import { generarToken, hashToken } from '../lib/tokens.js';
import { esPinFormatoValido, esPinAceptable } from '../lib/validators.js';

// Tablas reutilizadas de la v1 (bot de WhatsApp, dado de baja), extendidas
// via db/02_supabase_schema_v2.sql. `numero` es primary key en ambas: un
// agente = una fila en usuarios_autorizados = una fila en sesiones (una
// sesion activa por agente; cada login pisa/renueva su propia fila).

// Errores de negocio con codigo estable para que las rutas decidan el HTTP.
export class AuthError extends Error {
  constructor(code, httpStatus, message) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

async function getAgente(numero) {
  const { data, error } = await tabla('usuarios_autorizados')
    .select('numero, nombre, nombre_edc, activo, pin_hash, intentos_fallidos, bloqueado_hasta')
    .eq('numero', numero)
    .maybeSingle();
  if (error) throw new Error(`Supabase usuarios_autorizados: ${error.message}`);
  return data;
}

/**
 * Intenta autenticar. Devuelve:
 *   { estado: 'requiere_activacion' }                      -> el agente aun no tiene PIN
 *   { estado: 'ok', token, expiraEn, agente }              -> sesion creada
 * Lanza AuthError en credenciales invalidas / bloqueo.
 */
export async function login({ numero, pin, ip, userAgent }) {
  const agente = await getAgente(numero);

  // Respuesta uniforme para numero inexistente / inactivo / PIN incorrecto:
  // no se revela cual de las tres fallo.
  const credInvalidas = () =>
    new AuthError('credenciales_invalidas', 401, 'Numero o PIN incorrectos.');

  if (!agente || !agente.activo) {
    throw credInvalidas();
  }

  if (agente.bloqueado_hasta && new Date(agente.bloqueado_hasta) > new Date()) {
    throw new AuthError(
      'cuenta_bloqueada',
      423,
      'Cuenta bloqueada temporalmente por intentos fallidos. Intenta mas tarde o contacta al administrador.'
    );
  }

  if (!agente.pin_hash) {
    return { estado: 'requiere_activacion', agente };
  }

  const ok = await bcrypt.compare(pin, agente.pin_hash);
  if (!ok) {
    const intentos = (agente.intentos_fallidos || 0) + 1;
    const patch = { intentos_fallidos: intentos };
    if (intentos >= config.auth.loginMaxAttempts) {
      patch.intentos_fallidos = 0;
      patch.bloqueado_hasta = new Date(
        Date.now() + config.auth.loginLockMinutes * 60_000
      ).toISOString();
    }
    await tabla('usuarios_autorizados').update(patch).eq('numero', numero);
    if (patch.bloqueado_hasta) {
      throw new AuthError(
        'cuenta_bloqueada',
        423,
        `Cuenta bloqueada ${config.auth.loginLockMinutes} minutos por ${config.auth.loginMaxAttempts} intentos fallidos.`
      );
    }
    throw credInvalidas();
  }

  // Exito: limpia contadores y crea/renueva la sesion (upsert por numero).
  await tabla('usuarios_autorizados')
    .update({ intentos_fallidos: 0, bloqueado_hasta: null })
    .eq('numero', numero);

  const token = generarToken();
  const expiraEn = new Date(Date.now() + config.auth.sessionTtlMinutes * 60_000);
  const { error } = await tabla('sesiones')
    .upsert(
      {
        numero,
        token_hash: hashToken(token),
        ip: ip || null,
        user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
        expira_en: expiraEn.toISOString(),
        ultima_actividad: new Date().toISOString(),
        revocada: false,
      },
      { onConflict: 'numero' }
    );
  if (error) throw new Error(`Supabase sesiones upsert: ${error.message}`);

  return {
    estado: 'ok',
    token,
    expiraEn: expiraEn.toISOString(),
    agente: { numero: agente.numero, nombre: agente.nombre },
  };
}

/**
 * Define el PIN por primera vez. Solo funciona si el agente existe, esta
 * activo y aun NO tiene pin_hash. Exige el codigo de activacion.
 */
export async function activarPin({ numero, codigoActivacion, pin, pinRepeat }) {
  if (codigoActivacion !== config.auth.activationCode) {
    throw new AuthError('codigo_invalido', 403, 'Codigo de activacion incorrecto.');
  }
  if (!esPinFormatoValido(pin)) {
    throw new AuthError('pin_formato', 400, 'El PIN debe tener exactamente 6 digitos.');
  }
  if (pin !== pinRepeat) {
    throw new AuthError('pin_no_coincide', 400, 'Los PIN ingresados no coinciden.');
  }
  if (!esPinAceptable(pin)) {
    throw new AuthError('pin_debil', 400, 'Ese PIN es demasiado facil de adivinar. Elige otro.');
  }

  const agente = await getAgente(numero);
  if (!agente || !agente.activo) {
    throw new AuthError('credenciales_invalidas', 401, 'Numero no autorizado.');
  }
  if (agente.pin_hash) {
    throw new AuthError('ya_activado', 409, 'Este numero ya tiene un PIN configurado.');
  }

  const pin_hash = await bcrypt.hash(pin, config.auth.bcryptRounds);
  const { error } = await tabla('usuarios_autorizados')
    .update({ pin_hash, pin_actualizado_en: new Date().toISOString() })
    .eq('numero', numero)
    .is('pin_hash', null); // condicion de carrera: solo si sigue null
  if (error) throw new Error(`Supabase activarPin: ${error.message}`);

  return { estado: 'activado', agente: { numero: agente.numero, nombre: agente.nombre } };
}

/**
 * Valida el bearer token. Renueva la ventana deslizante. Devuelve el contexto
 * del agente o lanza AuthError 401.
 */
export async function validarSesion(token) {
  if (!token) throw new AuthError('sin_token', 401, 'Sesion no iniciada.');

  const { data: ses, error } = await tabla('sesiones')
    .select('numero, expira_en, revocada')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error) throw new Error(`Supabase validarSesion: ${error.message}`);

  if (!ses || ses.revocada) {
    throw new AuthError('sesion_invalida', 401, 'Sesion invalida. Inicia sesion de nuevo.');
  }
  if (new Date(ses.expira_en) <= new Date()) {
    await tabla('sesiones').update({ revocada: true }).eq('numero', ses.numero);
    throw new AuthError('sesion_expirada', 401, 'Sesion expirada por inactividad.');
  }

  const nuevaExpira = new Date(
    Date.now() + config.auth.sessionTtlMinutes * 60_000
  ).toISOString();
  await tabla('sesiones')
    .update({ expira_en: nuevaExpira, ultima_actividad: new Date().toISOString() })
    .eq('numero', ses.numero);

  const { data: agente } = await tabla('usuarios_autorizados')
    .select('numero, nombre, nombre_edc, activo')
    .eq('numero', ses.numero)
    .maybeSingle();

  if (!agente || !agente.activo) {
    await tabla('sesiones').update({ revocada: true }).eq('numero', ses.numero);
    throw new AuthError('agente_inactivo', 401, 'Agente inactivo.');
  }

  return {
    numero: agente.numero,
    nombre: agente.nombre,
    nombreEdc: agente.nombre_edc,
    expiraEn: nuevaExpira,
  };
}

export async function logout(token) {
  if (!token) return;
  await tabla('sesiones')
    .update({ revocada: true })
    .eq('token_hash', hashToken(token));
}
