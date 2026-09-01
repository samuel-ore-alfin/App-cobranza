import { getPool, sql } from '../db/sqlserver.js';
import { config } from '../config.js';
import { esDniValido } from '../lib/validators.js';

// Whitelist de columnas que la vista expone y que la app devuelve al agente.
// Si la vista trae mas columnas, aqui se ignoran: la app nunca reenvia campos
// que no esten en esta lista.
const CAMPOS = [
  'dni',
  'nombre_completo',
  'telefono_1',
  'telefono_2',
  'direccion',
  'distrito',
  'provincia',
  'departamento',
  'monto_adeudado',
  'capital',
  'cuota_mayor_atraso',
  'dias_atraso',
  'fecha_prox_pago',
  'estatus_cliente',
  'pdp_pendiente',
  'gestor_asignado',
  'gerencia',
  'region',
  'cuenta_ref_mask',
  'camp_liquidacion',
  'camp_refinanciado',
  'fec_ultima_gestion_campo',
  'ultima_reaccion_campo',
  'ultima_obs_campo',
];

function limpiar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

/**
 * Busca un cliente por DNI en la vista de solo lectura.
 * Devuelve { encontrado: false } o { encontrado: true, cliente: {...} }.
 */
export async function buscarPorDni(dni) {
  if (!esDniValido(dni)) {
    // Defensa en profundidad: la ruta ya valido, pero no confiamos.
    const e = new Error('DNI invalido');
    e.code = 'dni_invalido';
    throw e;
  }

  const pool = await getPool();
  // Consulta 100% parametrizada: el DNI viaja como parametro tipado, nunca
  // concatenado al texto SQL.
  const result = await pool
    .request()
    .input('dni', sql.VarChar(8), dni)
    .query(`SELECT TOP (1) * FROM ${config.sqlserver.view} WHERE dni = @dni`);

  if (!result.recordset || result.recordset.length === 0) {
    return { encontrado: false };
  }

  const row = result.recordset[0];
  const cliente = {};
  for (const c of CAMPOS) {
    cliente[c] = limpiar(row[c]);
  }
  return { encontrado: true, cliente };
}
