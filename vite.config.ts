import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Запросы /api уходят на сервер (npm run api), ключ ИИ в браузер не попадает.
// Сборка — две страницы: стенд и мониторинг затрат.
// Демо на GitHub Pages: STAND_BASE=/flying-test/ STAND_DEMO=1 npm run build — путь сайта и режим без сервера
// (сборка по описанию и сохранение отчётов на сервере выключены, всё остальное считается в браузере).
export default defineConfig({
  base: process.env.STAND_BASE ?? '/',
  define: { __DEMO__: JSON.stringify(process.env.STAND_DEMO === '1') },
  server: {
    proxy: { '/api': { target: 'http://localhost:8139', changeOrigin: true } },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } },
  },
  worker: { format: 'es' },
});
