// Сверка воспроизводимости между средами (ТЗ, раздел 10: одна спецификация — один вердикт в любом
// браузере). Один и тот же набор испытаний считается в Node и в браузере, сравниваются вердикты и числа.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { ProgramRun, type ProgramId } from './programs.ts';
import { analyze } from './analyze.ts';
import { resultDigest } from './report.ts';
import { buildVehicle, programOptions, type TestState } from './vehicle.ts';

export const REPRO_CASES: [string, ProgramId][] = [
  ['ornithopter', 'tethered'], ['cessna172', 'flight'], ['r22', 'hover'], ['quadcopter', 'hover'], ['snowbird', 'tunnel'], ['smartbird', 'tunnel'],
];

export interface ReproRow {
  id: string;
  verdict: string;
  digest: string;
  numbers: Record<string, number>;
}

export function reproRun(RAPIER: typeof RAPIER_NS): ReproRow[] {
  return REPRO_CASES.map(([preset, program]) => {
    const st: TestState = { vehicle: { preset }, overrides: {}, program };
    const { spec } = buildVehicle(st);
    const run = new ProgramRun(RAPIER, spec, program, programOptions(st));
    const r = run.runToEnd();
    run.free();
    return {
      id: `${preset}/${program}`,
      verdict: analyze(r).kind,
      digest: resultDigest(r),
      numbers: {
        minMargin: r.minMargin, powerMean: r.powerMean, liftToWeightMax: r.liftToWeightMax, crewPeakG: r.crewPeakG,
        firstBreak: r.breaks[0]?.t ?? NaN, power: r.tunnel?.power ?? r.hover?.power ?? NaN, vStall: r.flight?.vStall ?? NaN,
      },
    };
  });
}

/** Наибольшее относительное расхождение чисел двух прогонов. */
export function maxDiff(a: ReproRow, b: ReproRow): { key: string; rel: number } {
  let worst = { key: '', rel: 0 };
  for (const k of Object.keys(a.numbers)) {
    const x = a.numbers[k], y = b.numbers[k];
    if (!Number.isFinite(x) && !Number.isFinite(y)) continue;
    const rel = Math.abs(x - y) / Math.max(1e-12, Math.abs(x), Math.abs(y));
    if (!(rel <= worst.rel)) worst = { key: k, rel: Number.isFinite(rel) ? rel : Infinity };
  }
  return worst;
}
