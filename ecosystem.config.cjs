/**
 * Hito 4.3.1 — Configuracion PM2 para produccion.
 *
 * Levanta el backend con cluster mode dejando que PM2 maneje los workers
 * (alternativa: usar el wrapper node:cluster nativo via CLUSTER_ENABLED=1).
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload city2cruise-backend  # zero downtime reload
 *   pm2 logs city2cruise-backend
 *   pm2 monit
 */
module.exports = {
  apps: [
    {
      name: 'city2cruise-backend',
      cwd: './backend',
      script: './dist/index.js',
      // PM2 cluster mode: arranca instances workers gestionados por PM2.
      // Cuando se usa este modo, conviene CLUSTER_ENABLED=0 para evitar
      // doble-cluster (PM2 ya hace el fork por nosotros).
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        CLUSTER_ENABLED: '0',
      },
      env_production: {
        NODE_ENV: 'production',
        CLUSTER_ENABLED: '0',
      },
      max_memory_restart: '512M',
      kill_timeout: 8000,
      listen_timeout: 8000,
      wait_ready: false,
      autorestart: true,
      watch: false,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/var/log/city2cruise/out.log',
      error_file: '/var/log/city2cruise/err.log',
    },
  ],
};
