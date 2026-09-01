# Despliegue en Coolify (VM Azure del banco)

Coolify v4 despliega contenedores Docker. Este proyecto ya trae `Dockerfile`
y `.dockerignore`, asi que el build pack es **Dockerfile**. No necesita
volumenes: la app es sin estado (todo el estado vive en Supabase).

---

## 0. Pre-flight EN EL SERVIDOR de Coolify  (antes de tocar la UI)

Coolify → **Terminal** (menu lateral) o SSH a la VM. Verifica que la VM
alcanza las dos dependencias:

```sh
# SQL Server on-premise. IP real (credencial n8n SQL_BDRIESGOS_BI_PROD).
nc -vz 10.165.42.10 1433

# Supabase por HTTPS saliente. Debe devolver cabeceras HTTP.
curl -sSI https://TU-PROYECTO.supabase.co | head -n 1
```

La instancia `PROD` escucha directo en el 1433 (n8n conecta solo con host +
puerto, sin nombre de instancia) -> `SQLSERVER_INSTANCE` va vacio.

Si `nc` a 1433 **falla** (hay red interna pero no llega al SQL):
- Falta **regla de firewall** hacia `10.165.42.10:1433` desde la IP de la VM
  Coolify (`mvprdbkdn8n004`). Coordina con Infra para agregarla.

Si `curl` a Supabase **falla**: la VM sale a internet por un **proxy**.
Avisame — hay que inyectar un `ProxyAgent` en el cliente Supabase
(`src/db/supabase.js`); el `fetch` global de Node no usa `HTTPS_PROXY` solo.

> La IP con la que el contenedor sale a la red es la IP de la VM. Si el
> firewall del SQL Server o el proxy de salida filtran por IP de origen,
> hay que **allowlistear la IP de la VM Coolify** en ambos.

---

## 1. Poner el codigo en un repo Git

Coolify despliega desde Git. Usa el repositorio del banco (Azure DevOps /
GitLab interno).

```sh
cd "bot_cobranza_v2"
git init
git add .
git commit -m "bot_cobranza_v2: app de consulta DNI para agentes de campo"
git branch -M main
git remote add origin <URL-del-repo-privado>
git push -u origin main
```

`.env` **no** se sube (ya esta en `.gitignore` y `.dockerignore`).

---

## 2. Crear el recurso en Coolify

1. **Projects** → crea uno nuevo, p.ej. `Bot Cobranza v2` (o usa uno). Entra a
   su entorno `production`.
2. **+ Add Resource** → tipo **Application**.
3. Fuente:
   - **Private Repository (with deploy key)** → pega la URL del repo y branch
     `main`. Coolify genera una **Deploy Key**: copiala y agregala como
     *deploy key* de solo lectura en el repo del banco.
   - (o conecta una **Source** de GitHub/GitLab si ya la tienen).
4. **Build Pack: Dockerfile** (Coolify lo autodetecta al ver el `Dockerfile`).
   - Si prefieres cero-config, **Nixpacks** tambien funciona (detecta Node,
     corre `npm ci` + `npm start`), pero el `Dockerfile` te da usuario
     no-root y healthcheck.

---

## 3. Configuracion de la aplicacion

**General:**
- **Ports Exposes:** `3000`
- **Health Check Path:** `/healthz`  (Method GET, esperado 200)
- Start command / build command: dejar en blanco (los define el `Dockerfile`).

**Environment Variables** (pestaña *Environment Variables*, todas *runtime*,
no *build*):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `TRUST_PROXY_HOPS` | `1`  (el proxy de Coolify va delante) |
| `SQLSERVER_HOST` | `10.165.42.10` |
| `SQLSERVER_INSTANCE` | *(vacio)* |
| `SQLSERVER_PORT` | `1433` |
| `SQLSERVER_DATABASE` | `BI` |
| `SQLSERVER_USER` | `app_bot_cobranza` |
| `SQLSERVER_PASSWORD` | *(secreto)* |
| `SQLSERVER_VIEW` | `dbo.VW_BOT_COBRANZA_CAMPO` |
| `SQLSERVER_ENCRYPT` | `true` |
| `SQLSERVER_TRUST_SERVER_CERT` | `true` |
| `SUPABASE_URL` | `https://iboxhzhdknwlmcqxvcmw.supabase.co`  (mismo proyecto de la v1) |
| `SUPABASE_SERVICE_ROLE_KEY` | *(secreto)* |
| `SUPABASE_SCHEMA` | `public` |
| `AGENTE_ACTIVATION_CODE` | *(el que daras a los agentes)* |
| `SESSION_TTL_MINUTES` | `60` |
| `LOGIN_MAX_ATTEMPTS` | `5` |
| `LOGIN_LOCK_MINUTES` | `15` |
| `SEARCH_RATE_PER_MINUTE` | `10` |
| `SEARCH_RATE_PER_DAY` | `300` |
| `SEARCH_RATE_GLOBAL_PER_DAY` | `5000` |
| `SEARCH_ANOMALY_PER_HOUR` | `60` |

> Coolify cifra estas variables en su base. Aun asi, para auditoria SBS lo
> ideal es que los secretos (`SQLSERVER_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`)
> salgan del vault del banco.

**Storage:** nada. No agregar volumenes.

**Resources:** esta app pesa poco — 0.5 vCPU y 512 MB RAM sobran.

---

## 4. Dominio y HTTPS

En **Domains** pon el FQDN, p.ej. `https://cobranza-app.abdigital.com`.

Coolify intenta emitir certificado **Let's Encrypt** por desafio HTTP-01, que
necesita que el dominio resuelva en internet y sea alcanzable en el puerto 80.
En una VM **interna del banco eso normalmente NO se cumple**. Opciones:

- **(recomendada)** TLS lo termina el **reverse proxy corporativo** (el que ya
  sirve `abdigital.com`) y reenvia por HTTP al puerto de la app en la VM
  Coolify. En Coolify pones el dominio interno y deshabilitas Let's Encrypt.
  Mantienes `TRUST_PROXY_HOPS` acorde a cuantos proxies hay en la cadena
  (Coolify + el corporativo → probablemente `2`).
- Certificado de **CA interna del banco**: subirlo en Coolify como certificado
  personalizado para ese dominio.
- **Cloudflare + DNS-01** (Coolify lo soporta): funciona sin exponer el 80,
  pero mete a Cloudflare en la ruta → requiere OK de CISO.

HSTS ya lo envia la app cuando `NODE_ENV=production`.

---

## 5. Desplegar y verificar

1. **Deploy**. Mira los *Deployment Logs* (build de la imagen + arranque).
2. En la VM / Terminal de Coolify:
   ```sh
   curl -s http://127.0.0.1:<puerto-publicado>/healthz
   ```
   o contra el dominio si ya hay TLS. Debe dar `{"ok":true,...}`.
3. Corre los scripts SQL si aun no lo hiciste:
   - `db/01_sqlserver_create_view.sql` en `10.165.42.10` / `BI`.
   - `db/02_supabase_schema_v2.sql` (migracion aditiva sobre las tablas de la
     v1; no hace falta exponer ningun esquema nuevo, `public` ya lo esta).
   - `db/03_cargar_agentes.sql` (solo verificacion; los 128 agentes ya estan).
4. Prueba el flujo completo (ver `DESPLIEGUE_LOCAL.md` paso 6): activar PIN →
   login → consultar un DNI → revisar `select * from auditoria order by id desc;`.
5. Si `GET /api/clientes/:dni` da `502 origen_no_disponible`: es red a SQL
   Server (vuelve al pre-flight, paso 0). Si el login da `error_interno` con
   mensaje de Supabase: revisa `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, o
   que la VM no llega a Supabase.

---

## 6. Operacion en Coolify

- **Auto-deploy:** activa el webhook de Git para redeploy en cada push a
  `main` (o dejalo manual si prefieres control).
- **Healthcheck** ya definido → Coolify reinicia el contenedor si `/healthz`
  falla.
- **Logs:** *Logs* del recurso. Configura una **Notification** (Slack/email)
  en Coolify para fallos de deploy y de healthcheck.
- **Backups:** no aplica a esta app (sin estado). Los datos y la auditoria se
  respaldan del lado de Supabase.
- **Escala:** este diseño asume **1 instancia** (el rate limit vive en memoria
  del proceso). No subas el replica count sin migrar ese estado a un store
  compartido.
