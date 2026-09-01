# Despliegue local / desarrollo

## Requisitos

- **Node.js >= 18.17** (probado con Node 24). `node -v`
- Acceso de red a `10.165.42.10:1433` (SQL Server `BDRIESGOS\PROD`, base `BI`).
  Desde una PC fuera de la red del banco **no** vas a poder conectarte: usa
  VPN corporativa o trabaja dentro de la red.
- El mismo proyecto Supabase (Pro) de la v1 (bot de WhatsApp, dado de baja),
  con permiso para correr SQL y ver Project Settings.

## 1. Instalar dependencias

```bash
cd bot_cobranza_v2
npm install
```

## 2. Crear la vista en SQL Server  (lo ejecutas TU)

Abre `db/01_sqlserver_create_view.sql` en SSMS / Azure Data Studio conectado
a `10.165.42.10`, base `BI` (instancia `PROD`, escucha directo en 1433, sin
nombre de instancia).

1. Antes de correrlo, ejecuta las 2 consultas de verificacion que estan
   comentadas al inicio (esquema real de `BD_BOT_CLIENTES` y tipo de la
   columna `DNI`). Ajusta el `FROM` o el `CONVERT(varchar(8), c.DNI)` si hace
   falta.
2. Ejecuta el `CREATE OR ALTER VIEW`.
3. Crea el **login de solo lectura** (`CREATE LOGIN app_bot_cobranza ...`,
   esta comentado — necesitas permisos de servidor o pedirselo al DBA),
   luego el `CREATE USER` y el `GRANT SELECT ON dbo.VW_BOT_COBRANZA_CAMPO`.
4. Corre las 2 pruebas finales (comentadas): con `EXECUTE AS USER` la vista
   debe devolver filas y la tabla base debe **fallar** por permiso.

> La cuenta que pongas en el `.env` debe ser **esta** (`app_bot_cobranza`),
> nunca la credencial `SQL_BDRIESGOS_BI_PROD` de n8n (esa puede tener mas
> permisos).

## 3. Migrar las tablas en Supabase  (lo ejecutas TU)

La app **reutiliza** las tablas de la v1 (`usuarios_autorizados`, `sesiones`,
`auditoria`, esquema `public`) — no crea tablas nuevas ni vuelve a cargar los
128 agentes. En el **SQL Editor** de Supabase:

1. Pega y ejecuta `db/02_supabase_schema_v2.sql` completo (es una migracion
   aditiva: solo agrega columnas y triggers nuevos, no borra nada).
2. Corre `db/03_cargar_agentes.sql` — son solo consultas de verificacion.
   `select count(*) from usuarios_autorizados;` deberia dar **128**.
3. Consigue la **Service Role Key**: Project Settings → API → `service_role`
   (secreto — tratalo como password).

No hace falta exponer ningun esquema nuevo: `public` ya esta expuesto por
defecto en cualquier proyecto Supabase.

## 4. Configurar el `.env`

```bash
cp .env.example .env
```

Completa como minimo:

| Variable | De donde sale |
|---|---|
| `SQLSERVER_HOST` | `10.165.42.10` |
| `SQLSERVER_INSTANCE` | vacio |
| `SQLSERVER_USER` / `SQLSERVER_PASSWORD` | login `app_bot_cobranza` creado en el paso 2 |
| `SUPABASE_URL` | Project Settings → API → Project URL (mismo proyecto de la v1) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` |
| `AGENTE_ACTIVATION_CODE` | invéntalo tu; es el codigo que daras a los agentes en el onboarding |
| `TRUST_PROXY_HOPS` | `0` en local; `1` (o mas) detras de reverse proxy |

El resto tiene valores por defecto razonables (sesion 60 min, bloqueo 5/15,
rate limit 10 min / 300 dia / 5000 global).

## 5. Levantar

```bash
npm start          # produccion
npm run dev        # con --watch (reinicia al guardar)
```

Abre `http://localhost:3000`. La PWA y la API se sirven desde el mismo origen.

`GET http://localhost:3000/healthz` debe responder `{ "ok": true }`.

## 6. Probar el flujo

1. Con un numero del HC (ej. el tuyo, `51991903636`) entra a la PWA e ingresa
   ese numero + cualquier PIN de 6 digitos → responde `requiere_activacion`.
2. En la pantalla de activacion: numero + `AGENTE_ACTIVATION_CODE` + PIN nuevo
   (x2) → "PIN configurado".
3. Inicia sesion con numero + PIN → pantalla de busqueda.
4. Ingresa un DNI de 8 digitos que exista en `BD_BOT_CLIENTES` → ficha.
   Uno que no exista → "no se encuentra en la base de clientes".
5. Revisa la auditoria:
   `select * from auditoria order by id desc limit 20;`
   Deben aparecer `requiere_activacion`, `pin_activado`, `login_ok`,
   `consulta_dni` (con `dni_consultado`, `ip`, `resultado`).
6. Prueba el bloqueo: 5 PIN incorrectos seguidos → `423` "cuenta bloqueada".
   Desbloquea: `select desbloquear_agente('51991903636');`

## Notas de red

- El backend usa un **pool lazy** hacia SQL Server: si las credenciales estan
  mal o no hay ruta, el server igual arranca y el error aparece en la primera
  consulta de DNI (`502 origen_no_disponible`) y en el log.
- Si `GET /api/clientes/:dni` da `502`, revisa: VPN/ruta a `10.165.42.10:1433`,
  y `SQLSERVER_ENCRYPT` / `SQLSERVER_TRUST_SERVER_CERT` (deben coincidir con
  lo que usa la credencial `SQL_BDRIESGOS_BI_PROD` de n8n).
- Si el login/auditoria fallan con error de Supabase, revisa
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` y que corriste el paso 3.
