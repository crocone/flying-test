// Фоновый расчёт: обратная задача, влияние допущений и повторный расчёт отчёта по ссылке —
// по многу прогонов, не тормозя страницу (на телефоне особенно).
import RAPIER from '@dimforge/rapier3d-compat';
import { solveInverse, describeInverse } from '../core/inverse.ts';
import { sensitivity, describeInfluence, type Metrics } from '../core/sensitivity.ts';
import { buildVehicle, programOptions, type TestState } from '../core/vehicle.ts';
import { overload } from '../core/report.ts';
import { ProgramRun } from '../core/programs.ts';
import type { Snapshot } from '../core/share.ts';
import { Series } from './recorder.ts';
import { setLang } from '../core/i18n.ts';
import { makeSnapshot } from './snapshot.ts';

export type Job = { id: number; type: 'inverse' | 'influence' | 'verify'; state: TestState; lang?: 'ru' | 'en' };
export type JobReply =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'inverse'; ms: number; verdict: string; lines: string[] }
  | { id: number; type: 'influence'; ms: number; lines: string[]; base: Metrics | null; overload: string | null }
  | { id: number; type: 'verify'; ms: number; snapshot: Snapshot }
  | { id: number; type: 'error'; message: string };

const ready = RAPIER.init();
const post = (m: JobReply) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Job>) => {
  await ready;
  const { id, type, state } = e.data;
  setLang(e.data.lang ?? 'ru');
  try {
    const { spec, errors } = buildVehicle(state);
    if (errors.length) throw new Error(`Спецификация отклонена: ${errors.join('; ')}`);
    if (type === 'inverse') {
      const x = solveInverse(RAPIER, spec, state.program, programOptions(state));
      post({ id, type, ms: x.ms, verdict: x.base.verdict.title, lines: describeInverse(x) });
    } else if (type === 'verify') {
      // То же испытание, что у автора ссылки: тот же отпечаток телеметрии — тот же отчёт.
      const t0 = Date.now();
      const run = new ProgramRun(RAPIER, spec, state.program, programOptions(state));
      const series = new Series();
      let lastPost = 0;
      while (!run.done) {
        run.advance(0.25, () => series.push(run.sim.sample, run.sim.mainCycle()?.hz ?? 0));
        if (Date.now() - lastPost > 250) {
          lastPost = Date.now();
          post({ id, type: 'progress', done: Math.round(run.sim.t * 10), total: Math.round(Math.max(run.sim.t, run.r.simTime) * 10) });
        }
      }
      const snapshot = makeSnapshot(run.r, spec, series, e.data.lang ?? 'ru');
      run.free();
      post({ id, type, ms: Date.now() - t0, snapshot });
    } else {
      const s = sensitivity(RAPIER, state, (done, total) => post({ id, type: 'progress', done, total }));
      const m = s.base?.margin ?? null;
      post({
        id, type, ms: s.ms,
        lines: s.items.slice(0, 3).map(describeInfluence),
        base: s.base,
        overload: m !== null && Number.isFinite(m) && m < 1 ? overload(m) : null,
      });
    }
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
