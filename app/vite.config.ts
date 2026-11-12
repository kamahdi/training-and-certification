import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local runs listen on localhost only. Set DEV_HOST=0.0.0.0 to reach the dev server from outside
// the machine (a cloud container's preview, a phone on the same network); any Host header is then accepted.
const devHost = process.env.DEV_HOST;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    ...(devHost ? { host: devHost, allowedHosts: true as const } : {}),
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
