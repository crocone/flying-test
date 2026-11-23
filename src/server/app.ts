// Обработчик запросов сервиса (ТЗ, разделы 4 и 10, этап 6): генерация через ИИ с лимитами,
// хранение отчётов по постоянным ссылкам, мониторинг затрат, раздача собранной страницы.
// Вынесен из server.ts, чтобы его можно было проверить автоматически с подставным ИИ.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { generate as realGenerate, MODEL, type GenerateResult, type ImageInput } from './generate.ts';
import { checkImage, MAX_API_BYTES } from './image.ts';
import { newId, startOfDayUtc, type Store } from './store.ts';
import { MAX_SHARE_BYTES, parseShare } from '../core/share.ts';
import { wireState } from '../core/vehicle.ts';

export type Lang = 'ru' | 'en';

export interface Limits {
  perIpHour: number; // генераций в час с одного адреса
  perUserHour: number; // в час от одного браузера (cookie)
  perUserDay: number;
  budgetUsdPerDay: number; // общий дневной бюджет на ИИ
  reportsPerIpHour: number;
}

export const DEFAULT_LIMITS: Limits = { perIpHour: 30, perUserHour: 10, perUserDay: 40, budgetUsdPerDay: 10, reportsPerIpHour: 60 };

export interface AppOptions {
  store: Store;
  client: Pick<Anthropic, 'beta'> | null;
  limits?: Partial<Limits>;
  staticDir?: string; // собранная страница (vite build); без неё — только API
  adminToken?: string;
  trustProxy?: boolean; // брать адрес из X-Forwarded-For (за обратным прокси)
  now?: () => number;
  generate?: typeof realGenerate;
}

const MAX_TEXT = 2000;
const MAX_BODY = Math.ceil((MAX_API_BYTES * 4) / 3) + 64 * 1024;

// Сообщения сервера на двух языках.
const M = {
  notFound: { ru: 'нет такого адреса', en: 'no such address' },
  badJson: { ru: 'запрос не в формате JSON', en: 'request is not valid JSON' },
  tooBig: { ru: 'слишком большой запрос', en: 'request too large' },
  empty: { ru: 'пустое описание', en: 'empty description' },
  long: { ru: `описание длиннее ${MAX_TEXT} символов`, en: `description longer than ${MAX_TEXT} characters` },
  badImage: { ru: 'изображение повреждено', en: 'image is corrupted' },
  imageRejected: { ru: 'изображение не принято', en: 'image rejected' },
  noKey: { ru: 'на сервере не задан ключ ИИ (ANTHROPIC_API_KEY)', en: 'the server has no AI key (ANTHROPIC_API_KEY)' },
  keyRejected: { ru: 'ключ ИИ не принят', en: 'AI key rejected' },
  aiBusy: { ru: 'ИИ перегружен запросами, повторите через минуту', en: 'the AI is overloaded, try again in a minute' },
  aiOffline: { ru: 'нет связи с ИИ', en: 'cannot reach the AI' },
  internal: { ru: 'внутренняя ошибка сервера', en: 'internal server error' },
  free: {
    ru: 'Правка допущений, повторные запуски и готовые примеры бесплатны и работают без ограничений.',
    en: 'Editing assumptions, re-running tests and the ready-made examples are free and unlimited.',
  },
  reportMissing: { ru: 'отчёт не найден: ссылка неверна или отчёт удалён', en: 'report not found: the link is wrong or the report was deleted' },
  reportsLimit: { ru: 'слишком много сохранённых отчётов с вашего адреса за час, попробуйте позже', en: 'too many reports saved from your address this hour, try later' },
} satisfies Record<string, Record<Lang, string>>;

function limitMessage(kind: 'ip' | 'userHour' | 'userDay' | 'budget', n: number, lang: Lang, retryMin: number): string {
  const free = M.free[lang];
  if (lang === 'en') {
    if (kind === 'budget') return `Today's AI budget for the whole service is used up; generation resumes at 00:00 UTC. ${free}`;
    const per = kind === 'userDay' ? 'per day' : 'per hour';
    return `Limit reached: no more than ${n} AI generations ${per}${kind === 'ip' ? ' from one address' : ''}. Try again in about ${retryMin} min. ${free}`;
  }
  if (kind === 'budget') return `Дневной бюджет сервиса на ИИ исчерпан, генерация снова заработает в 03:00 по Москве (00:00 UTC). ${free}`;
  const per = kind === 'userDay' ? 'в сутки' : 'в час';
  return `Лимит исчерпан: не больше ${n} генераций через ИИ ${per}${kind === 'ip' ? ' с одного адреса' : ''}. Попробуйте примерно через ${retryMin} мин. ${free}`;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  // Rapier — WebAssembly, поэтому wasm-unsafe-eval; фоновый расчёт — модульный Worker; стили страницы встроены.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name && v && /^[A-Za-z0-9]{8,32}$/.test(v)) return v;
  }
  return null;
}

function langOf(req: IncomingMessage, body?: { lang?: unknown }): Lang {
  if (body?.lang === 'en' || body?.lang === 'ru') return body.lang;
  const al = String(req.headers['accept-language'] ?? '').toLowerCase();
  return al.startsWith('ru') || (al.includes('ru') && !al.startsWith('en')) ? 'ru' : 'en';
}

export function createApp(o: AppOptions) {
  const L: Limits = { ...DEFAULT_LIMITS, ...o.limits };
  const now = o.now ?? Date.now;
  const gen = o.generate ?? realGenerate;
  const store = o.store;

  const send = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };

  async function readJson(req: IncomingMessage, max: number): Promise<any> {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > max) throw new RangeError('too big');
    }
    return JSON.parse(raw || '{}');
  }

  function ipOf(req: IncomingMessage): string {
    if (o.trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress ?? '?';
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!o.staticDir) return false;
    // Страницы приложения: главная, отчёт по ссылке, мониторинг.
    let file = path;
    if (path === '/' || /^\/r\/[A-Za-z0-9]{6,16}\/?$/.test(path)) file = '/index.html';
    else if (path === '/admin' || path === '/admin/') file = '/admin.html';
    const full = normalize(join(o.staticDir, decodeURIComponent(file)));
    if (!full.startsWith(normalize(o.staticDir) + sep) && full !== normalize(o.staticDir)) return false; // выход за папку
    try {
      const st = await stat(full);
      if (!st.isFile()) return false;
      const body = await readFile(full);
      const hashed = /\/assets\//.test(file);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
        'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    } catch {
      return false;
    }
  }

  async function handleGenerate(req: IncomingMessage, res: ServerResponse, ip: string, uid: string, setCookie: Record<string, string>) {
    const t = now();
    const ipHash = store.hashIp(ip);
    let body: any;
    try {
      body = await readJson(req, MAX_BODY);
    } catch (e) {
      const lang = langOf(req);
      return send(res, e instanceof RangeError ? 413 : 400, { ok: false, error: e instanceof RangeError ? M.tooBig[lang] : M.badJson[lang] }, setCookie);
    }
    const lang = langOf(req, body);
    // Лимиты: дневной бюджет сервиса, затем браузер (сутки, час), затем адрес.
    const hour = 3600e3;
    if (store.costSince(startOfDayUtc(t)) >= L.budgetUsdPerDay) return send(res, 429, { ok: false, limit: 'budget', error: limitMessage('budget', 0, lang, 0) }, setCookie);
    if (store.generationsSince('uid', uid, t - 86400e3) >= L.perUserDay) return send(res, 429, { ok: false, limit: 'userDay', error: limitMessage('userDay', L.perUserDay, lang, 60) }, setCookie);
    if (store.generationsSince('uid', uid, t - hour) >= L.perUserHour) return send(res, 429, { ok: false, limit: 'userHour', error: limitMessage('userHour', L.perUserHour, lang, 60) }, setCookie);
    if (store.generationsSince('ip', ipHash, t - hour) >= L.perIpHour) return send(res, 429, { ok: false, limit: 'ip', error: limitMessage('ip', L.perIpHour, lang, 60) }, setCookie);

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    // Изображение не сохраняется и не пишется в журнал: оно уходит только в запрос к ИИ.
    let image: ImageInput | undefined;
    if (body.image !== undefined && body.image !== null) {
      const data = typeof body.image?.data === 'string' ? body.image.data : '';
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return send(res, 400, { ok: false, error: M.badImage[lang] }, setCookie);
      const c = checkImage(Buffer.from(data, 'base64'), body.image.type);
      if (!c.ok) return send(res, 400, { ok: false, error: `${M.imageRejected[lang]}: ${c.error}` }, setCookie);
      image = { type: c.type!, data };
    }
    if (!text && !image) return send(res, 400, { ok: false, error: M.empty[lang] }, setCookie);
    if (text.length > MAX_TEXT) return send(res, 400, { ok: false, error: M.long[lang] }, setCookie);
    if (!o.client) return send(res, 503, { ok: false, error: M.noKey[lang] }, setCookie);

    const log = (ok: boolean, status: number, r?: Partial<GenerateResult>, error?: string) =>
      store.logGeneration({ ts: t, ipHash, uid, ok, status, ms: now() - t, costUsd: r?.costUsd ?? 0, model: r?.model ?? MODEL, image: !!image, error: error?.slice(0, 300) });
    try {
      const r = await gen(o.client, text, image, lang);
      log(r.ok, r.ok ? 200 : 422, r, r.ok ? undefined : r.error);
      send(res, r.ok ? 200 : 422, r, setCookie);
    } catch (e) {
      let code = 500, msg = M.internal[lang];
      if (e instanceof Anthropic.AuthenticationError || (e instanceof Error && /Identity|credential/i.test(e.name + e.message))) [code, msg] = [503, M.keyRejected[lang]];
      else if (e instanceof Anthropic.RateLimitError) [code, msg] = [503, M.aiBusy[lang]];
      else if (e instanceof Anthropic.APIConnectionError) [code, msg] = [503, M.aiOffline[lang]];
      else if (e instanceof Anthropic.APIError) [code, msg] = [502, `AI ${e.status}: ${e.message}`];
      else console.error(e);
      log(false, code, undefined, msg);
      send(res, code, { ok: false, error: msg }, setCookie);
    }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        // Анонимный номер браузера — только для лимитов, без регистрации.
        let uid = cookie(req, 'uid');
        const setCookie: Record<string, string> = {};
        if (!uid) {
          uid = newId(16);
          const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket as { encrypted?: boolean }).encrypted ? '; Secure' : '';
          setCookie['Set-Cookie'] = `uid=${uid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
        }
        const ip = ipOf(req);
        const lang = langOf(req);
        if (req.method === 'GET' && path === '/api/health')
          return send(res, 200, { ok: true, model: MODEL, ai: o.client !== null, limits: { perUserHour: L.perUserHour, perIpHour: L.perIpHour } }, setCookie);
        if (req.method === 'POST' && path === '/api/generate') return await handleGenerate(req, res, ip, uid, setCookie);
        if (req.method === 'POST' && path === '/api/reports') {
          const ipHash = store.hashIp(ip);
          if (store.reportsSince(ipHash, now() - 3600e3) >= L.reportsPerIpHour) return send(res, 429, { ok: false, error: M.reportsLimit[lang] }, setCookie);
          let body: unknown;
          try {
            body = await readJson(req, MAX_SHARE_BYTES);
          } catch (e) {
            return send(res, e instanceof RangeError ? 413 : 400, { ok: false, error: e instanceof RangeError ? M.tooBig[lang] : M.badJson[lang] }, setCookie);
          }
          const p = parseShare(body);
          if ('error' in p) return send(res, 400, { ok: false, error: p.error }, setCookie);
          const id = store.saveReport(wireState(p.state), p.snapshot, ipHash, now());
          return send(res, 201, { ok: true, id, path: `/r/${id}` }, setCookie);
        }
        const m = path.match(/^\/api\/reports\/([A-Za-z0-9]{6,16})$/);
        if (req.method === 'GET' && m) {
          const r = store.getReport(m[1]);
          return r ? send(res, 200, { ok: true, ...r }, setCookie) : send(res, 404, { ok: false, error: M.reportMissing[lang] }, setCookie);
        }
        if (req.method === 'GET' && path === '/api/admin/metrics') {
          // Мониторинг выключен, пока не задан ADMIN_TOKEN; иначе нужен заголовок Authorization: Bearer <ADMIN_TOKEN>.
          if (!o.adminToken) return send(res, 404, { ok: false, error: M.notFound[lang] });
          if (req.headers.authorization !== `Bearer ${o.adminToken}`) return send(res, 401, { ok: false, error: 'unauthorized' });
          return send(res, 200, { ok: true, limits: L, ...store.metrics(now()) });
        }
        return send(res, 404, { ok: false, error: M.notFound[lang] }, setCookie);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, path))) return;
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { ok: false, error: M.internal.ru });
    }
  };
}
