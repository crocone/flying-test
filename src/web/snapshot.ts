// Снимок отчёта для постоянной ссылки: готовый отчёт, отпечаток телеметрии и прореженные графики.
// Собирается и на странице (после испытания), и в фоновом потоке (повторный расчёт у зрителя).
import { buildReport, powerNeed, resultDigest } from '../core/report.ts';
import { thin, type Snapshot } from '../core/share.ts';
import type { ProgramResult } from '../core/programs.ts';
import type { Spec } from '../core/spec.ts';
import type { Series } from './recorder.ts';

export type ChartData = Snapshot['charts'];

export function chartData(r: ProgramResult, series: Series, points = 300): ChartData {
  const hasMargin = Number.isFinite(r.minMargin);
  const margin = series.col('minMargin'), lift = series.col('liftToWeight'), power = series.col('power');
  const th = thin(series.col('t'), hasMargin ? [margin, lift, power] : [lift, margin, power], points);
  const [a, b, c] = th.ys;
  return {
    t: th.t, margin: hasMargin ? a : b, lift: hasMargin ? b : a, power: c,
    powerAvailable: r.powerAvailable, powerNeed: powerNeed(r), hasMargin,
  };
}

export function makeSnapshot(r: ProgramResult, spec: Spec, series: Series, lang: 'ru' | 'en', influence?: string[]): Snapshot {
  return { v: 1, lang, digest: resultDigest(r), report: buildReport(r, spec), charts: chartData(r, series), ...(influence?.length ? { influence } : {}) };
}
