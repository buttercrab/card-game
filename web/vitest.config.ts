import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Unit tests for the client's pure logic (`npm test`); the pages and the
// table are covered by Playwright (e2e/).
export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
