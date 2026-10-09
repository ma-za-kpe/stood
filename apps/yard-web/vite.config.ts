import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {
    port: 3002,
    host: '0.0.0.0',
    proxy: { '/app/api': { target: 'http://yard-api:3001', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: process.env.YARD_UI_COVERAGE === '1' ? 'hidden' : false },
});
