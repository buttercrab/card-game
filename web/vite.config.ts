import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// In development the Rust server runs on 3030 (`cargo run -p server`).
export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3030', ws: true },
    },
  },
});
