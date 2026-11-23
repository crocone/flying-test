// Запуск испытания из командной строки (ТЗ, раздел 4: ядро без браузера).
// npm run stand -- <аппарат|файл.json> <программа> [--set путь=значение ...] [--material id]
//   [--no-break] [--altitude м] [--cruise м/с] [--wind м/с]
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { PRESETS } from '../presets/index.ts';
import { ProgramRun, PROGRAMS, type ProgramId, type ProgramOptions } from '../core/programs.ts';
import { analyze } from '../core/analyze.ts';
import { applyAssumptions, setPath, validateSpec, type Spec } from '../core/spec.ts';
import { MATERIALS } from '../core/materials.ts';
import { SpecError } from '../core/sim.ts';
import { modeName } from '../core/strength.ts';
import { solveInverse, describeInverse } from '../core/inverse.ts';

const args = process.argv.slice(2);
const [what, prog = 'tethered'] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
if (!what || !(prog in PROGRAMS)) {
  console.log(`Аппараты: ${Object.keys(PRESETS).join(', ')} или путь к JSON\nПрограммы: ${Object.keys(PROGRAMS).join(', ')}`);
  process.exit(2);
}
const opt = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};

let spec: Spec = what in PRESETS ? PRESETS[what] : JSON.parse(readFileSync(what, 'utf8'));
spec = applyAssumptions(spec);
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, value] = args[i + 1].split('=');
  const asm = spec.assumptions.find((x) => x.path === path);
  setPath(spec, path, Number(value));
  for (const l of asm?.linked ?? []) setPath(spec, l, Number(value));
});

const check = validateSpec(spec, Object.keys(MATERIALS));
if (!check.ok) {
  console.log(`Спецификация отклонена:\n- ${check.errors.join('\n- ')}`);
  process.exit(1);
}
await RAPIER.init();
const o: ProgramOptions = {
  breakable: !args.includes('--no-break'),
  altitude: Number(opt('altitude') ?? 0),
  materialOverride: opt('material'),
  cruiseSpeed: opt('cruise') ? Number(opt('cruise')) : undefined,
  windSpeed: opt('wind') ? Number(opt('wind')) : undefined,
};
if (args.includes('--inverse')) {
  const x = solveInverse(RAPIER, spec, prog as ProgramId, o);
  console.log(`
${spec.meta.name} · обратная задача · ${(x.ms / 1000).toFixed(1)} с
Сейчас: ${x.base.verdict.title}`);
  for (const line of describeInverse(x)) console.log(`  • ${line}`);
  process.exit(0);
}
let run: ProgramRun;
try {
  run = new ProgramRun(RAPIER, spec, prog as ProgramId, o);
} catch (e) {
  if (e instanceof SpecError) {
    console.log(e.message);
    process.exit(1);
  }
  throw e;
}
const t0 = performance.now();
const r = run.runToEnd();
const ms = performance.now() - t0;
const v = analyze(r);
const n = (x: number | undefined, d = 3) => (x === undefined || !Number.isFinite(x) ? '—' : Number(x.toPrecision(d)).toLocaleString('ru-RU'));

console.log(`\n${spec.meta.name} · ${PROGRAMS[prog as ProgramId].name}`);
console.log(`Масса ${n(r.totalMass)} кг, шаг 1/${Math.round(1 / run.sim.dt)} с, модельное время ${n(r.simTime)} с за ${n(ms / 1000, 2)} с расчёта`);
console.log(`\nВЕРДИКТ: ${v.title}`);
for (const x of v.reasons) console.log(`  • ${x}`);
for (const x of v.warnings) console.log(`  ! ${x}`);
console.log('\nТелеметрия:');
console.log(r.strengthChecked
  ? `  запас прочности ${n(r.minMargin)} (${r.minMarginPart || '—'}, ${modeName(r.minMarginMode)}, ${Math.round(r.minMarginSpan * 100)} % размаха); до текучести ${n(r.minYieldMargin)}`
  : '  прочность не проверялась: силовой набор не задан');
console.log(`  подъёмная сила / вес: макс ${n(r.liftToWeightMax)}, средн ${n(r.liftToWeightMean)}`);
console.log(`  мощность: пик ${n(r.powerPeak / 1e3)} кВт, средн ${n(r.powerMean / 1e3)} кВт, есть ${n(r.powerAvailable / 1e3)} кВт`);
console.log(`  экипаж: длительно ${n(r.crewSustainedG)} g, пик ${n(r.crewPeakG)} g, вибрация ${n(r.vibrationRms)} м/с²; число Маха до ${n(r.maxMach, 2)}`);
console.log(`  усталость: ${n(r.fatigue.hours)} ч (${r.fatigue.part || '—'})`);
if (r.hover) console.log(`  висение: ${r.hover.achieved ? 'да' : 'нет'}, канал ${n(r.hover.channel)}, мощность ${n(r.hover.power / 1e3)} кВт`);
if (r.flight) {
  const f = r.flight;
  console.log(`  полёт: отрыв ${n(f.vRotate)} м/с, разбег ${n(f.takeoffDistance)} м, макс. скорость ${n(f.vMax)} м/с, сваливание ${n(f.vStall)} м/с`);
  if (f.cruiseSpeed) console.log(`  крейсер ${n(f.cruiseSpeed)} м/с: мощность ${n((f.cruisePower ?? 0) / 1e3)} кВт, газ ${n((f.cruiseThrottle ?? 0) * 100)} %`);
  if (f.loadFactor) console.log(`  перегрузка в манёвре ${n(f.loadFactor)}`);
}
for (const b of r.breaks.slice(0, 4)) console.log(`  разрушение: ${b.part} на ${n(b.t)} с, ${modeName(b.mode)}, ${Math.round(b.spanFrac * 100)} % размаха`);
for (const x of r.notes) console.log(`  примечание: ${x}`);
