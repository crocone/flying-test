// Сервер сервиса (ТЗ, раздел 4): держит ключ ИИ, ограничивает частоту запросов, хранит отчёты,
// раздаёт собранную страницу. Вся физика — в браузере.
//   npm run api     — только API (страницу раздаёт vite в режиме разработки)
//   npm run serve   — API и собранная страница из dist/ (после npm run build)
// Настройки — переменные окружения или .env; список — в .env.example.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, DEFAULT_LIMITS } from './app.ts';
import { makeClient } from './client.ts';
import { MODEL } from './generate.ts';
import { Store } from './store.ts';

const env = process.env;
const num = (k: string, d: number) => (env[k] !== undefined && env[k] !== '' && Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
const PORT = num('PORT', 8139);
const staticArg = process.argv.includes('--static');
// Пути по умолчанию — от корня проекта, а не от папки, из которой запущен сервер.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const staticDir = staticArg ? resolve(ROOT, env.STATIC_DIR ?? 'dist') : undefined;
const dbPath = env.DB_PATH === ':memory:' ? ':memory:' : resolve(ROOT, env.DB_PATH ?? 'var/stand.db');
if (staticDir && !existsSync(staticDir)) {
  console.error(`Нет собранной страницы в ${staticDir}: сначала npm run build`);
  process.exit(1);
}

let client = null;
try {
  client = makeClient(); // только при явном ключе; через прокси, если задан
} catch {
  client = null;
}

const store = new Store(dbPath);
const handler = createApp({
  store,
  client,
  staticDir,
  adminToken: env.ADMIN_TOKEN || undefined,
  trustProxy: env.TRUST_PROXY === '1',
  limits: {
    perIpHour: num('GEN_LIMIT_PER_HOUR', DEFAULT_LIMITS.perIpHour),
    perUserHour: num('GEN_LIMIT_PER_USER_HOUR', DEFAULT_LIMITS.perUserHour),
    perUserDay: num('GEN_LIMIT_PER_USER_DAY', DEFAULT_LIMITS.perUserDay),
    budgetUsdPerDay: num('GEN_BUDGET_USD_PER_DAY', DEFAULT_LIMITS.budgetUsdPerDay),
    reportsPerIpHour: num('REPORTS_PER_IP_HOUR', DEFAULT_LIMITS.reportsPerIpHour),
  },
});

createServer(handler).listen(PORT, () =>
  console.log(`Стенд: http://localhost:${PORT}${staticDir ? '' : ' (только API)'} · модель ${MODEL} · ключ ИИ ${client ? 'задан' : 'НЕ задан'} · ` +
    `мониторинг ${env.ADMIN_TOKEN ? '/admin' : 'выключен (нет ADMIN_TOKEN)'} · база ${dbPath}`),
);
