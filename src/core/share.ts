// Сохранённый отчёт для постоянной ссылки (ТЗ, разделы 8 и этап 6).
// Хранится состояние испытания (из него отчёт пересчитывается в браузере зрителя) и снимок:
// готовый отчёт и прореженные графики — чтобы ссылка открывалась сразу, даже на телефоне.
// Снимок присылает браузер автора, поэтому ему не верят на слово: страница пересчитывает
// испытание и сверяет отпечаток телеметрии; при расхождении показывает пересчитанный отчёт.
import { z } from 'zod';
import type { Report } from './report.ts';
import { parseState, type TestState } from './vehicle.ts';

const str = (n: number) => z.string().max(n);
const num = z.number().nullable(); // NaN и бесконечность в JSON становятся null

export const snapshotSchema = z.object({
  v: z.literal(1),
  lang: z.enum(['ru', 'en']),
  digest: str(16),
  report: z.object({
    vehicle: str(200),
    program: str(200),
    verdict: z.object({
      kind: z.enum(['breaks', 'crew', 'no-lift', 'marginal', 'flies', 'n/a']),
      title: str(100),
      reasons: z.array(str(800)).max(6),
      warnings: z.array(str(800)).max(10),
      crewLevel: z.enum(['comfortable', 'hard', 'injurious', 'lethal']),
    }),
    event: str(300),
    comparisons: z.array(str(800)).max(10),
    telemetry: z.array(z.object({
      key: str(40), label: str(200), value: str(400), note: str(800).optional(), level: z.enum(['ok', 'warn', 'bad']).optional(),
    })).max(40),
    disclaimer: str(600),
  }),
  charts: z.object({
    t: z.array(num).max(800),
    margin: z.array(num).max(800),
    lift: z.array(num).max(800),
    power: z.array(num).max(800),
    powerAvailable: z.number(),
    powerNeed: z.number(),
    hasMargin: z.boolean(),
  }),
  influence: z.array(str(600)).max(5).optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const MAX_SHARE_BYTES = 256 * 1024;

export function parseShare(body: unknown): { state: TestState; snapshot: Snapshot } | { error: string } {
  const b = body as { state?: unknown; snapshot?: unknown } | null;
  if (!b || typeof b !== 'object') return { error: 'пустой запрос' };
  const st = parseState(b.state);
  if (!st.state) return { error: `состояние испытания: ${st.error}` };
  const sn = snapshotSchema.safeParse(b.snapshot);
  if (!sn.success) return { error: `снимок отчёта не по схеме: ${sn.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  return { state: st.state, snapshot: sn.data };
}

/** Прореживание ряда для графика: по паре минимум/максимум на корзину, чтобы не терять колебания. */
export function thin(t: ArrayLike<number>, ys: ArrayLike<number>[], points = 300): { t: (number | null)[]; ys: (number | null)[][] } {
  const n = t.length;
  const clean = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(5)) : null);
  if (n <= points * 2) return { t: Array.from(t, clean), ys: ys.map((y) => Array.from(y, clean)) };
  const outT: (number | null)[] = [];
  const outY: (number | null)[][] = ys.map(() => []);
  for (let b = 0; b < points; b++) {
    const i0 = Math.floor((b * n) / points), i1 = Math.floor(((b + 1) * n) / points);
    // В корзине две точки: где минимум и где максимум первого ряда; остальные ряды берутся в тех же точках.
    let lo = i0, hi = i0;
    for (let i = i0; i < i1; i++) {
      if (ys[0][i] < ys[0][lo]) lo = i;
      if (ys[0][i] > ys[0][hi]) hi = i;
    }
    for (const i of lo <= hi ? [lo, hi] : [hi, lo]) {
      outT.push(clean(t[i]));
      ys.forEach((y, k) => outY[k].push(clean(y[i])));
    }
  }
  return { t: outT, ys: outY };
}

export type { Report };
