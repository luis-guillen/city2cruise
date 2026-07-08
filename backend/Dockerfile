# syntax=docker/dockerfile:1.7

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY --chown=node:node package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --chown=node:node . .
RUN pnpm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Hito H-1.3 (S-03): runtime no-root + HEALTHCHECK.
FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g pnpm
# Dependencias prod, propietario `node` (UID 1000 en la imagen oficial).
COPY --chown=node:node package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=builder --chown=node:node /app/dist ./dist

# Cambia a usuario sin privilegios antes del CMD (sin esto, el proceso corre
# como root y un RCE escalaría a root dentro del contenedor).
USER node

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD node -e "require('http').get('http://127.0.0.1:9000/api/health', res => { if (res.statusCode !== 200) process.exit(1); res.resume(); }).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
