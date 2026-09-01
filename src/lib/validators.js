// Validacion y saneamiento de inputs. Toda entrada del cliente pasa por aqui
// ANTES de tocar SQL Server o Supabase.

const DNI_RE = /^[0-9]{8}$/;
const PIN_RE = /^[0-9]{6}$/;
// Numero peruano normalizado: 51 + 9 digitos (el 9 inicial del movil).
const NUMERO_RE = /^51[0-9]{9}$/;

// PINs demasiado obvios: se rechazan aunque cumplan el formato.
const PIN_BLOCKLIST = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999',
  '123456', '654321', '012345', '123123', '121212', '112233',
]);

export function normalizarNumero(input) {
  if (typeof input !== 'string') return null;
  // Deja solo digitos; tolera "+51", espacios, guiones.
  let d = input.replace(/[^0-9]/g, '');
  if (d.length === 9) d = '51' + d;          // 9XXXXXXXX -> 519XXXXXXXX
  if (d.length === 11 && d.startsWith('51')) return NUMERO_RE.test(d) ? d : null;
  return null;
}

export function esDniValido(input) {
  return typeof input === 'string' && DNI_RE.test(input);
}

export function esPinFormatoValido(input) {
  return typeof input === 'string' && PIN_RE.test(input);
}

export function esPinAceptable(input) {
  if (!esPinFormatoValido(input)) return false;
  if (PIN_BLOCKLIST.has(input)) return false;
  if (/^(\d)\1{5}$/.test(input)) return false;               // 6 digitos iguales
  if (input === '123456' || input === '654321') return false; // por si acaso
  return true;
}
