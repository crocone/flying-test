// Проверка генерации по картинке на наборе из 15 изображений (ТЗ, раздел 11, этап 5).
// Обращается к настоящему ИИ и стоит денег. Запуск: npm run image-eval [-- id1 id2 ...]
// Приёмка: ≥ 12 из 15 — верный класс и число крыльев или винтов; пропорции — в пределах 25 %;
// изображение без транспорта отклоняется с объяснением.
import { makeClient } from '../server/client.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, type GenerateResult } from '../server/generate.ts';
import { checkImage } from '../server/image.ts';
import { IMAGE_CASES, scoreCase, TOLERANCE } from '../tools/image-cases.ts';

const only = process.argv.slice(2);
const cases = only.length ? IMAGE_CASES.filter((c) => only.includes(c.id)) : IMAGE_CASES;
const maybe = makeClient(); // только при явном ключе; через прокси, если задан
if (!maybe) {
  console.log('Нужен ключ: впишите ANTHROPIC_API_KEY в .env или задайте переменную. Проверка обращается к ИИ и стоит денег.');
  process.exit(2);
}
const client = maybe;
const CONCURRENCY = 4;

async function pool<T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      res[k] = await fn(items[k]);
    }
  }));
  return res;
}

const rows = await pool(cases, async (c) => {
  const buf = readFileSync(`data/image-cases/${c.id}.png`);
  const chk = checkImage(buf);
  if (!chk.ok) throw new Error(`${c.id}: ${chk.error}`);
  let r: GenerateResult;
  try {
    r = await generate(client, c.text ?? '', { type: chk.type!, data: buf.toString('base64') });
  } catch (e) {
    r = { ok: false, error: e instanceof Error ? e.message : String(e), attempts: 0, fixes: [], steps: [], ms: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, model: '' };
  }
  // Без разбора от ИИ ошибка — от запроса (сеть, ключ), а не решение модели.
  return { c, r, s: scoreCase(c, r.ok ? r.design! : null, r.error, !!r.analysis) };
});

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(0)} %`);
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
console.log(`\n${pad('изображение', 18)} ${pad('опознано', 9)} ${pad('пропорции', 22)} ${pad('размеры', 18)} ${pad('время', 6)} ${pad('$', 6)} замечания`);
let identified = 0, ratioOk = 0, ratioAll = 0, cost = 0, maxMs = 0;
for (const { c, r, s } of rows) {
  identified += s.identified ? 1 : 0;
  for (const x of s.ratios) { ratioAll++; ratioOk += x.ok ? 1 : 0; }
  cost += r.costUsd;
  maxMs = Math.max(maxMs, r.ms);
  const ratios = s.ratios.map((x) => `${x.ok ? '✓' : '✗'}${pct(x.dev)}`).join(' ') || '—';
  const sizes = s.sizes.map((x) => `${x.ok ? '✓' : '✗'}${pct(x.dev)}`).join(' ') || '—';
  const scale = r.analysis?.image?.scaleReference ? `масштаб: ${r.analysis.image.scaleReference.what}` : '';
  console.log(`${pad(c.id, 18)} ${pad(s.identified ? 'да' : 'НЕТ', 9)} ${pad(ratios, 22)} ${pad(sizes, 18)} ${pad((r.ms / 1000).toFixed(0) + ' с', 6)} ${pad(r.costUsd.toFixed(3), 6)} ${[...s.problems, scale].filter(Boolean).join('; ')}`);
}
console.log('\nПо шагам (время, выходные токены):');
for (const { c, r } of rows) console.log(`  ${pad(c.id, 18)} ${r.steps.map((x) => `${x.name} ${(x.ms / 1000).toFixed(0)} с/${x.output}`).join(' · ')}${r.fixes.length ? `  ← исправлялось: ${r.fixes.flat().join('; ')}` : ''}`);
console.log(`\nОпознано (класс и число крыльев/винтов, отказ для не-транспорта): ${identified} из ${rows.length} — нужно не меньше 12 из 15.`);
console.log(`Пропорции в пределах ${TOLERANCE * 100} %: ${ratioOk} из ${ratioAll}.`);
console.log(`Стоимость: $${cost.toFixed(2)}, самая долгая генерация ${(maxMs / 1000).toFixed(0)} с.`);
writeFileSync('data/image-eval-last.json', JSON.stringify(rows.map(({ c, r, s }) => ({ id: c.id, score: s, error: r.error, image: r.analysis?.image ?? null, design: r.design ?? null, ms: r.ms, costUsd: r.costUsd, steps: r.steps, fixes: r.fixes })), null, 1));
