// Запись испытания: ряды телеметрии (графики отчёта, CSV) и положения деталей около разрушения
// (повтор момента разрушения).
import type { Sample } from '../core/sim.ts';

export const SERIES: { key: keyof Sample; label: string }[] = [
  { key: 't', label: 'время, с' },
  { key: 'altitude', label: 'высота, м' },
  { key: 'airspeed', label: 'скорость, м/с' },
  { key: 'vz', label: 'вертикальная скорость, м/с' },
  { key: 'pitchDeg', label: 'тангаж, °' },
  { key: 'liftToWeight', label: 'подъёмная сила / вес' },
  { key: 'loadFactor', label: 'перегрузка' },
  { key: 'power', label: 'мощность, Вт' },
  { key: 'powerRecovered', label: 'мощность при возврате энергии, Вт' },
  { key: 'powerAvailable', label: 'располагаемая мощность, Вт' },
  { key: 'minMargin', label: 'запас прочности' },
  { key: 'crewAccel', label: 'ускорение в кресле, g' },
  { key: 'maxMach', label: 'число Маха' },
  { key: 'stalledFrac', label: 'доля сечений в срыве' },
  { key: 'wingAlphaDeg', label: 'угол атаки крыла, °' },
];

/** Ряды телеметрии: не реже 20 точек на период самого быстрого привода (ТЗ, раздел 9). */
export class Series {
  n = 0;
  cols: Float64Array[];
  private cap = 4096;
  private lastT = -Infinity;
  constructor() {
    this.cols = SERIES.map(() => new Float64Array(this.cap));
  }
  push(s: Sample, fastestHz: number) {
    const rate = Math.max(50, 20 * fastestHz);
    if (s.t - this.lastT < 1 / rate - 1e-9) return;
    this.lastT = s.t;
    if (this.n === this.cap) {
      this.cap *= 2;
      this.cols = this.cols.map((c) => {
        const d = new Float64Array(this.cap);
        d.set(c);
        return d;
      });
    }
    SERIES.forEach((f, i) => {
      const v = s[f.key];
      this.cols[i][this.n] = typeof v === 'number' ? v : NaN;
    });
    this.n++;
  }
  col(key: keyof Sample): Float64Array {
    return this.cols[SERIES.findIndex((f) => f.key === key)].subarray(0, this.n);
  }
  csv(): string {
    const lines = [SERIES.map((f) => f.label).join(';')];
    for (let r = 0; r < this.n; r++) lines.push(this.cols.map((c) => (Number.isFinite(c[r]) ? String(Number(c[r].toPrecision(6))).replace('.', ',') : '')).join(';'));
    return '﻿' + lines.join('\r\n');
  }
}

/** Кадр для повтора: на каждую деталь — положение, поворот, угол установки, запасы по станциям. */
export interface Frame {
  t: number;
  data: Float32Array;
}

export class Replay {
  frames: Frame[] = [];
  breakT: number | null = null;
  frozen = false;
  private lastT = -Infinity;
  period = 0; // период главного привода, с: последний целый цикл хранится для показа по кругу
  readonly before = 0.8;
  readonly after = 0.5;
  push(t: number, fastestHz: number, snap: () => Float32Array) {
    if (this.frozen) return;
    const rate = Math.max(400, 40 * fastestHz);
    if (t - this.lastT < 1 / rate - 1e-9) return;
    this.lastT = t;
    this.frames.push({ t, data: snap() });
    this.period = fastestHz > 0 ? 1 / fastestHz : 0;
    if (this.breakT === null) {
      const keep = Math.max(this.before, Math.min(15, this.period * 1.05));
      let i = 0;
      while (i < this.frames.length && this.frames[i].t < t - keep) i++;
      if (i > 256) this.frames.splice(0, i);
    } else if (t >= this.breakT + this.after) this.frozen = true;
  }
  markBreak(t: number) {
    if (this.breakT === null) this.breakT = t;
  }
  get ready(): boolean {
    return this.breakT !== null && this.frames.length > 1;
  }
  /** Записан ли целый последний цикл привода — тогда его можно показывать по кругу. */
  get loopReady(): boolean {
    return this.period > 0 && this.frames.length > 8 && this.end - this.frames[0].t >= this.period * 0.98;
  }
  /** Кадр последнего цикла через tau секунд модельного времени от начала показа (по кругу). */
  loopAt(tau: number): Frame | null {
    if (!this.loopReady) return null;
    return this.at(this.end - this.period + (tau % this.period));
  }
  get start(): number {
    return Math.max(this.frames[0]?.t ?? 0, (this.breakT ?? 0) - this.before);
  }
  get end(): number {
    return this.frames[this.frames.length - 1]?.t ?? 0;
  }
  at(t: number): Frame | null {
    let lo = 0, hi = this.frames.length - 1;
    if (hi < 0) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return this.frames[lo];
  }
}
