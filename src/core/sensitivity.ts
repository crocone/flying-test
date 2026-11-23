// Какие допущения сильнее всего влияют на исход (ТЗ, раздел 9: «список допущений, которые
// сильнее всего влияют на исход»). Каждое допущение по очереди меняется на 10 %, испытание
// повторяется без разрушения, и сравниваются запас прочности, нужная мощность и подъёмная сила.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { td, tr } from './i18n.ts';
import { ProgramRun, type ProgramResult } from './programs.ts';
import { analyze, n, type VerdictKind } from './analyze.ts';
import { baseAssumptions, buildVehicle, programOptions, type TestState } from './vehicle.ts';
import { powerNeed } from './report.ts';

export const STEP = 0.1;

export interface Metrics {
  margin: number;
  power: number; // нужная / располагаемая
  powerNeed: number; // Вт
  powerAvailable: number;
  lift: number; // подъёмная сила / вес — та, что решает в программе
  verdict: VerdictKind;
}

export interface Influence {
  path: string;
  label: string;
  unit?: string;
  from: number;
  to: number;
  change: { margin?: number; power?: number; lift?: number }; // относительные изменения
  score: number;
  verdict: VerdictKind;
}

export function metrics(r: ProgramResult): Metrics {
  const lift = r.tunnel ? r.tunnel.liftToWeight : r.hover?.saturated ? r.hover.liftToWeightAtMax : r.liftToWeightMax;
  return { margin: r.minMargin, power: powerNeed(r) / Math.max(1e-9, r.powerAvailable), powerNeed: powerNeed(r), powerAvailable: r.powerAvailable, lift, verdict: analyze(r).kind };
}

function measure(RAPIER: typeof RAPIER_NS, state: TestState): Metrics | null {
  const { spec, errors } = buildVehicle(state);
  if (errors.length) return null;
  const run = new ProgramRun(RAPIER, spec, state.program, { ...programOptions(state), breakable: false });
  const r = run.runToEnd();
  run.free();
  return metrics(r);
}

const rel = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b) > 1e-12 ? a / b - 1 : undefined);

export function sensitivity(
  RAPIER: typeof RAPIER_NS,
  state: TestState,
  onProgress?: (done: number, total: number) => void,
): { base: Metrics | null; items: Influence[]; ms: number } {
  const t0 = Date.now();
  const list = baseAssumptions(state.vehicle);
  const base = measure(RAPIER, state);
  onProgress?.(1, list.length + 1);
  if (!base) return { base, items: [], ms: Date.now() - t0 };
  const items: Influence[] = [];
  list.forEach((a, i) => {
    const from = state.overrides[a.path] ?? a.value;
    let to = from === 0 ? STEP * ((a.max ?? 1) - (a.min ?? 0)) : from * (1 + STEP);
    if (a.max !== undefined && to > a.max) to = from === 0 ? a.min ?? 0 : from * (1 - STEP);
    const m = measure(RAPIER, { ...state, overrides: { ...state.overrides, [a.path]: to } });
    onProgress?.(i + 2, list.length + 1);
    if (!m) return;
    const change = { margin: rel(m.margin, base.margin), power: rel(m.power, base.power), lift: rel(m.lift, base.lift) };
    const score = Math.max(...Object.values(change).map((x) => Math.abs(x ?? 0)));
    items.push({ path: a.path, label: a.label, unit: a.unit, from, to, change, score, verdict: m.verdict });
  });
  items.sort((x, y) => y.score - x.score);
  return { base, items, ms: Date.now() - t0 };
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${n(Math.abs(x) * 100, 2)} %`;

export function describeInfluence(x: Influence): string {
  const d = x.from !== 0 ? signed(x.to / x.from - 1) : `${n(x.from)} → ${n(x.to)}`;
  const parts: string[] = [];
  if (x.change.margin !== undefined && Math.abs(x.change.margin) >= 0.005) parts.push(`${tr('запас прочности', 'safety margin')} ${signed(x.change.margin)}`);
  if (x.change.power !== undefined && Math.abs(x.change.power) >= 0.005) parts.push(`${tr('нужная мощность', 'power required')} ${signed(x.change.power)}`);
  if (x.change.lift !== undefined && Math.abs(x.change.lift) >= 0.005) parts.push(`${tr('подъёмная сила', 'lift')} ${signed(x.change.lift)}`);
  return `${tr(`«${td(x.label)}»`, `“${td(x.label)}”`)} ${d}: ${parts.join(', ') || tr('исход почти не меняется', 'the outcome barely changes')}.`;
}
