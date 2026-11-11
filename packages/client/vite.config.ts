import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true, fs: { allow: ['..'] }, proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
