import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/main.ts', 'src/main/preload.ts'],
    },
  },
});
