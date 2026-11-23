// Проверка генерации на наборе описаний (ТЗ, раздел 11, этап 2).
// Обращается к настоящему ИИ и стоит денег. Запуск: npm run gen-eval [-- id1 id2 ...]
// Критерии приёмки: не менее 18 из 20 описаний дают корректную спецификацию с верным
// классом; каждое оценённое поле — в допущениях; генерация укладывается в 30 с.
import { makeClient } from '../server/client.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { generate, type GenerateResult } from '../server/generate.ts';
import { getPath } from '../core/spec.ts';

interface Case { id: string; text: string; class: string; expect: Record<string, number>; mustAssume: string[] }
const data = JSON.parse(readFileSync('data/generation-cases.json', 'utf8')) as { cases: Case[]; outOfScope: { id: string; text: string }[] };
const only = process.argv.slice(2);
const cases = only.length ? data.cases.filter((c) => only.includes(c.id)) : data.cases;
const outs = only.length ? data.outOfScope.filter((c) => only.includes(c.id)) : data.outOfScope;

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

const safe = async (text: string): Promise<GenerateResult> => {
  try {
    return await generate(client, text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), attempts: 0, fixes: [], steps: [], ms: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, model: '' };
  }
};

const rows = await pool(cases, async (c) => {
  const r = await safe(c.text);
  const problems: string[] = [];
  if (!r.ok) problems.push(r.error ?? 'ошибка');
  else {
    if (r.design!.vehicleClass !== c.class) problems.push(`класс ${r.design!.vehicleClass}, ожидался ${c.class}`);
    for (const [path, v] of Object.entries(c.expect)) {
      const got = getPath(r.design, path);
      if (got !== v) problems.push(`${path} = ${got}, ожидалось ${v}`);
    }
    const listed = new Set(r.design!.assumptions.map((a) => a.field));
    const missing = c.mustAssume.filter((f) => !listed.has(f));
    if (missing.length) problems.push(`не в допущениях: ${missing.join(', ')}`);
  }
  if (r.ms > 30000) problems.push(`дольше 30 с: ${(r.ms / 1000).toFixed(1)} с`);
  return { c, r, problems };
});
const outRows = await pool(outs, async (c) => ({ c, r: await safe(c.text) }));

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
console.log(`\n${pad('описание', 28)} ${pad('итог', 8)} ${pad('время', 7)} ${pad('$', 7)} попыток  замечания`);
for (const { c, r, problems } of rows) {
  console.log(`${pad(c.id, 28)} ${pad(problems.length ? 'ПРОВАЛ' : 'ок', 8)} ${pad((r.ms / 1000).toFixed(1) + ' с', 7)} ${pad(r.costUsd.toFixed(3), 7)} ${String(r.attempts).padEnd(8)} ${problems.join('; ')}`);
}
for (const { c, r } of outRows) {
  const ok = !r.ok && /не летательный/i.test(r.error ?? '');
  console.log(`${pad('вне темы: ' + c.id, 28)} ${pad(ok ? 'ок' : 'ПРОВАЛ', 8)} ${pad((r.ms / 1000).toFixed(1) + ' с', 7)} ${pad(r.costUsd.toFixed(3), 7)} ${'-'.padEnd(8)} ${r.ok ? 'принято как аппарат' : r.error}`);
}
const passed = rows.filter((x) => x.problems.length === 0).length;
const all = [...rows.map((x) => x.r), ...outRows.map((x) => x.r)];
const times = rows.map((x) => x.r.ms).sort((a, b) => a - b);
const cost = all.reduce((s, r) => s + r.costUsd, 0);
console.log(`\nКорректных: ${passed} из ${rows.length} (нужно ≥ ${Math.ceil(rows.length * 0.9)})`);
console.log(`Время: медиана ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} с, максимум ${(times.at(-1)! / 1000).toFixed(1)} с`);
console.log(`Стоимость: всего $${cost.toFixed(3)}, в среднем $${(cost / all.length).toFixed(3)} за описание`);
writeFileSync('data/generation-results.json', JSON.stringify({ date: new Date().toISOString(), rows: rows.map(({ c, r, problems }) => ({ id: c.id, problems, ms: r.ms, costUsd: r.costUsd, attempts: r.attempts, model: r.model, design: r.design })) }, null, 1));
process.exit(passed >= Math.ceil(rows.length * 0.9) ? 0 : 1);
