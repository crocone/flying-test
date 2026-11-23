// Самолёт в воздухе для сверок динамики полёта: запуск на высоте с заданной скоростью, балансировка автопилотом,
// затем органы управления закрепляются («ручка брошена») и снимается свободное движение.
// Автопилот — тех же видов, что в программе полёта (programs.ts): тангаж рулём высоты, высота через вертикальную скорость,
// скорость газом, крен элеронами, скольжение рулём направления.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Spec } from '../core/spec.ts';
import { Sim } from '../core/sim.ts';
import { clamp, copy, unrotate, v3 } from '../core/vec.ts';

export const KT = 0.514444;
export const FT = 0.3048;

export class Pilot {
  pitchI = 0;
  thetaI = 0;
  thrI: number;
  rollI = 0;
  yawI = 0;
  readonly sim: Sim;
  constructor(sim: Sim, thr0 = 0.6) {
    this.sim = sim;
    this.thrI = thr0;
  }
  private get rb() {
    return this.sim.root.b.rb;
  }
  /** Угловая скорость в осях корпуса, °/с: x — крен (+ вправо), y — рыскание (+ нос влево), z — тангаж (+ нос вверх). */
  rates() {
    const w = unrotate(this.rb.rotation(), copy(this.rb.angvel()));
    return v3((w.x * 180) / Math.PI, (w.y * 180) / Math.PI, (w.z * 180) / Math.PI);
  }
  private k() {
    return clamp((40 / Math.max(10, this.sim.sample.airspeed)) ** 2, 0.3, 4);
  }
  pitch(thetaCmd: number) {
    const s = this.sim.sample;
    const e = thetaCmd - s.pitchDeg;
    const k = this.k();
    this.pitchI = clamp(this.pitchI + 0.6 * e * this.sim.dt * k, -23, 28);
    this.sim.channels.pitch = clamp(this.pitchI + k * (1.5 * e - 0.5 * this.rates().z), -23, 28);
  }
  climb(vzCmd: number) {
    const s = this.sim.sample;
    this.thetaI = clamp(this.thetaI + 1.5 * (vzCmd - s.vz) * this.sim.dt, -15, 25);
    this.pitch(clamp(this.thetaI + 2.5 * (vzCmd - s.vz), -15, 25));
  }
  altitude(h: number) {
    this.climb(clamp(0.3 * (h - this.rb.translation().y), -4, 4));
  }
  speed(v: number) {
    const err = v - this.sim.sample.airspeed;
    this.thrI = clamp(this.thrI + 0.03 * err * this.sim.dt, 0, 1);
    this.sim.channels.throttle = clamp(this.thrI + 0.25 * err, 0, 1);
  }
  lateral(phiCmd = 0) {
    const s = this.sim.sample;
    const k = this.k();
    const e = phiCmd - s.rollDeg;
    this.rollI = clamp(this.rollI + 0.3 * e * this.sim.dt * k, -20, 20);
    this.sim.channels.roll = clamp(this.rollI + k * (0.8 * e - 0.3 * this.rates().x), -20, 20);
    this.yawI = clamp(this.yawI + 0.5 * s.betaDeg * this.sim.dt * k, -16, 16);
    this.sim.channels.yaw = clamp(this.yawI + k * 1.5 * s.betaDeg, -16, 16);
  }
}

/** Аппарат в воздухе: на 500 м над землёй (влияния земли нет), плотность — на заданной высоте, скорость вперёд. */
export function airborne(RAPIER: typeof RAPIER_NS, spec: Spec, altitude: number, vTas: number, rpm = 2400): Sim {
  const sim = new Sim(RAPIER, spec, { altitude });
  sim.lockRoot('free');
  sim.shift(v3(0, 500, 0));
  sim.root.b.rb.setLinvel({ x: vTas, y: 0, z: 0 }, true);
  for (const a of spec.actuators) if (a.type === 'propeller') sim.propOmega.set(a.id, (rpm * 2 * Math.PI) / 60);
  return sim;
}

/** Балансировка в горизонтальном полёте на истинной скорости vTas: до установления (не дольше limit секунд). */
export function trimLevel(sim: Sim, pilot: Pilot, vTas: number, limit = 300) {
  const h = sim.root.b.rb.translation().y;
  let quiet = 0;
  while (sim.t < limit) {
    pilot.altitude(h);
    pilot.speed(vTas);
    pilot.lateral(0);
    sim.step();
    const s = sim.sample;
    quiet = Math.abs(s.airspeed - vTas) < 0.1 && Math.abs(s.vz) < 0.05 && Math.abs(s.rollDeg) < 0.2 ? quiet + sim.dt : 0;
    if (quiet > 20) break;
  }
  return { steady: quiet > 20, channels: { ...sim.channels }, rpm: sim.sample.propRpm, pitchDeg: sim.sample.pitchDeg };
}

/** Экстремумы ряда (t, x): точки смены знака производной; мелкие колебания меньше minAmp отбрасываются. */
export function extrema(t: number[], x: number[], minAmp: number) {
  const out: { t: number; x: number; max: boolean }[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    const max = x[i] >= x[i - 1] && x[i] > x[i + 1];
    const min = x[i] <= x[i - 1] && x[i] < x[i + 1];
    if (!max && !min) continue;
    const last = out[out.length - 1];
    if (last && last.max === max) {
      if ((max && x[i] > last.x) || (min && x[i] < last.x)) out[out.length - 1] = { t: t[i], x: x[i], max };
      continue;
    }
    if (last && Math.abs(x[i] - last.x) < minAmp) continue;
    out.push({ t: t[i], x: x[i], max });
  }
  return out;
}

/**
 * Период и относительное демпфирование колебания по его экстремумам: период — среднее время между экстремумами одного
 * знака; затухание — отношение соседних размахов (от пика до впадины) r за полпериода, за период r²,
 * ζ = ln(1/r²)/√(4π² + ln²(1/r²)).
 */
export function oscillation(ex: { t: number; x: number }[]) {
  const per: number[] = [];
  for (let i = 2; i < ex.length; i++) per.push(ex[i].t - ex[i - 2].t);
  const amp: number[] = [];
  for (let i = 1; i < ex.length; i++) amp.push(Math.abs(ex[i].x - ex[i - 1].x));
  const ratios: number[] = [];
  for (let i = 1; i < amp.length; i++) ratios.push(amp[i] / amp[i - 1]);
  const period = per.length ? per.reduce((a, b) => a + b, 0) / per.length : NaN;
  const r = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : NaN;
  const d = Math.log(1 / (r * r));
  return { period, ratio: r, zeta: d / Math.sqrt(4 * Math.PI * Math.PI + d * d) };
}

/**
 * Коэффициенты сил и моментов аппарата в «трубе»: корпус закреплён вдали от земли, тяжести нет, газ убран; поток под
 * углом атаки α и скольжения β. Моменты — относительно центра масс (момент, которым держит закрепление, с обратным знаком).
 * Оси: C_L — поперёк потока в плоскости симметрии, C_Y — вправо, C_l — крен (+ правое крыло вниз), C_m — тангаж (+ нос
 * вверх), C_n — рыскание (+ нос вправо). S, c, b — площадь, средняя хорда, размах крыла.
 */
export function tunnelCoefficients(RAPIER: typeof RAPIER_NS, spec: Spec, V: number, alphaDeg: number, betaDeg: number,
  ref: { S: number; c: number; b: number }, channels: Record<string, number> = {}) {
  const a = (alphaDeg * Math.PI) / 180, be = (betaDeg * Math.PI) / 180;
  const vBody = v3(V * Math.cos(a) * Math.cos(be), -V * Math.sin(a) * Math.cos(be), V * Math.sin(be));
  const sim = new Sim(RAPIER, spec, { gravity: false, wind: v3(-vBody.x, -vBody.y, -vBody.z) });
  sim.lockRoot('fixed');
  sim.shift(v3(0, 500, 0));
  Object.assign(sim.channels, { throttle: 0 }, channels);
  sim.measureHold = true;
  const M = v3(), F = v3();
  let n = 0;
  while (sim.t < 3) {
    sim.step();
    if (sim.t > 2) {
      M.x -= sim.holdTorque.x; M.y -= sim.holdTorque.y; M.z -= sim.holdTorque.z;
      F.x += sim.sample.aeroForce.x; F.y += sim.sample.aeroForce.y; F.z += sim.sample.aeroForce.z;
      n++;
    }
  }
  const rho = sim.rho;
  sim.free();
  const qS = 0.5 * rho * V * V * ref.S;
  const lift = (F.x * Math.sin(a) + F.y * Math.cos(a)) / n;
  return { CL: lift / qS, CY: F.z / n / qS, Cl: M.x / n / (qS * ref.b), Cm: M.z / n / (qS * ref.c), Cn: -M.y / n / (qS * ref.b) };
}
