# syntax=docker/dockerfile:1.7

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Hito H-1.3 (S-03): runtime no-root con nginxinc/nginx-unprivileged.
# Esta variante oficial de Nginx escucha en 8080 (no 80) y corre como UID 101.
FROM nginxinc/nginx-unprivileged:alpine AS runtime

# Cambiar temporalmente a root sólo para colocar los archivos. Sin esta línea,
# /usr/share/nginx/html no es escribible por el usuario nginx.
USER 0
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN chown -R 101:101 /usr/share/nginx/html

# UID 101 = `nginx` en la imagen unprivileged.
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --spider -q http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
