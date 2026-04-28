import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { throttle } from '@/utils/throttle';

describe('Hito 4.2.2 — throttle()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('llama inmediatamente la primera vez', () => {
    const fn = vi.fn();
    const t = throttle(fn, 1000);
    t('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('descarta llamadas intermedias y entrega la última como trailing', () => {
    const fn = vi.fn();
    const t = throttle(fn, 1000);
    t('a');     // immediate
    t('b');     // queued
    t('c');     // queued (replaces b)
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('cancel() limpia el trailing', () => {
    const fn = vi.fn();
    const t = throttle(fn, 1000);
    t('a');
    t('b');
    t.cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respeta el intervalo cuando las llamadas vienen espaciadas', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t(1);
    vi.advanceTimersByTime(150);
    t(2);
    vi.advanceTimersByTime(150);
    t(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
