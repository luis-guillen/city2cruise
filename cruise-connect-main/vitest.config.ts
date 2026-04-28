import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Hito 6 QA — excluir tests E2E de Playwright (que tienen su propio runner)
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'text', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/', 'dist/', 'e2e/',
        'src/components/ui/',  // shadcn auto-generated
        'src/__tests__/**',
        'src/test/**',
        '**/*.config.*',
        'src/main.tsx',
        'src/i18n/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
