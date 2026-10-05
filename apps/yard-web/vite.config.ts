import { defineConfig } from 'vite';
export default defineConfig({
  base: '/yard/app/',
  server: {
    port: 3002,
    host: '0.0.0.0',
    proxy: { '/app/api': { target: 'http://yard-api:3001', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
