import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'test/component/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['test/component/**', 'jsdom']],
    setupFiles: ['test/setup.ts'],
    fileParallelism: true,
    testTimeout: 20000,
  },
});
