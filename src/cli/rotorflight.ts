// Вертолёт в полёте вперёд для сверок: «труба» с вертикальной свободой. Корпус не поворачивается и не смещается
// по горизонтали, воздух набегает спереди со скоростью V; по вертикали корпус свободен — скорость набора или снижения
// получается сама. Автопилот, как лётчик:
// - общий шаг держит вертикальную скорость (на авторотации — обороты винта);
// - продольный циклический шаг наклоняет диск так, чтобы тяга винта уравновесила сопротивление (сила вдоль потока — ноль);
// - поперечный — так, чтобы боковая сила винта уравновесила тягу хвостового винта.
// Положение фюзеляжа по тангажу не балансируется (у качающейся втулки момент на вал не передаётся, на мощность влияет
// только через сопротивление фюзеляжа).
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Spec } from '../core/spec.ts';
import { Sim } from '../core/sim.ts';
import { clamp, v3 } from '../core/vec.ts';

export interface HeliTrim {
  steady: boolean;
  power: number; // мощность на валах с потерями (несущий + хвостовой винт), Вт
  tailPower: number;
  vz: number; // вертикальная скорость, м/с (+ вверх)
  rpm: number; // обороты несущего винта
  collective: number;
  cyclicLon: number;
  cyclicLat: number;
  beta: number; // угол взмаха первой лопасти (средний модуль), °
  minMargin: number; // наименьший запас прочности за осреднение
}

/**
 * V — истинная скорость, м/с; climb — заданная вертикальная скорость (на моторе); autorotation — мотор отключён, общий шаг
 * держит обороты rpmFrac от номинала, вертикальная скорость — результат.
 */
export function heliTrim(RAPIER: typeof RAPIER_NS, spec: Spec, o: { V: number; climb?: number; autorotation?: boolean; rpmFrac?: number; altitude?: number; settle?: number; average?: number }): HeliTrim {
  // Без разрушения: нагрузки лопасти в полёте вперёд — справочно (minMargin), см. README.
  const sim = new Sim(RAPIER, spec, { altitude: o.altitude ?? 0, wind: v3(), breakable: false });
  const rotor = spec.actuators.find((a) => a.type === 'spinner')!;
  if (rotor.type !== 'spinner') throw new Error('нет несущего винта');
  sim.shift(v3(0, 2000, 0)); // высоко: на авторотации за минуту теряется до 600 м
  sim.lockRoot('fixed');
  const rb = sim.root.b.rb;
  const W = sim.totalMass * sim.g;
  const ch = sim.channels;
  for (const c of spec.controls ?? []) ch[c.channel] = c.initial;
  const omegaNom = (rotor.rpm * 2 * Math.PI) / 60;
  let cI = ch.collective, lonI = 0, latI = 0;
  // Раскрутка в спокойном воздухе (как на земле), затем поток плавно разгоняется до V при закреплённом корпусе,
  // затем — свобода по вертикали.
  const tSpin = (rotor.rampTime ?? 4) + 1, tRamp = tSpin + 8;
  while (sim.t < tSpin) sim.step();
  let free = false;
  const settle = o.settle ?? 35, average = o.average ?? 15;
  const tA = tRamp + settle, tEnd = tA + average;
  const acc = { p: 0, tp: 0, vz: 0, rpm: 0, c: 0, lon: 0, lat: 0, b: 0, n: 0, margin: Infinity, fx: 0, sat: false };
  const r0 = sim.rotors[0];
  while (sim.t < tEnd) {
    const s = sim.sample;
    const vz = rb.linvel().y;
    sim.opts.wind.x = -o.V * Math.min(1, (sim.t - tSpin) / (tRamp - tSpin));
    if (!free && sim.t >= tRamp) {
      free = true;
      sim.lockRoot('vertical');
      if (o.autorotation) ch[rotor.freewheel!] = 1;
    }
    // Общий шаг.
    if (!free) {
      // корпус закреплён: шаг держит подъёмную силу равной весу
      const e = 1 - s.aeroForce.y / W;
      cI = clamp(cI + 4 * e * sim.dt, -2, 18);
      ch.collective = cI;
    } else if (o.autorotation) {
      const e = (Math.abs(r0.omega) - omegaNom * (o.rpmFrac ?? 1)) / omegaNom; // обороты выше — шаг больше
      cI = clamp(cI + 8 * e * sim.dt, -2, 18);
      ch.collective = clamp(cI + 40 * e, -2, 18);
    } else {
      const e = (o.climb ?? 0) - vz;
      cI = clamp(cI + 0.8 * e * sim.dt, -2, 18);
      ch.collective = clamp(cI + 1.0 * e, -2, 18);
    }
    // Циклический шаг: сила вдоль потока и боковая сила (с тягой хвостового винта) — к нулю.
    const tail = sim.tailCache.get(rotor.id)?.thrust ?? 0;
    const fx = s.aeroForce.x / W, fz = (s.aeroForce.z + (o.autorotation ? 0 : tail)) / W;
    lonI = clamp(lonI + 15 * fx * sim.dt, -12, 12);
    latI = clamp(latI + 15 * fz * sim.dt, -8, 8);
    ch.cyclicLon = clamp(lonI + 3 * fx, -12, 12);
    ch.cyclicLat = clamp(latI + 3 * fz, -8, 8);
    sim.step();
    if (sim.t >= tA) {
      acc.p += s.power; acc.tp += s.tailRotorPower; acc.vz += vz; acc.rpm += (Math.abs(r0.omega) * 60) / (2 * Math.PI);
      acc.c += ch.collective; acc.lon += ch.cyclicLon; acc.lat += ch.cyclicLat; acc.b += Math.abs(r0.blades[0].flap?.beta ?? 0); acc.n++; acc.margin = Math.min(acc.margin, s.minMargin);
      acc.fx += fx;
      if (Math.abs(ch.cyclicLon) > 11.9 || Math.abs(ch.cyclicLat) > 7.9 || ch.collective < -1.9 || ch.collective > 17.9) acc.sat = true;
    }
  }
  const n = acc.n;
  const res: HeliTrim = {
    // Установилось: органы не на упорах, сила вдоль потока уравновешена, обороты (или вертикальная скорость) выдержаны.
    steady: !acc.sat && Math.abs(acc.fx / n) < 0.01 && (o.autorotation ? Math.abs(acc.rpm / n / (rotor.rpm * (o.rpmFrac ?? 1)) - 1) < 0.01 : Math.abs(acc.vz / n - (o.climb ?? 0)) < 0.1),
    power: acc.p / n, tailPower: acc.tp / n, vz: acc.vz / n, rpm: acc.rpm / n, collective: acc.c / n,
    cyclicLon: acc.lon / n, cyclicLat: acc.lat / n, beta: ((acc.b / n) * 180) / Math.PI, minMargin: acc.margin,
  };
  sim.free();
  return res;
}
