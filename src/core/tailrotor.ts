// Хвостовой винт: мощность на парирование реактивного момента несущего винта.
//
// Тяга хвостового винта T = Q / l — момент несущего винта на плечо до оси хвостового. Мощность — по той же физике,
// что у несущего винта в расчёте: теория элемента лопасти с импульсом по кольцам (BEMT), концевые потери Прандтля,
// поляра профиля из aero.ts. Шаг подбирается так, чтобы винт давал нужную тягу. Подгоночных множителей нет.
//
// Чего нет: хвостовой винт не взаимодействует со струёй несущего (у R22 его диск вне диска несущего), обдувка киля
// (у R22 киль под хвостовым винтом — 0–10 % потери тяги, «блокировка») не учтена; в полёте вперёд — то же, что на висении.
import type { Airfoil } from './spec.ts';
import { airfoilCoeffs, airViscosity } from './aero.ts';

export interface TailRotorSpec {
  radius: number; // м
  blades: number;
  chord: number; // м, постоянная
  rpm: number; // при номинальных оборотах несущего винта
  arm: number; // м, от оси несущего до оси хвостового
  rootFrac?: number; // вырез у втулки, доля радиуса (по умолчанию 0,2)
  twistDeg?: number; // крутка на радиус (по умолчанию 0)
  airfoil: Airfoil;
}

/** Тяга и мощность винта на висении при общем шаге θ (у корня; крутка линейная), BEMT с концевыми потерями. */
export function bemtHover(tr: TailRotorSpec, thetaDeg: number, rho: number, soundSpeed: number, rpmScale = 1, mu = airViscosity(soundSpeed)) {
  const R = tr.radius;
  const om = ((tr.rpm * rpmScale) * 2 * Math.PI) / 60;
  const N = 20;
  const r0 = (tr.rootFrac ?? 0.2) * R;
  const dr = (R - r0) / N;
  let T = 0, P = 0;
  for (let i = 0; i < N; i++) {
    const r = r0 + (i + 0.5) * dr;
    const theta = ((thetaDeg + (tr.twistDeg ?? 0) * (r / R)) * Math.PI) / 180;
    const ut = om * r;
    let vi = 0.05 * om * R;
    let dT = 0, dQ = 0;
    for (let k = 0; k < 60; k++) {
      const phi = Math.atan2(vi, ut);
      const f = ((tr.blades / 2) * (R - r)) / (r * Math.max(Math.sin(phi), 1e-4));
      const F = Math.max(0.05, (2 / Math.PI) * Math.acos(Math.min(1, Math.exp(-f))));
      const W = Math.hypot(ut, vi);
      const c = airfoilCoeffs(tr.airfoil, theta - phi, W / soundSpeed, (rho * W * tr.chord) / mu);
      const q = 0.5 * rho * W * W * tr.chord * tr.blades * dr;
      dT = q * (c.cl * Math.cos(phi) - c.cd * Math.sin(phi));
      dQ = q * (c.cl * Math.sin(phi) + c.cd * Math.cos(phi)) * r;
      const viNew = Math.sqrt(Math.max(0, dT) / (2 * rho * 2 * Math.PI * r * dr * F));
      if (Math.abs(viNew - vi) < 1e-5 * (1 + vi)) { vi = viNew; break; }
      vi = 0.5 * vi + 0.5 * viNew;
    }
    T += dT;
    P += dQ * om;
  }
  return { T, P };
}

/** Мощность, нужная хвостовому винту для тяги T: шаг подбирается методом секущих. */
export function tailRotorPower(tr: TailRotorSpec, thrust: number, rho: number, soundSpeed: number, rpmScale = 1, mu = airViscosity(soundSpeed)): { power: number; thetaDeg: number; ok: boolean } {
  if (thrust <= 0) return { power: bemtHover(tr, 0, rho, soundSpeed, rpmScale, mu).P, thetaDeg: 0, ok: true };
  let a = 4, fa = bemtHover(tr, a, rho, soundSpeed, rpmScale, mu).T - thrust;
  let b = 12, fb = bemtHover(tr, b, rho, soundSpeed, rpmScale, mu).T - thrust;
  for (let i = 0; i < 30 && Math.abs(fb) > 1e-3 * thrust; i++) {
    const c = Math.max(-5, Math.min(30, b - (fb * (b - a)) / (fb - fa || 1e-9)));
    a = b; fa = fb;
    b = c; fb = bemtHover(tr, b, rho, soundSpeed, rpmScale, mu).T - thrust;
  }
  const res = bemtHover(tr, b, rho, soundSpeed, rpmScale, mu);
  return { power: res.P, thetaDeg: b, ok: Math.abs(res.T - thrust) <= 0.02 * thrust };
}
