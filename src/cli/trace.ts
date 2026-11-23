// Отладочная трасса программы: раз в секунду печатает состояние аппарата.
// node --experimental-strip-types src/cli/trace.ts <аппарат> <программа> [--altitude м] [--cruise м/с]
import RAPIER from '@dimforge/rapier3d-compat';
import { PRESETS } from '../presets/index.ts';
import { ProgramRun, type ProgramId } from '../core/programs.ts';
import { applyAssumptions } from '../core/spec.ts';
await RAPIER.init();
const [id, prog] = process.argv.slice(2);
const a = process.argv.slice(2);
const opt = (k: string) => (a.includes(`--${k}`) ? Number(a[a.indexOf(`--${k}`) + 1]) : undefined);
const run = new ProgramRun(RAPIER, applyAssumptions(PRESETS[id]), prog as ProgramId, { altitude: opt('altitude'), cruiseSpeed: opt('cruise') });
let next = 0;
let crewMax = 0;
run.runToEnd(() => {
  const s = run.sim.sample;
  crewMax = Math.max(crewMax, s.crewAccel);
  if (run.sim.t < next) return;
  next += 1;
  process.stdout.write(`экипаж до ${crewMax.toFixed(2)}g `);
  crewMax = 0;
  const ch = run.sim.channels;
  console.log(
    `${s.t.toFixed(0).padStart(4)} ${run.phase.padEnd(22)} V=${s.airspeed.toFixed(1)} h=${s.altitude.toFixed(1)} vz=${s.vz.toFixed(2)} ` +
      `θ=${s.pitchDeg.toFixed(1)} α=${s.wingAlphaDeg.toFixed(1)} руль=${(ch.pitch ?? 0).toFixed(1)} газ=${(ch.throttle ?? 0).toFixed(2)} ` +
      `L/W=${s.liftToWeight.toFixed(2)} срыв=${(s.stalledFrac * 100).toFixed(0)}% P=${(s.power / 1e3).toFixed(0)}кВт`,
  );
});
