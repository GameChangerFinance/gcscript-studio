import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/config.ts'],
      thresholds: { statements: 85, branches: 75, functions: 85, lines: 85 },
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
