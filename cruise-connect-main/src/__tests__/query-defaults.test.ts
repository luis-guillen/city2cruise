import { describe, it, expect } from 'vitest';
import { STATIC_QUERY, DYNAMIC_QUERY, USER_QUERY, QK } from '@/lib/queryKeys';

describe('Hito 4.2.3 — React Query defaults por dominio', () => {
  it('STATIC_QUERY = 5 min staleTime', () => {
    expect(STATIC_QUERY.staleTime).toBe(5 * 60 * 1000);
    expect(STATIC_QUERY.gcTime).toBe(30 * 60 * 1000);
  });
  it('DYNAMIC_QUERY = 10s staleTime + refetchOnReconnect', () => {
    expect(DYNAMIC_QUERY.staleTime).toBe(10 * 1000);
    expect(DYNAMIC_QUERY.refetchOnReconnect).toBe(true);
  });
  it('USER_QUERY refetcha al focusear', () => {
    expect(USER_QUERY.refetchOnWindowFocus).toBe(true);
  });
  it('queryKeys son inmutables y derivables', () => {
    expect(QK.lockers).toEqual(['lockers']);
    expect(QK.user(42)).toEqual(['user', 42]);
    expect(QK.user()).toEqual(['user']);
  });
});
