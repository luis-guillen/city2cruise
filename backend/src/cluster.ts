import cluster from 'node:cluster';
import os from 'node:os';
import { logger } from './utils/logger';
import { config } from './config/env';

/**
 * Hito 4.3.1 — Wrapper de Node.js cluster.
 *
 * En produccion arranca N workers donde N = CLUSTER_WORKERS (env var) o
 * el numero de CPU cores. En desarrollo / test corre en single-process.
 *
 * Sticky-sessions de socket.io: cuando hay clustering, socket.io necesita
 * que la misma conexion siempre llegue al mismo worker. Esto se resuelve
 * con el adapter @socket.io/redis-adapter (Hito 4.3.2 lo introduce) o
 * con sticky-sessions a nivel del balanceador (Nginx ip_hash, AWS ALB
 * target affinity). Mientras tanto, el round-robin del cluster nativo
 * funciona si las conexiones usan websockets puros (no polling).
 */

const desiredWorkers = (() => {
  const env = process.env.CLUSTER_WORKERS;
  if (env === 'auto') return os.cpus().length;
  const n = Number(env);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return os.cpus().length;
})();

const enabled =
  process.env.CLUSTER_ENABLED === '1' ||
  (process.env.NODE_ENV === 'production' && process.env.CLUSTER_ENABLED !== '0');

export function bootstrap(start: () => Promise<void>): void {
  if (!enabled) {
    logger.info({ pid: process.pid }, 'cluster disabled, single-process mode');
    void start();
    return;
  }

  if (cluster.isPrimary) {
    logger.info(
      { pid: process.pid, workers: desiredWorkers, port: config.port },
      'cluster primary booting workers',
    );
    for (let i = 0; i < desiredWorkers; i++) cluster.fork();

    cluster.on('exit', (worker, code, signal) => {
      logger.warn(
        { workerPid: worker.process.pid, code, signal },
        'worker died, respawning',
      );
      cluster.fork();
    });

    const shutdown = (sig: string) => {
      logger.info({ sig }, 'cluster primary received shutdown');
      for (const id of Object.keys(cluster.workers ?? {})) {
        cluster.workers?.[id]?.send('shutdown');
        cluster.workers?.[id]?.disconnect();
      }
      setTimeout(() => process.exit(0), 5_000).unref();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  } else {
    logger.info({ pid: process.pid }, 'worker booting');
    void start();
  }
}

export function isWorker(): boolean {
  return cluster.isWorker;
}
