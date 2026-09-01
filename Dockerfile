# bot_cobranza_v2 — imagen de produccion
# Node 22 (alpine): trae fetch Y WebSocket globales. @supabase/supabase-js
# reciente exige WebSocket global al construir el cliente (Node 20 no lo tiene
# -> el contenedor crasheaba al arrancar).
# Sin dependencias nativas: bcryptjs y mssql/tedious son JS puro.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Instala solo dependencias de produccion, con capa cacheable.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Codigo de la app.
COPY --chown=node:node . .

# Corre sin privilegios.
USER node

EXPOSE 3000

# Healthcheck interno (Coolify tambien puede apuntar a /healthz).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
