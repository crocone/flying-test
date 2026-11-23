// Слоистый композит (ламинат) из однонаправленных слоёв: классическая теория слоистых пластин (CLT).
// Слои 0° (вдоль размаха), ±45° (парами) и 90°, симметричная укладка — изгиба и связи растяжения со сдвигом нет.
// Жёсткость в плоскости: A = Σ hₖ·Q̄ₖ, Q̄ — матрица жёсткости слоя, повёрнутая на угол укладки; податливость a = A⁻¹:
//   Ex = 1/(h·a₁₁), Ey = 1/(h·a₂₂), Gxy = 1/(h·a₆₆), νxy = −a₁₂/a₁₁.
// Прочность — по наибольшей деформации в осях слоя с выключением разрушенных слоёв (ply discount):
//  - разрушение волокон: деформация вдоль волокон Xt/E1 (растяжение), Xc/E1 (сжатие) — ламинат разрушен;
//  - растрескивание связующего: поперёк волокон Yt/E2, Yc/E2 или сдвиг слоя S/G12 — у слоя пропадают E2 и G12
//    (остаются 1 %), нагрузка перераспределяется, расчёт повторяется. Разрушающая нагрузка — наибольшая из достигнутых,
//    когда дальше нести нечем (у ламината без слоёв по направлению нагрузки — растрескивание и есть разрушение).
// Без Yt, Yc у материала проверяется только разрушение волокон и сдвиг слоя.
import type { Material } from './materials.ts';
import { tr as tl } from './i18n.ts';

export interface Layup {
  p0: number; // доля слоёв 0° (вдоль размаха)
  p45: number; // доля слоёв ±45° (поровну +45 и −45)
  p90: number; // доля слоёв 90°
}

type M3 = number[][];

function plyQ(m: Material, cracked = false): M3 {
  const k = cracked ? 0.01 : 1;
  const E1 = m.E, E2 = (m.E2 ?? m.E) * k, G12 = (m.G12 ?? m.E / (2 * (1 + m.nu))) * k, n12 = m.nu * k;
  const n21 = (n12 * E2) / E1;
  const d = 1 - n12 * n21;
  return [[E1 / d, (n12 * E2) / d, 0], [(n12 * E2) / d, E2 / d, 0], [0, 0, G12]];
}

/** Матрица поворота деформаций (инженерный сдвиг) из осей ламината в оси слоя, угол θ. */
function strainToPly(th: number): M3 {
  const c = Math.cos(th), s = Math.sin(th);
  return [[c * c, s * s, c * s], [s * s, c * c, -c * s], [-2 * c * s, 2 * c * s, c * c - s * s]];
}

const mul = (A: M3, B: M3): M3 => A.map((r) => B[0].map((_, j) => r.reduce((t, x, k) => t + x * B[k][j], 0)));
const tr = (A: M3): M3 => A[0].map((_, j) => A.map((r) => r[j]));
const mv = (A: M3, v: number[]) => A.map((r) => r.reduce((t, x, k) => t + x * v[k], 0));

function inv3(A: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = A;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

export interface LaminateProps {
  Ex: number; Ey: number; Gxy: number; nuxy: number;
  Xt: number; Xc: number; S: number; // прочность ламината: растяжение и сжатие вдоль размаха, сдвиг в плоскости, Па
}

export function laminateProps(m: Material, l: Layup): LaminateProps {
  const sum = l.p0 + l.p45 + l.p90;
  const plies: [number, number][] = [[0, l.p0 / sum], [Math.PI / 4, l.p45 / sum / 2], [-Math.PI / 4, l.p45 / sum / 2], [Math.PI / 2, l.p90 / sum]]
    .filter(([, f]) => f > 0) as [number, number][];
  // Податливость на единицу толщины; cracked — у каких слоёв растрескалось связующее.
  const compliance = (cracked: boolean[]) => {
    const A: M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    plies.forEach(([th, f], i) => {
      const T = strainToPly(th);
      const Qb = mul(tr(T), mul(plyQ(m, cracked[i]), T)); // Q̄ = Tᵀ·Q·T
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r][c] += f * Qb[r][c];
    });
    return inv3(A);
  };
  const a = compliance(plies.map(() => false));
  const E1 = m.E, E2 = m.E2 ?? m.E, G12 = m.G12 ?? m.E / (2 * (1 + m.nu));
  const eT = m.ultTension / E1, eC = m.ultCompression / E1, gS = m.shear / G12;
  const e2T = m.Yt ? m.Yt / E2 : Infinity, e2C = m.Yc ? m.Yc / E2 : Infinity;
  // Разрушающая нагрузка единичного направления load (σx, σy, τxy).
  const ultimate = (load: number[]) => {
    const cracked = plies.map(() => false);
    let reached = 0;
    const flex0 = Math.abs(mv(compliance(cracked), load).reduce((t, x, i) => t + x * load[i], 0));
    for (let step = 0; step <= plies.length; step++) {
      const eps = mv(compliance(cracked), load);
      // Растрескавшийся ламинат стал в 10 раз податливее — по этому направлению нести нечем: разрушен.
      if (reached > 0 && Math.abs(eps.reduce((t, x, i) => t + x * load[i], 0)) > 10 * flex0) return reached;
      let kFib = Infinity, kMat = Infinity, which = -1;
      plies.forEach(([th], i) => {
        const e = mv(strainToPly(th), eps);
        if (e[0] > 1e-30) kFib = Math.min(kFib, eT / e[0]);
        if (e[0] < -1e-30) kFib = Math.min(kFib, eC / -e[0]);
        if (cracked[i]) return;
        let km = Infinity;
        if (e[1] > 1e-30) km = Math.min(km, e2T / e[1]);
        if (e[1] < -1e-30) km = Math.min(km, e2C / -e[1]);
        if (Math.abs(e[2]) > 1e-30) km = Math.min(km, gS / Math.abs(e[2]));
        if (km < kMat) { kMat = km; which = i; }
      });
      if (kFib <= kMat || which < 0) return Number.isFinite(kFib) ? Math.max(reached, kFib) : reached;
      reached = Math.max(reached, kMat);
      cracked[which] = true;
    }
    return reached;
  };
  return {
    Ex: 1 / a[0][0], Ey: 1 / a[1][1], Gxy: 1 / a[2][2], nuxy: -a[0][1] / a[0][0],
    Xt: ultimate([1, 0, 0]), Xc: ultimate([-1, 0, 0]), S: ultimate([0, 0, 1]),
  };
}

/** Материал ламината для расчёта прочности: свойства вдоль размаха (E — Ex, E2 — Ey, G12 — Gxy). */
export function laminateMaterial(m: Material, l: Layup): Material {
  const p = laminateProps(m, l);
  return {
    ...m, id: `${m.id}[${l.p0}/${l.p45}/${l.p90}]`, name: `${m.name}, ${tl('укладка', 'layup')} ${Math.round(l.p0 * 100)}/${Math.round(l.p45 * 100)}/${Math.round(l.p90 * 100)}`,
    E: p.Ex, E2: p.Ey, G12: p.Gxy, nu: p.nuxy, ultTension: p.Xt, ultCompression: p.Xc, shear: p.S, fatigue: undefined,
  };
}
