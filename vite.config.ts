import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Запросы /api уходят на сервер (npm run api), ключ ИИ в браузер не попадает.
// Сборка — две страницы: стенд и мониторинг затрат.
export default defineConfig({
  server: {
    proxy: { '/api': { target: 'http://localhost:8139', changeOrigin: true } },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } },
  },
  worker: { format: 'es' },
});
