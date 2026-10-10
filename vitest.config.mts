import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Scoped to types/ + lib/, so the app's own logic tests can never collide
// with the types suite and the types suite can never pick up app tests.
export default defineConfig({
  test: {
    include: ['types/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['node_modules/**', 'app/**', 'public/**', '.next/**'],
  },
  resolve: {
    alias: {
      // Match the app's tsconfig "@/*" path so lib/ code (and its imports of
      // the @/types barrel) resolve identically under Vitest and Next.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});