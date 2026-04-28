/**
 * PM2 Ecosystem — Production multi-core configuration.
 *
 * Usage:
 *   npm run build           # compile TypeScript → dist/
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup # persist across reboots
 *
 * Socket.IO + cluster note:
 *   Multiple workers share the same port but each maintains its own in-memory
 *   socket state. To relay events across workers configure a reverse-proxy with
 *   sticky sessions (nginx: ip_hash) so every client always hits the same worker.
 *   For a fully stateless multi-worker setup, migrate to @socket.io/redis-adapter
 *   so events are fanned out via Redis pub/sub.
 */
module.exports = {
    apps: [
        {
            name: 'cruise-connect',
            script: './dist/index.js',

            // One worker per logical CPU core
            instances: 'max',
            exec_mode: 'cluster',

            // Restart worker if it exceeds 512 MB RSS
            max_memory_restart: '512M',

            // Keep stdout/stderr logs under control
            out_file: './logs/out.log',
            error_file: './logs/err.log',
            merge_logs: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

            // Environment variables (override via .env or process.env in production)
            env: {
                NODE_ENV: 'production',
                PORT: 9000,
            },

            // Zero-downtime deploys: wait for the new process to be ready before
            // killing the old one (requires app to signal ready via process.send('ready'))
            wait_ready: false,
            listen_timeout: 10000,
            kill_timeout: 5000,
        },
    ],
};
