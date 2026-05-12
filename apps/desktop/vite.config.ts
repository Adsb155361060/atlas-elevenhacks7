import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri development server config per https://v2.tauri.app/start/frontend/vite/.
// TAURI_DEV_HOST is set by `tauri dev` when targeting a mobile device or VM.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch src-tauri; cargo handles it.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Production build output goes here; tauri.conf.json points frontendDist at it.
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
  },
}));
