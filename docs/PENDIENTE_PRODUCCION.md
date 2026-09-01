# Qué falta de tu lado para pasar a produccion

La app funciona; lo que sigue es infraestructura, red y compliance — decisiones
tuyas / de Infra / de CISO. **No hagas nada de esto automaticamente**: es la
lista de pasos.

## 1. Dónde corre el backend  → Coolify (VM Azure del banco)

Decidido: se despliega en la **VM con Coolify** del banco. Guia paso a paso en
**`DESPLIEGUE_COOLIFY.md`**. El SQL Server (`BDRIESGOS\PROD`) es on-premise, y
esa VM esta dentro de la red → cumple el requisito de linea directa al 1433.
(Vercel / Render / Railway quedan descartados: no alcanzan el SQL Server.)

Verifica (detalle en `DESPLIEGUE_COOLIFY.md` paso 0):
- [ ] Ruta y firewall del host → `BDRIESGOS` : 1433 abierto.
- [ ] Si usas `instanceName=PROD` en vez de puerto fijo, el **SQL Browser**
      (UDP 1434) debe estar accesible; si no, pide a DBA el puerto TCP estatico
      de la instancia y usa `SQLSERVER_PORT`.
- [ ] Salida HTTPS (443) del host → `*.supabase.co` permitida.
- [ ] Hora del host sincronizada (NTP) — importa para expiracion de sesiones y
      para la auditoria.

## 2. Cómo llegan los celulares al backend  (bloqueante — Infra + CISO)

Los agentes NO estan en la red interna. Hay que exponer la API. Opciones, de
mas a menos defendible para un banco regulado (SBS):

1. **VPN corporativa + MDM en los equipos** (perfil gestionado, certificado de
   dispositivo). La app solo alcanza la API con el tunel activo.
   → Recomendado **si los celulares son gestionados por el banco**.
2. **Publicar la API por el DMZ / reverse proxy corporativo** (el mismo que
   sirve `abdigital.com`) con **TLS + WAF + IP allowlist** si aplica.
   → Recomendado **si los equipos no son gestionados**.
3. Cloudflare Tunnel / Access — rapido y sin abrir firewall entrante, pero
   mete un tercero en la ruta de datos → requiere **firma explicita de CISO**.

Acciones:
- [ ] Decidir opcion 1 vs 2 con Infra. Anexar al `observaciones_ciso.xlsx`
      existente para no reabrir la discusion desde cero.
- [ ] Confirmar si los celulares corporativos tienen MDM.

## 3. Dominio + TLS

- [ ] Subdominio interno o publico (segun opcion 2/1), ej.
      `cobranza-app.abdigital.com`.
- [ ] Certificado TLS valido (CA corporativa o publica). La PWA **requiere
      HTTPS** para instalarse y para el service worker.
- [ ] Redirigir HTTP→HTTPS en el proxy. HSTS ya lo manda la app en `production`.
- [ ] Si hay reverse proxy, setear `TRUST_PROXY_HOPS` al numero correcto para
      que la auditoria registre la IP real del celular (no la del proxy).

## 4. Secretos

- [ ] `.env` NO va en el repo (ya esta en `.gitignore`). Guardar los valores en
      el gestor de secretos del banco / vault, no en texto plano.
- [ ] Password del login SQL `app_bot_cobranza`: fuerte, rotable.
- [ ] `SUPABASE_SERVICE_ROLE_KEY`: es la llave maestra de Supabase. Solo en el
      host del backend.
- [ ] `AGENTE_ACTIVATION_CODE`: definir, comunicar en onboarding, rotar cada
      cierto tiempo (cambiar env + reiniciar).
- [ ] Rotar la password de Postgres de Evolution API que quedo expuesta en la
      v1 (pendiente heredado).

## 5. Supabase / datos

- [ ] Confirmar que el proyecto es **Pro** (no Free — el Free pausa por
      inactividad).
- [x] No hace falta exponer esquema nuevo: se reutiliza `public` (mismas
      tablas de la v1, migradas de forma aditiva).
- [ ] Backups: verificar retencion de PITR en el plan. La auditoria es
      obligacion legal (Ley 29733) — define **politica de retencion** (p.ej.
      guardar N años, luego archivar) y **quien** puede hacer mantenimiento
      DBA sobre la tabla append-only.
- [ ] Confirmar con Legal/CISO que datos de clientes de un banco SBS en
      Supabase (proveedor cloud externo) queda **documentado como decision
      aprobada**, no como descuido — igual que se hizo en la v1.
- [ ] Si el DBA confirma que el puerto 5432/6543 **si** tiene salida desde el
      host del backend, se puede migrar el acceso a Supabase de REST a conexion
      directa Postgres con un rol dedicado (`GRANT INSERT` sobre `auditoria`,
      sin UPDATE/DELETE) para defensa en profundidad extra. Cambio chico,
      opcional.

## 6. SQL Server

- [ ] DBA confirma esquema real de `BD_BOT_CLIENTES` (se asume `dbo`) y tipo de
      `DNI` (para el `CONVERT` de la vista).
- [ ] Crear login `app_bot_cobranza` con **solo** `GRANT SELECT` sobre la vista.
- [ ] Confirmar que el ETL de Planeamiento Cobranza (cada hora :30) seguira
      alimentando la tabla. Documentar el desfase de ~1h para los agentes.
- [ ] (Opcional) pedir a Planeamiento Cobranza agregar `PRODUCTO` al ETL si se
      quiere mostrar tipo de credito (hoy no existe esa columna).

## 7. Operacion

- [ ] Proceso de arranque automatico (systemd/PM2/servicio Windows) + reinicio
      ante caida.
- [ ] Rotacion de logs del backend (stdout → journald / archivo con logrotate).
- [ ] Monitoreo: alerta si `/healthz` deja de responder; revisar
      periodicamente `accion in ('alerta_anomalia','rate_limit_excedido')` en
      la auditoria (o engancharlo a un job que notifique).
- [ ] Recalibrar el rate limit tras 2 semanas con datos reales
      (`SEARCH_RATE_PER_DAY`, `SEARCH_ANOMALY_PER_HOUR`). Usuarios de back en
      campaña de llamadas pueden llegar a 100–150/dia.
- [ ] Si en el futuro hay **mas de una instancia** del backend, mover el estado
      del rate limit (hoy en memoria) a un store compartido (Redis o contador
      en Supabase).
- [ ] Onboarding de los 130 agentes: instruccion de "agregar a pantalla de
      inicio" (PWA), numero a usar, y el codigo de activacion.

## 8. Iconos PWA (cosmetico)

Hoy el icono es un SVG generico. Si quieres el logo de Alfin: reemplaza
`public/icons/icon.svg` y agrega PNG 192/512 en `public/icons/` + sus entradas
en `public/manifest.webmanifest` (algunos Android prefieren PNG para el splash).

## Fuera de alcance (acordado, para después)

- SMS OTP como segundo factor.
- Bot de WhatsApp/Telegram.
- Panel de administracion (hoy el alta es SQL manual).
