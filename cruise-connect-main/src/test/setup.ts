import '@testing-library/jest-dom';
import 'vitest-axe/extend-expect';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from 'vitest-axe/matchers';

// Vitest-axe matchers (toHaveNoViolations) explicitly registered
// eslint-disable-next-line @typescript-eslint/no-explicit-any
expect.extend(matchers as any);

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement window.matchMedia / IntersectionObserver
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
  }
  if (!('IntersectionObserver' in window)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
}
