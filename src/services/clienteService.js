import { getPool, sql } from '../db/sqlserver.js';
import { config } from '../config.js';
import { esDniValido } from '../lib/validators.js';

// Proyeccion fija: SOLO estas columnas salen de SQL Server, con estos alias.
// Se consulta config.sqlserver.source (por defecto la tabla base BI..BD_BOT_CLIENTES,
// misma fuente que la v1; si el DBA crea la vista restringida se apunta ahi).
// NO se exponen: correo, cronograma completo, historial de pagos, numero de
// cuenta completo (se enmascara a 4), scoring, datos de terceros/avales.
const SELECT_SQL = `
SELECT TOP (1)
  CONVERT(varchar(8), c.DNI)                                       AS dni,
  RTRIM(c.NOMBRECLIENTE)                                           AS nombre_completo,
  NULLIF(RTRIM(LTRIM(CONVERT(varchar(30), c.TELF_1))), '')         AS telefono_1,
  NULLIF(RTRIM(LTRIM(CONVERT(varchar(30), c.TELF_2))), '')         AS telefono_2,
  NULLIF(RTRIM(c.DIRECCION), '')                                   AS direccion,
  NULLIF(RTRIM(c.DISTRITO), '')                                    AS distrito,
  NULLIF(RTRIM(c.PROVINCIA), '')                                   AS provincia,
  NULLIF(RTRIM(c.DEPARTAMENTO), '')                                AS departamento,
  c.Deuda_Actual                                                   AS monto_adeudado,
  c.CAPITAL                                                        AS capital,
  c.Cuota_MayorAtraso                                              AS cuota_mayor_atraso,
  c.DIA_ATRASO                                                     AS dias_atraso,
  CONVERT(varchar(10), TRY_CONVERT(date, c.FECHAPROXPAGO), 23)     AS fecha_prox_pago,
  NULLIF(RTRIM(c.ESTATUS_CLIENTE), '')                             AS estatus_cliente,
  NULLIF(RTRIM(CONVERT(varchar(50), c.PDP_PENDIENTE_CALL)), '')    AS pdp_pendiente,
  NULLIF(RTRIM(c.CAMP_LIQUIDACION), 'Sin_Campaña')                 AS camp_liquidacion,
  NULLIF(RTRIM(c.CAMP_REFINANCIADO), 'Sin_Campaña')                AS camp_refinanciado,
  CONVERT(varchar(10), TRY_CONVERT(date, c.FEC_GESTION_CAMPO), 23) AS fec_ultima_gestion_campo,
  NULLIF(RTRIM(c.REACCION_CAMPO), '')                              AS ultima_reaccion_campo,
  NULLIF(RTRIM(c.OBS_CAMPO), '')                                   AS ultima_obs_campo,
  NULLIF(RTRIM(c.NOMBRE_EDC), '')                                  AS gestor_asignado,
  NULLIF(RTRIM(c.GERENCIA), '')                                    AS gerencia,
  NULLIF(RTRIM(c.REGION), '')                                      AS region,
  RIGHT(RTRIM(CONVERT(varchar(50), c.CUENTA_BT)), 4)               AS cuenta_ref_mask
FROM ${config.sqlserver.source} AS c
WHERE c.DNI = @dni
`;

// Alias que la API devuelve al agente (defensa extra: si la query trajera algo
// mas, aqui se ignora).
const CAMPOS = [
  'dni', 'nombre_completo', 'telefono_1', 'telefono_2', 'direccion', 'distrito',
  'provincia', 'departamento', 'monto_adeudado', 'capital', 'cuota_mayor_atraso',
  'dias_atraso', 'fecha_prox_pago', 'estatus_cliente', 'pdp_pendiente',
  'camp_liquidacion', 'camp_refinanciado', 'fec_ultima_gestion_campo',
  'ultima_reaccion_campo', 'ultima_obs_campo', 'gestor_asignado', 'gerencia',
  'region', 'cuenta_ref_mask',
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
 * Busca un cliente por DNI.
 * Devuelve { encontrado: false } o { encontrado: true, cliente: {...} }.
 */
export async function buscarPorDni(dni) {
  if (!esDniValido(dni)) {
    const e = new Error('DNI invalido');
    e.code = 'dni_invalido';
    throw e;
  }

  const pool = await getPool();
  // 100% parametrizado: el DNI viaja como parametro tipado, nunca concatenado.
  const result = await pool
    .request()
    .input('dni', sql.VarChar(8), dni)
    .query(SELECT_SQL);

  if (!result.recordset || result.recordset.length === 0) {
    return { encontrado: false };
  }

  const row = result.recordset[0];
  const cliente = {};
  for (const campo of CAMPOS) {
    cliente[campo] = limpiar(row[campo]);
  }
  return { encontrado: true, cliente };
}
