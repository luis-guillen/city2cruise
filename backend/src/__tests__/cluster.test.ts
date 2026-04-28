/**
 * Hito 4.3.1 — bootstrap() en single-process mode (test env).
 *
 * En NODE_ENV != production y sin CLUSTER_ENABLED=1, bootstrap()
 * debe llamar a la funcion start() inline (no fork).
 */
import { describe, it, expect } from '@jest/globals';
import { bootstrap, isWorker } from '../cluster';

describe('Hito 4.3.1 — cluster bootstrap', () => {
  it('en test env corre single-process: invoca start()', async () => {
    delete process.env.CLUSTER_ENABLED;
    process.env.NODE_ENV = 'test';
    let invoked = false;
    bootstrap(async () => {
      invoked = true;
    });
    // El bootstrap es sincrono cuando es disabled
    expect(invoked).toBe(true);
  });

  it('isWorker() es false fuera de cluster', () => {
    expect(isWorker()).toBe(false);
  });
});
