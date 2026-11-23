// Хранилище сервиса (ТЗ, этап 6): отчёты по постоянным ссылкам и журнал генераций —
// для лимитов и мониторинга затрат. Встроенный в Node SQLite: один файл на диске, без отдельного
// сервера базы (в ТЗ записан PostgreSQL — для одного узла этого достаточно, см. README).
// Личные данные не хранятся: адрес — только хэшем с солью, текст описаний и картинки — нигде.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface GenerationLog {
  ts: number;
  ipHash: string;
  uid: string;
  ok: boolean;
  status: number;
  ms: number;
  costUsd: number;
  model: string;
  image: boolean;
  error?: string;
}

export interface StoredReport {
  id: string;
  created: number;
  state: unknown;
  snapshot: unknown;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O, 1/l/I

export function newId(len = 10): string {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

export class Store {
  readonly db: DatabaseSync;
  private salt: string;
  constructor(path: string, salt = process.env.IP_SALT ?? 'stand') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.salt = salt;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, created INTEGER NOT NULL, ip_hash TEXT NOT NULL, state TEXT NOT NULL, snapshot TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS reports_ip ON reports (ip_hash, created);
      CREATE TABLE IF NOT EXISTS generations (
        ts INTEGER NOT NULL, ip_hash TEXT NOT NULL, uid TEXT NOT NULL, ok INTEGER NOT NULL, status INTEGER NOT NULL,
        ms INTEGER NOT NULL, cost REAL NOT NULL, model TEXT NOT NULL, image INTEGER NOT NULL, error TEXT
      );
      CREATE INDEX IF NOT EXISTS gen_ts ON generations (ts);
      CREATE INDEX IF NOT EXISTS gen_ip ON generations (ip_hash, ts);
      CREATE INDEX IF NOT EXISTS gen_uid ON generations (uid, ts);
    `);
  }

  hashIp(ip: string): string {
    return createHash('sha256').update(`${this.salt}:${ip}`).digest('hex').slice(0, 16);
  }

  saveReport(state: unknown, snapshot: unknown, ipHash: string, now = Date.now()): string {
    const ins = this.db.prepare('INSERT INTO reports (id, created, ip_hash, state, snapshot) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 5; i++) {
      const id = newId();
      try {
        ins.run(id, now, ipHash, JSON.stringify(state), JSON.stringify(snapshot));
        return id;
      } catch (e) {
        if (!/UNIQUE/.test(String(e))) throw e;
      }
    }
    throw new Error('не удалось подобрать свободный номер отчёта');
  }

  getReport(id: string): StoredReport | null {
    const row = this.db.prepare('SELECT id, created, state, snapshot FROM reports WHERE id = ?').get(id) as
      | { id: string; created: number; state: string; snapshot: string }
      | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE reports SET views = views + 1 WHERE id = ?').run(id);
    return { id: row.id, created: row.created, state: JSON.parse(row.state), snapshot: JSON.parse(row.snapshot) };
  }

  reportsSince(ipHash: string, since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created >= ?').get(ipHash, since) as { n: number }).n;
  }

  logGeneration(g: GenerationLog) {
    this.db.prepare('INSERT INTO generations (ts, ip_hash, uid, ok, status, ms, cost, model, image, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(g.ts, g.ipHash, g.uid, g.ok ? 1 : 0, g.status, Math.round(g.ms), g.costUsd, g.model, g.image ? 1 : 0, g.error ?? null);
  }

  /** Сколько генераций начато с адреса или от пользователя с момента since (считаются и неудачные: они тоже стоят). */
  generationsSince(by: 'ip' | 'uid', key: string, since: number): number {
    const col = by === 'ip' ? 'ip_hash' : 'uid';
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE ${col} = ? AND ts >= ?`).get(key, since) as { n: number }).n;
  }

  costSince(since: number): number {
    return (this.db.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM generations WHERE ts >= ?').get(since) as { c: number }).c;
  }

  metrics(now = Date.now()) {
    const day = 86400e3;
    const days = this.db.prepare(`
      SELECT date(ts / 1000, 'unixepoch') AS day, COUNT(*) AS n, SUM(ok) AS ok, SUM(image) AS images, ROUND(SUM(cost), 4) AS cost,
             ROUND(AVG(ms)) AS avg_ms, MAX(ms) AS max_ms
      FROM generations WHERE ts >= ? GROUP BY day ORDER BY day DESC`).all(now - 30 * day);
    const total = this.db.prepare('SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(cost), 0), 4) AS cost FROM generations').get();
    const recent = this.db.prepare(`SELECT ts, ok, status, ms, ROUND(cost, 4) AS cost, model, image, error FROM generations ORDER BY ts DESC LIMIT 50`).all();
    const errors = this.db.prepare(`SELECT status, error, COUNT(*) AS n FROM generations WHERE ok = 0 AND ts >= ? GROUP BY status, error ORDER BY n DESC LIMIT 20`).all(now - 7 * day);
    const reports = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(views), 0) AS views FROM reports').get();
    const reportsDay = (this.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE created >= ?').get(now - day) as { n: number }).n;
    return { days, total, recent, errors, reports: { ...(reports as object), lastDay: reportsDay }, costToday: this.costSince(startOfDayUtc(now)) };
  }
}

export function startOfDayUtc(now: number): number {
  return Math.floor(now / 86400e3) * 86400e3;
}
