// Флаттер и дивергенция крыла: изгиб + кручение, нестационарная аэродинамика Теодорсена по полосам.
//
// Крыло — балка с упругой осью (центр жёсткости сечений). Формы колебаний — метод конечных элементов: изгиб — балка
// Эйлера — Бернулли (эрмитовы кубические функции: прогиб и угол в узлах), кручение — стержень Сен-Венана (линейные
// функции), связь изгиба с кручением — через смещение центра масс от упругой оси (S = m·x_α). Опоры: корень — заделка
// или шарнир (крыло с подкосом), подкос — опора по вертикали в точке крепления на хорде (на переднем лонжероне: она
// связывает прогиб с закручиванием). Берутся несколько низших форм (по умолчанию 4) — метод Рэлея — Ритца.
// h — прогиб вниз, α — поворот носком вверх. На полосу ширины dy (Теодорсен, NACA Report 496; Ходжес и Пирс, гл. 5):
//   L = πρb²(ḧ + Vα̇ − baα̈) + 2πρVb·C(k)·[ḣ + Vα + b(½ − a)α̇],
//   M = πρb²[baḧ − Vb(½ − a)α̇ − b²(⅛ + a²)α̈] + 2πρVb²(a + ½)·C(k)·[ḣ + Vα + b(½ − a)α̇],
// b — полухорда, a — положение упругой оси от середины хорды в полухордах (+ назад), C(k) — функция Теодорсена,
// k = ωb/V. В обобщённых координатах форм: (p² + ω_j²)·q_j = Σ Q_ji(p)·q_i.
// Решение — p-k методом: q ~ e^{pt}, при фиксированной C(k) определитель — многочлен степени 2n по p; k уточняется по
// Im p до сходимости. Флаттер — скорость, где у колебательного корня Re p становится > 0.
// Дивергенция (статика, C = 1): det(Ω² − V²·Q₀) = 0 — наименьший положительный корень.
// Демпфирование конструкции не учитывается (как принято в расчётах флаттера — с запасом).
import { theodorsen } from './aero.ts';

export interface Strip {
  y: number; // положение середины полосы от корня, м
  dy: number; // ширина полосы, м
  b: number; // полухорда, м
  a: number; // упругая ось от середины хорды, в полухордах (+ к задней кромке)
  m: number; // масса на метр, кг/м
  xa: number; // центр масс сечения позади упругой оси, м
  Ia: number; // момент инерции сечения относительно упругой оси на метр, кг·м
  EI: number; // изгибная жёсткость, Н·м²
  GJ: number; // крутильная жёсткость, Н·м²
}

export interface Supports {
  root?: 'clamped' | 'pinned'; // по изгибу; по кручению корень закреплён всегда
  // Подкос: опора по вертикали на расстоянии y от корня, в точке хорды на d м позади упругой оси (впереди — d < 0).
  strut?: { y: number; d: number };
}

type C = [number, number]; // комплексное число
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const csub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cs = (a: C, s: number): C => [a[0] * s, a[1] * s];
const cabs = (a: C) => Math.hypot(a[0], a[1]);

// Многочлен — коэффициенты по возрастанию степени.
type P = C[];
const pmul = (a: P, b: P): P => {
  const r: P = Array.from({ length: a.length + b.length - 1 }, () => [0, 0] as C);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] = cadd(r[i + j], cmul(a[i], b[j]));
  return r;
};
const padd = (a: P, b: P): P => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => cadd(a[i] ?? [0, 0], b[i] ?? [0, 0]));
const pneg = (a: P): P => a.map((x) => cs(x, -1));

/** Определитель матрицы многочленов (разложение по первой строке). */
function pdet(A: P[][]): P {
  const n = A.length;
  if (n === 1) return A[0][0];
  let r: P = [[0, 0]];
  for (let j = 0; j < n; j++) {
    const minor = A.slice(1).map((row) => row.filter((_, k) => k !== j));
    const t = pmul(A[0][j], pdet(minor));
    r = padd(r, j % 2 ? pneg(t) : t);
  }
  return r;
}

/** Корни многочлена (Дюран — Кернер). */
function roots(c0: P): C[] {
  let c = c0;
  while (c.length > 1 && cabs(c[c.length - 1]) < 1e-300) c = c.slice(0, -1);
  const n = c.length - 1;
  if (n < 1) return [];
  const lead = c[n];
  const a = c.map((x) => cdiv(x, lead));
  const scale = 1 + Math.max(...a.slice(0, n).map(cabs));
  let z: C[] = Array.from({ length: n }, (_, i) => cs([Math.cos(0.4 + (2 * Math.PI * i) / n), Math.sin(0.4 + (2 * Math.PI * i) / n)], scale));
  for (let it = 0; it < 2000; it++) {
    let delta = 0;
    z = z.map((zi, i) => {
      let num: C = [1, 0];
      for (let k = n - 1; k >= 0; k--) num = cadd(cmul(num, zi), a[k]);
      let den: C = [1, 0];
      for (let j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(zi, z[j]));
      const d = cdiv(num, den);
      delta = Math.max(delta, cabs(d) / (1 + cabs(zi)));
      return csub(zi, d);
    });
    if (delta < 1e-13) break;
  }
  return z;
}

// ---------- формы колебаний: конечные элементы ----------

/** Собственные значения и векторы симметричной матрицы (метод Якоби). */
function jacobiEigen(A0: number[][]): { values: number[]; vectors: number[][] } {
  const n = A0.length;
  const A = A0.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-22 * A.reduce((s, r, i) => s + r[i] * r[i], 0)) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

export interface Mode {
  omega: number; // рад/с, в пустоте
  h: number[]; // прогиб на полосах (нормировка — единичная обобщённая масса)
  a: number[]; // закручивание на полосах
}

/** Низшие формы балки по полосам крыла. Узлы — на границах полос. */
export function beamModes(strips: Strip[], sup: Supports = {}, nModes = 4): Mode[] {
  const N = strips.length;
  const y = [0];
  for (const s of strips) y.push(y[y.length - 1] + s.dy);
  // Степени свободы узла: прогиб w, угол w', закручивание θ.
  const nd = 3 * (N + 1);
  const K = Array.from({ length: nd }, () => new Array(nd).fill(0));
  const M = Array.from({ length: nd }, () => new Array(nd).fill(0));
  const gp = [[-Math.sqrt(3 / 5), 5 / 9], [0, 8 / 9], [Math.sqrt(3 / 5), 5 / 9]];
  for (let e = 0; e < N; e++) {
    const s = strips[e], l = s.dy;
    const dofs = [3 * e, 3 * e + 1, 3 * (e + 1), 3 * (e + 1) + 1, 3 * e + 2, 3 * (e + 1) + 2]; // w1 w1' w2 w2' θ1 θ2
    // Изгиб: жёсткость и масса (точные для однородного элемента).
    const kb = [[12, 6 * l, -12, 6 * l], [6 * l, 4 * l * l, -6 * l, 2 * l * l], [-12, -6 * l, 12, -6 * l], [6 * l, 2 * l * l, -6 * l, 4 * l * l]].map((r) => r.map((x) => (x * s.EI) / l ** 3));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[dofs[i]][dofs[j]] += kb[i][j];
    const kt = s.GJ / l;
    K[dofs[4]][dofs[4]] += kt; K[dofs[5]][dofs[5]] += kt; K[dofs[4]][dofs[5]] -= kt; K[dofs[5]][dofs[4]] -= kt;
    // Масса — квадратурой: m·(Nw·Nw) + S·(Nw·Nθ + Nθ·Nw) + Iα·(Nθ·Nθ).
    for (const [xi, wgt] of gp) {
      const t = (xi + 1) / 2;
      const Nw = [1 - 3 * t * t + 2 * t ** 3, l * (t - 2 * t * t + t ** 3), 3 * t * t - 2 * t ** 3, l * (-t * t + t ** 3)];
      const Nt = [1 - t, t];
      const f = (wgt * l) / 2;
      const S = s.m * s.xa;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) M[dofs[i]][dofs[j]] += f * s.m * Nw[i] * Nw[j];
        for (let j = 0; j < 2; j++) {
          M[dofs[i]][dofs[4 + j]] += f * S * Nw[i] * Nt[j];
          M[dofs[4 + j]][dofs[i]] += f * S * Nw[i] * Nt[j];
        }
      }
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) M[dofs[4 + i]][dofs[4 + j]] += f * s.Ia * Nt[i] * Nt[j];
    }
  }
  // Подкос — опора-пружина по вертикали в узле, ближайшем к точке крепления: прогиб точки = w + d·θ.
  if (sup.strut) {
    let iNode = 0;
    for (let i = 0; i <= N; i++) if (Math.abs(y[i] - sup.strut.y) < Math.abs(y[iNode] - sup.strut.y)) iNode = i;
    const kMax = Math.max(...K.map((r, i) => r[i]));
    const kS = 1e4 * kMax;
    const c = new Array(nd).fill(0);
    c[3 * iNode] = 1;
    c[3 * iNode + 2] = sup.strut.d;
    for (let i = 0; i < nd; i++) for (let j = 0; j < nd; j++) K[i][j] += kS * c[i] * c[j];
  }
  // Корень: прогиб и закручивание закреплены; угол — у заделки.
  const fixed = new Set([0, 2, ...(sup.root === 'pinned' ? [] : [1])]);
  const free = [...Array(nd).keys()].filter((i) => !fixed.has(i));
  const Kr = free.map((i) => free.map((j) => K[i][j]));
  const Mr = free.map((i) => free.map((j) => M[i][j]));
  // Обобщённая задача Kφ = ω²Mφ: M = LLᵀ (Холецкий), A = L⁻¹KL⁻ᵀ.
  const n = free.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = Mr[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j][j];
    }
  const solveL = (b: number[]) => { const x = b.slice(); for (let i = 0; i < n; i++) { for (let k = 0; k < i; k++) x[i] -= L[i][k] * x[k]; x[i] /= L[i][i]; } return x; };
  const solveLT = (b: number[]) => { const x = b.slice(); for (let i = n - 1; i >= 0; i--) { for (let k = i + 1; k < n; k++) x[i] -= L[k][i] * x[k]; x[i] /= L[i][i]; } return x; };
  // B = L⁻¹·K (по столбцам), A = L⁻¹·Bᵀ.
  const B = Kr.map((row) => solveL(row)); // строки B — L⁻¹·(столбцы K), K симметрична
  const A = B.map((_, i) => solveL(B.map((r) => r[i])));
  const As = A.map((r, i) => r.map((x, j) => (x + A[j][i]) / 2));
  const { values, vectors } = jacobiEigen(As);
  const order = values.map((v, i) => [v, i] as [number, number]).filter(([v]) => v > 0).sort((p, q) => p[0] - q[0]).slice(0, nModes);
  return order.map(([w2, i]) => {
    const phiR = solveLT(vectors.map((r) => r[i]));
    const phi = new Array(nd).fill(0);
    free.forEach((d, k) => (phi[d] = phiR[k]));
    // Значения на серединах полос.
    const h = strips.map((_, e) => (phi[3 * e] + phi[3 * (e + 1)]) / 2 + (strips[e].dy * (phi[3 * e + 1] - phi[3 * (e + 1) + 1])) / 8);
    const a = strips.map((_, e) => (phi[3 * e + 2] + phi[3 * (e + 1) + 2]) / 2);
    return { omega: Math.sqrt(w2), h, a };
  });
}

// ---------- флаттер ----------

export interface FlutterResult {
  fBending: number; // первая собственная частота (форма с наибольшим прогибом), Гц
  fTorsion: number; // первая форма, где преобладает кручение, Гц
  modes: number[]; // частоты учтённых форм, Гц
  vFlutter: number; // скорость флаттера, м/с (Infinity — нет до vMax)
  fFlutter: number; // частота флаттера, Гц
  vDivergence: number; // скорость дивергенции, м/с (Infinity — нет)
}

export function flutterAnalysis(strips: Strip[], rho: number, vMax: number, sup: Supports = {}, nModes = 4): FlutterResult {
  const modes = beamModes(strips, sup, nModes);
  const n = modes.length;
  // Обобщённые аэродинамические силы: Q_ij(p) = ρ∫(−L_j·h_i + M_j·α_i)dy, по степеням p и с C(k) / без неё.
  // Коэффициенты: q2 — при p², q1n — при p без C, q1c — при p·C·V, q0c — при C·V².
  const z = () => Array.from({ length: n }, () => new Array(n).fill(0));
  const q2 = z(), q1n = z(), q1c = z(), q0c = z();
  strips.forEach((s, k) => {
    const { b, a, dy } = s;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const hi = modes[i].h[k], ai = modes[i].a[k], hj = modes[j].h[k], aj = modes[j].a[k];
        // L_j = πb²(p²h + Vpα − bap²α) + 2πVbC(ph + Vα + b(½−a)pα)
        // M_j = πb²(bap²h − Vb(½−a)pα − b²(⅛+a²)p²α) + 2πVb²(a+½)C(ph + Vα + b(½−a)pα)
        const L2 = Math.PI * b * b * (hj - b * a * aj), L1n = Math.PI * b * b * aj, L1c = 2 * Math.PI * b * (hj + b * (0.5 - a) * aj), L0c = 2 * Math.PI * b * aj;
        const M2 = Math.PI * b * b * (b * a * hj - b * b * (0.125 + a * a) * aj), M1n = -Math.PI * b ** 3 * (0.5 - a) * aj;
        const M1c = 2 * Math.PI * b * b * (a + 0.5) * (hj + b * (0.5 - a) * aj), M0c = 2 * Math.PI * b * b * (a + 0.5) * aj;
        q2[i][j] += rho * dy * (-L2 * hi + M2 * ai);
        q1n[i][j] += rho * dy * (-L1n * hi + M1n * ai);
        q1c[i][j] += rho * dy * (-L1c * hi + M1c * ai);
        q0c[i][j] += rho * dy * (-L0c * hi + M0c * ai);
      }
  });
  let bRef = strips[0].b;
  const span = strips.reduce((m, s) => Math.max(m, s.y), 0);
  for (const s of strips) if (s.y <= 0.75 * span) bRef = s.b;
  // Частоты: изгибная — форма с наибольшей долей прогиба, крутильная — с наибольшей долей кручения.
  const share = (m: Mode) => {
    let H = 0, A = 0;
    strips.forEach((s, k) => { H += s.m * m.h[k] ** 2 * s.dy; A += s.Ia * m.a[k] ** 2 * s.dy; });
    return A / (H + A);
  };
  const fB = modes.find((m) => share(m) < 0.5), fT = modes.find((m) => share(m) >= 0.5);
  const res: FlutterResult = {
    fBending: (fB?.omega ?? NaN) / (2 * Math.PI), fTorsion: (fT?.omega ?? NaN) / (2 * Math.PI), modes: modes.map((m) => m.omega / (2 * Math.PI)),
    vFlutter: Infinity, fFlutter: NaN, vDivergence: Infinity,
  };
  // Дивергенция: det(Ω² − λ·Q0) = 0, λ = V², Q0 = q0c (C = 1).
  {
    const A: P[][] = modes.map((mi, i) => modes.map((_, j) => [[i === j ? mi.omega ** 2 : 0, 0], [-q0c[i][j], 0]] as P));
    const lam = roots(pdet(A)).filter((r) => Math.abs(r[1]) < 1e-6 * (1 + Math.abs(r[0])) && r[0] > 0).map((r) => r[0]);
    if (lam.length) res.vDivergence = Math.sqrt(Math.min(...lam));
  }
  const solve = (V: number, Cv: C): C[] => {
    const A: P[][] = modes.map((mi, i) => modes.map((_, j) => {
      const d = i === j ? 1 : 0;
      const c0 = csub([d * mi.omega ** 2, 0], cs(Cv, V * V * q0c[i][j]));
      const c1 = csub([-V * q1n[i][j], 0], cs(Cv, V * q1c[i][j]));
      const c2: C = [d - q2[i][j], 0];
      return [c0, c1, c2];
    }));
    return roots(pdet(A));
  };
  const track = (V: number, prev: number[]) =>
    prev.map((w0) => {
      let w = w0;
      let best: C = [0, w0];
      for (let it = 0; it < 40; it++) {
        const T = theodorsen((w * bRef) / Math.max(V, 1e-6));
        const rs = solve(V, [T.F, T.G]).filter((x) => x[1] > 1e-9);
        if (!rs.length) return { p: best, w };
        best = rs.reduce((m, x) => (Math.abs(x[1] - w) < Math.abs(m[1] - w) ? x : m));
        if (Math.abs(best[1] - w) < 1e-7 * (1 + w)) break;
        w = best[1];
      }
      return { p: best, w: best[1] };
    });
  let ws = modes.map((m) => m.omega);
  let vPrev = 0;
  const nV = 100;
  const unstable = (t: { p: C }[]) => t.find((x) => x.p[0] > 1e-9 * (1 + Math.abs(x.p[1])) && x.p[1] > 1e-6);
  for (let i = 1; i <= nV; i++) {
    const V = (vMax * i) / nV;
    const tr = track(V, ws);
    if (unstable(tr)) {
      let lo = vPrev, hi = V, wl = ws;
      for (let j = 0; j < 30; j++) {
        const mid = (lo + hi) / 2;
        const t = track(mid, wl);
        if (unstable(t)) hi = mid;
        else { lo = mid; wl = t.map((x) => x.w); }
      }
      const t = unstable(track(hi, wl)) ?? unstable(tr)!;
      res.vFlutter = hi;
      res.fFlutter = t.p[1] / (2 * Math.PI);
      break;
    }
    ws = tr.map((x) => x.w);
    vPrev = V;
  }
  return res;
}
