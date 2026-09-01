# bot_cobranza_v2 — App de consulta de clientes por DNI

App web interna (PWA) para ~130 agentes de cobranza de campo de Alfin Banco.
El agente inicia sesion con **numero de telefono + PIN** desde su celular
corporativo, ingresa el **DNI** de un cliente y ve su ficha de gestion.
Los datos vienen de **SQL Server** (solo lectura, a traves de una vista).
Agentes, sesiones y **auditoria** viven en **Supabase**.

> Reemplaza a la v1 (bot de WhatsApp sobre n8n + Evolution API). Aqui **no**
> hay WhatsApp/Telegram, ni panel de administracion, ni SMS OTP.

## Arquitectura

```
 Celular del agente (PWA)
        │  HTTPS  (Authorization: Bearer <token de sesion, solo en memoria>)
        ▼
 Backend Node.js/Express  ──────────────►  SQL Server  BDRIESGOS\PROD (10.165.42.10:1433)
   (Coolify, VM Azure ON-PREMISE del banco)   DB: BI
        │                                    Vista: dbo.VW_BOT_COBRANZA_CAMPO  (solo SELECT)
        │  HTTPS REST (PostgREST)            Cuenta: app_bot_cobranza  (solo lectura)
        ▼
 Supabase (Postgres)  esquema  public   ← reutiliza las tablas de la v1
   usuarios_autorizados · sesiones · auditoria (append-only)  (bot WhatsApp v1 dado de baja)
```

Decisiones y el porque:

| Tema | Decision | Motivo |
|---|---|---|
| Backend | Node.js/Express | Driver `mssql` sin dependencias nativas; mismo lenguaje que la PWA. |
| Acceso a Supabase | REST (PostgREST) + Service Role Key | El firewall del banco bloquea 5432/6543 desde la red interna (ver v1). |
| Datos de clientes | Vista de solo lectura, cuenta con solo `SELECT` sobre la vista | Nunca acceso a la tabla base ni a columnas de mas. |
| PIN | 6 digitos, hash **bcrypt** (`bcryptjs`, coste 12) | Nunca se guarda en claro. `bcryptjs` es JS puro → sin toolchain de build en el server on-prem. |
| Sesion | Token opaco aleatorio; en la BD solo su SHA-256; ventana deslizante 60 min | Revocable, y una fuga de la tabla `sesiones` no permite reusar sesiones. |
| Token en el cliente | Solo en variable de memoria (no `localStorage`, no cookie) | Recargar = re-login. Cumple "no persistir datos en el dispositivo". |
| Auditoria | Tabla append-only por **trigger** que rechaza UPDATE/DELETE a cualquier rol | La Service Role Key ignora RLS; el trigger es la garantia real. |
| Bloqueo | 5 intentos → bloqueo 15 min + `select desbloquear_agente('...')` para reset manual | Requisito de seguridad. |
| Tablas Supabase | Se reutilizan `usuarios_autorizados` / `sesiones` / `auditoria` de la v1 (esquema `public`), extendidas por migracion aditiva | El bot v1 esta dado de baja; evita duplicar los 128 agentes y conserva el historial de auditoria. |
| Rate limit | 10/min y 300/dia por agente + tope global 5000/dia + alerta de anomalia (>60/h) | Frena scraping de DNIs secuenciales. |

## Estructura del proyecto

```
bot_cobranza_v2/
├─ src/
│  ├─ server.js                Express, helmet/CSP, static PWA, rutas
│  ├─ config.js                Carga y valida variables de entorno
│  ├─ db/
│  │  ├─ sqlserver.js          Pool mssql (lazy)
│  │  └─ supabase.js           Cliente Supabase (REST, schema public)
│  ├─ middleware/
│  │  ├─ auth.js               requiereSesion (bearer token)
│  │  ├─ rateLimit.js          loginLimiter + searchLimiter (por agente/min/dia/global)
│  │  └─ errorHandler.js
│  ├─ routes/
│  │  ├─ auth.js               POST /login, /activar, /logout ; GET /sesion
│  │  └─ clientes.js           GET /:dni
│  ├─ services/
│  │  ├─ authService.js        login, activarPin, validarSesion, logout
│  │  ├─ clienteService.js     buscarPorDni (query parametrizada + whitelist de campos)
│  │  └─ auditService.js       registrar(evento)
│  └─ lib/
│     ├─ validators.js         normalizarNumero, esDniValido, esPinAceptable
│     └─ tokens.js             generarToken, hashToken
├─ public/                     PWA (index.html, app.js, styles.css, SW, manifest, icono)
├─ db/
│  ├─ 01_sqlserver_create_view.sql    ← lo ejecutas TU en SQL Server
│  ├─ 02_supabase_schema_v2.sql       ← lo ejecutas TU en Supabase
│  └─ 03_cargar_agentes.sql           ← verificacion (los 128 ya estaban en la v1)
├─ docs/
│  ├─ DESPLIEGUE_LOCAL.md
│  ├─ DESPLIEGUE_COOLIFY.md
│  ├─ ALTA_DE_AGENTES.md
│  └─ PENDIENTE_PRODUCCION.md
├─ .env.example
└─ package.json
```

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ numero, pin }` → `{ token, expira_en, agente }` o `{ estado: "requiere_activacion" }` |
| POST | `/api/auth/activar` | — | `{ numero, codigo_activacion, pin, pin_repeat }` — define el PIN la 1ra vez |
| POST | `/api/auth/logout` | Bearer | Revoca la sesion |
| GET | `/api/auth/sesion` | Bearer | Valida el token y renueva la ventana |
| GET | `/api/clientes/:dni` | Bearer | Ficha del cliente. `Cache-Control: no-store`. Audita siempre. |
| GET | `/healthz` | — | Liveness |

## Puesta en marcha

- Local / desarrollo: **[docs/DESPLIEGUE_LOCAL.md](docs/DESPLIEGUE_LOCAL.md)**
  (`npm install` → `.env` desde `.env.example` → 3 scripts SQL → `npm start`).
- Produccion en la VM del banco (Coolify): **[docs/DESPLIEGUE_COOLIFY.md](docs/DESPLIEGUE_COOLIFY.md)**
  (incluye `Dockerfile`; recurso tipo Application, build pack Dockerfile,
  puerto 3000, health check `/healthz`).

## Alta / baja de agentes

Ver **[docs/ALTA_DE_AGENTES.md](docs/ALTA_DE_AGENTES.md)** (todo por SQL en Supabase).

## Qué falta para produccion

Ver **[docs/PENDIENTE_PRODUCCION.md](docs/PENDIENTE_PRODUCCION.md)**.
