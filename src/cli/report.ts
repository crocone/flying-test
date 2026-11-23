// Отчёт об испытании в командной строке: npm run report -- <аппарат> <программа> [--influence]
import RAPIER from '@dimforge/rapier3d-compat';
import { ProgramRun, PROGRAMS, type ProgramId } from '../core/programs.ts';
import { buildReport } from '../core/report.ts';
import { buildVehicle, programOptions, type TestState } from '../core/vehicle.ts';
import { sensitivity, describeInfluence } from '../core/sensitivity.ts';
import { PRESETS } from '../presets/index.ts';

const args = process.argv.slice(2);
const [preset = 'ornithopter', program = 'tethered'] = args.filter((a) => !a.startsWith('--'));
if (!PRESETS[preset] || !(program in PROGRAMS)) {
  console.log(`Аппараты: ${Object.keys(PRESETS).join(', ')}\nПрограммы: ${Object.keys(PROGRAMS).join(', ')}`);
  process.exit(2);
}
await RAPIER.init();
const state: TestState = { vehicle: { preset }, overrides: {}, program: program as ProgramId };
const { spec } = buildVehicle(state);
const run = new ProgramRun(RAPIER, spec, state.program, programOptions(state));
const rep = buildReport(run.runToEnd(), spec);
run.free();
console.log(`\n${rep.vehicle} · ${rep.program}\nВЕРДИКТ: ${rep.verdict.title}. ${rep.event}`);
for (const x of rep.verdict.reasons) console.log(`  • ${x}`);
for (const x of rep.verdict.warnings) console.log(`  ! ${x}`);
console.log('Ориентиры:');
for (const x of rep.comparisons) console.log(`  ~ ${x}`);
console.log('Телеметрия:');
for (const r of rep.telemetry) console.log(`  ${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
if (args.includes('--influence')) {
  const s = sensitivity(RAPIER, state);
  console.log(`Влияние допущений (${(s.ms / 1000).toFixed(1)} с):`);
  for (const x of s.items) console.log(`  ${describeInfluence(x)}`);
}
console.log(rep.disclaimer);
