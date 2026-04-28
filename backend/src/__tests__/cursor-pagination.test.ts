/**
 * Hito 4.3.3 — Test del codec de cursor (no requiere DB).
 */
import { describe, it, expect } from '@jest/globals';
import { encodeCursor, decodeCursor } from '../db/pagination/cursor';

describe('Hito 4.3.3 — cursor encode/decode', () => {
  it('round trip', () => {
    const c = encodeCursor({ ts: '2026-04-28T10:00:00.000Z', id: 42 });
    const d = decodeCursor(c);
    expect(d).toEqual({ ts: '2026-04-28T10:00:00.000Z', id: 42 });
  });

  it('decode rechaza basura', () => {
    expect(decodeCursor('not-a-valid-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('eyJhIjoxfQ==')).toBeNull(); // base64 valido pero shape invalido
  });

  it('cursor es opaco (base64url, sin padding/+/-)', () => {
    const c = encodeCursor({ ts: '2026-01-01T00:00:00.000Z', id: 1 });
    expect(c).not.toMatch(/[+/=]/);
  });
});
