import crypto from 'node:crypto';

// El token de sesion que recibe el cliente es un valor aleatorio opaco.
// En la base solo se guarda su SHA-256, de modo que una fuga de la tabla
// `sesiones` no permite reutilizar sesiones vivas.

export function generarToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 chars hex
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
