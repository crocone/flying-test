// Воздушный винт фиксированного шага: тяга и момент по теории элемента лопасти с импульсной теорией
// (кольцевые струи, закрутка потока, концевые и корневые потери Прандтля) и равновесие оборотов мотор — винт.
//
// Зачем: у винта фиксированного шага обороты не задаются, а устанавливаются там, где момент мотора равен
// моменту, который поглощает винт. На малой скорости (разбег, набор) винт «тяжелее», обороты ниже номинальных,
// и мотор отдаёт меньше мощности; на большой — обороты растут. Импульсный диск с постоянным КПД этого не даёт.
//
// Метод: на каждом радиусе неизвестен один угол притекания φ. Уравнения импульса по оси и по окружности
// для кольца радиуса r (σ' = B·c/(2πr) — местное заполнение, F — потери Прандтля):
//   осевая скорость в плоскости винта   Ua = V + w,   σ'·W²·Cn = 4·F·Ua·w,
//   окружная                             Ut = Ωr − wt,  σ'·W²·Ct = 4·F·Ua·wt,
// где Cn = cl·cos φ − cd·sin φ, Ct = cl·sin φ + cd·cos φ, tg φ = Ua/Ut. Исключая w и wt, получаем одно уравнение
//   R(φ) = Ωr·(sin²φ − σ'·Cn/(4F)) − V·(sin φ·cos φ + σ'·Ct/(4F)) = 0,
// без особенностей при V = 0 (статика). На (0, π/2) R меняет знак (при φ → 0 профиль на большом угле атаки
// и Cn > 0, R < 0; при φ = π/2 угол атаки сильно отрицательный, R > 0) — корень ищется делением отрезка.
// Это та же постановка, что у A. Ning (2014, «A simple solution method for the blade element momentum equations
// with guaranteed convergence»), записанная для винта. Импульсная теория не годится при очень большой нагрузке
// кольца и в режиме тормоза (ветряка); на рабочих режимах самолётного винта её погрешность — единицы процентов.
import { airfoilCoeffs } from './aero.ts';
import type { FixedPitchSpec } from './spec.ts';

/** Геометрия винта: блок fixedPitch спецификации и радиус (половина diameter привода). */
export type FixedPitchGeometry = Omit<FixedPitchSpec, 'inertia'> & { radius: number };

export interface PropLoads {
  thrust: number; // Н
  torque: number; // Н·м, поглощаемый винтом (> 0 — винт тормозит вал)
  ct: number; // C_T = T/(ρ n² D⁴)
  cp: number; // C_P = P/(ρ n³ D⁵)
  j: number; // J = V/(n D)
  eta: number; // T·V/P (0 при V = 0 или P ≤ 0)
  tipMach: number;
}

const STATIONS = 24;

function interp(c: [number, number][], x: number): number {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) return c[i - 1][1] + ((x - c[i - 1][0]) / (c[i][0] - c[i - 1][0])) * (c[i][1] - c[i - 1][1]);
  }
  return c[c.length - 1][1];
}
const chordAt = (g: FixedPitchGeometry, x: number) => interp(g.chord, x);

/** Активность лопасти AF = (10⁵/16)·∫(c/D)·(r/R)³ d(r/R) от корня до конца — для сравнения с типичными винтами. */
export function activityFactor(g: FixedPitchGeometry): number {
  let s = 0;
  const n = 200;
  for (let i = 0; i < n; i++) {
    const x = g.hubFrac + ((i + 0.5) / n) * (1 - g.hubFrac);
    s += (chordAt(g, x) / (2 * g.radius)) * x ** 3 * ((1 - g.hubFrac) / n);
  }
  return (1e5 / 16) * s;
}

/** Тяга и момент винта при осевой скорости V (≥ 0) и угловой скорости omega (> 0). */
export function propellerLoads(g: FixedPitchGeometry, V: number, omega: number, rho: number, soundSpeed: number): PropLoads {
  const R = g.radius;
  const B = g.blades;
  const Rh = g.hubFrac * R;
  const v = Math.max(0, V);
  const om = Math.max(1e-3, omega);
  let T = 0;
  let Q = 0;
  const dr = (R - Rh) / STATIONS;
  for (let i = 0; i < STATIONS; i++) {
    const r = Rh + (i + 0.5) * dr;
    const c = chordAt(g, r / R);
    const beta = g.betaDeg ? (interp(g.betaDeg, r / R) * Math.PI) / 180 : Math.atan(g.pitch / (2 * Math.PI * r));
    const sig = (B * c) / (2 * Math.PI * r);
    const wr = om * r;
    // Всё, что зависит от φ, — в одной функции; возвращает невязку и то, что нужно для сил.
    const evalPhi = (phi: number) => {
      const s = Math.sin(phi), co = Math.cos(phi);
      const fTip = (B / 2) * (R - r) / (r * Math.max(1e-6, s));
      const fHub = (B / 2) * (r - Rh) / (Rh * Math.max(1e-6, s));
      const F = Math.max(1e-4, (4 / (Math.PI * Math.PI)) * Math.acos(Math.min(1, Math.exp(-fTip))) * Math.acos(Math.min(1, Math.exp(-fHub))));
      // Число Маха — по W ≈ Ωr / cos φ (закрутка потока wt ≪ Ωr, на скорость звука влияет мало).
      const k = airfoilCoeffs(g.airfoil, beta - phi, wr / Math.max(1e-3, co) / soundSpeed);
      const cn = k.cl * co - k.cd * s;
      const ct = k.cl * s + k.cd * co;
      const res = wr * (s * s - (sig * cn) / (4 * F)) - v * (s * co + (sig * ct) / (4 * F));
      return { res, s, co, F, cn, ct };
    };
    let lo = 1e-4, hi = Math.PI / 2;
    let fLo = evalPhi(lo).res;
    for (let it = 0; it < 48; it++) {
      const mid = 0.5 * (lo + hi);
      const fm = evalPhi(mid).res;
      if (fm === 0) { lo = hi = mid; break; }
      if ((fm < 0) === (fLo < 0)) { lo = mid; fLo = fm; } else hi = mid;
    }
    const e = evalPhi(0.5 * (lo + hi));
    // Осевая скорость в плоскости винта из уравнения закрутки (без деления на 1 − a: устойчиво и в статике).
    const Ua = (wr * e.s * e.s) / (e.s * e.co + (sig * e.ct) / (4 * e.F));
    const W = Ua / Math.max(1e-6, e.s);
    const q = 0.5 * rho * W * W * c * dr * B;
    T += q * e.cn;
    Q += q * e.ct * r;
  }
  const n = om / (2 * Math.PI);
  const D = 2 * R;
  const P = Q * om;
  return {
    thrust: T, torque: Q,
    ct: T / (rho * n * n * D ** 4), cp: P / (rho * n ** 3 * D ** 5), j: v / (n * D),
    eta: v > 0 && P > 0 ? (T * v) / P : 0,
    tipMach: Math.hypot(om * R, v) / soundSpeed,
  };
}

/**
 * Равновесные обороты: момент мотора engineTorque(Ω) равен моменту винта. Делением отрезка по Ω
 * в пределах [lo, hi], рад/с. Возвращает Ω и нагрузки винта при нём.
 */
export function propellerEquilibrium(g: FixedPitchGeometry, V: number, engineTorque: (omega: number) => number, rho: number, soundSpeed: number, lo = 20, hi = 600): { omega: number; loads: PropLoads } {
  const f = (om: number) => engineTorque(om) - propellerLoads(g, V, om, rho, soundSpeed).torque;
  let a = lo, b = hi;
  let fa = f(a);
  for (let i = 0; i < 50; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
  }
  const omega = 0.5 * (a + b);
  return { omega, loads: propellerLoads(g, V, omega, rho, soundSpeed) };
}
