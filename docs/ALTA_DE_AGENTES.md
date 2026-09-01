# Alta / baja / soporte de agentes  (todo por SQL en Supabase)

No hay panel de administracion. Todo se hace en el **SQL Editor de Supabase**,
sobre las tablas `public.usuarios_autorizados` / `public.sesiones` /
`public.auditoria` — las mismas de la v1 (bot de WhatsApp, dado de baja),
reutilizadas y extendidas para la app movil (ver `db/02_supabase_schema_v2.sql`).

## Formato del numero

Siempre **`51` + 9 digitos** (11 en total), solo digitos. Ej: `51991903636`.
La app tolera que el agente escriba `991903636` o `+51 991 903 636`, pero en
la base se guarda normalizado a `51991903636`.

## Alta de un agente nuevo

```sql
insert into usuarios_autorizados (numero, nombre)
values ('51900000000', 'APELLIDOS, NOMBRES')
on conflict (numero) do nothing;
```

- Los 128 agentes del HC AGO26 **ya estan cargados** (venian de la v1). Esto
  es solo para altas nuevas.
- **No** se define el PIN aqui. El agente lo crea la primera vez que entra a
  la app, ingresando el **codigo de activacion** (`AGENTE_ACTIVATION_CODE` del
  `.env`). Comunicaselo en persona durante el onboarding.
- `activo` queda en `true` por defecto. El trigger `trg_crear_sesion`
  (ya existente de la v1) crea automaticamente su fila en `sesiones`.

### (Opcional) titularidad de cartera

Si mas adelante quieres que un agente solo pueda consultar DNIs de **su**
cartera, carga su nombre tal como aparece en `NOMBRE_EDC` de SQL Server:

```sql
update usuarios_autorizados set nombre_edc = 'PEREZ ROJAS, JUAN' where numero = '51900000000';
```

Hoy ese campo solo se muestra; la validacion server-side esta lista para
activarse en `clienteService` cuando decidas (compararia `gestor_asignado`
del cliente contra `nombre_edc` del agente logueado).

## Soporte

| Situacion | SQL |
|---|---|
| Agente bloqueado (5 intentos) y no quiere esperar 15 min | `select desbloquear_agente('51900000000');` |
| Agente olvido su PIN | `update usuarios_autorizados set pin_hash = null where numero = '51900000000';` → vuelve a activarlo con el codigo |
| Baja de agente (deja de tener acceso ya) | `update usuarios_autorizados set activo = false where numero = '51900000000';` |
| Cerrar su sesion activa ahora | `update sesiones set revocada = true where numero = '51900000000';` |
| Reactivar | `update usuarios_autorizados set activo = true where numero = '51900000000';` |
| Rotar el codigo de activacion | cambia `AGENTE_ACTIVATION_CODE` en el `.env` (o en Coolify) y reinicia el backend |

## Consultas utiles de auditoria

```sql
-- Ultimas 50 acciones
select creado_en_pe, numero, nombre, accion, dni_consultado, resultado, ip
from auditoria order by id desc limit 50;

-- Cuantos DNIs consulto cada agente hoy (hora Peru)
select numero, nombre, count(*) consultas
from auditoria
where accion = 'consulta_dni' and creado_en_pe::date = (now() at time zone 'America/Lima')::date
group by 1,2 order by consultas desc;

-- Alertas de anomalia / rate limit
select creado_en_pe, numero, accion, detalle, ip
from auditoria
where accion in ('alerta_anomalia','rate_limit_excedido','login_bloqueado')
order by id desc limit 100;

-- Quien consulto un DNI puntual
select creado_en_pe, numero, nombre, resultado, ip
from auditoria
where dni_consultado = '12345678' order by id desc;
```

> Nota: `auditoria` tiene historial mezclado del bot v1 (acciones como
> `clave_incorrecta`, `acceso_correcto`) y de la app v2 (`login_ok`,
> `consulta_dni`, etc.) — es el mismo registro de trazabilidad continuo, solo
> distingue el sistema por el valor de `accion`.
