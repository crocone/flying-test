// Прочность лонжерона в сечении (ТЗ, раздел 7.3).
// Учитывается: растяжение и сжатие раздельно (у композитов и волокон они разные),
// местная потеря устойчивости тонких стенок, сдвиг и кручение, текучесть металлов.
// Запас прочности — наименьший из запасов по всем видам разрушения.
import type { Material } from './materials.ts';
import { tr } from './i18n.ts';
import type { SectionProps } from './section.ts';

export interface StationLoads {
  tension: number; // продольная сила, Н (+ растяжение)
  mFlap: number; // изгиб при взмахе, Н·м (со знаком)
  mLag: number; // изгиб в плоскости крыла, Н·м
  torsion: number; // кручение, Н·м
  vNormal: number; // перерезывающая сила по нормали, Н
  vChord: number; // перерезывающая сила по хорде, Н
}

export type FailureMode = 'tension' | 'compression' | 'buckling' | 'shear' | 'none';

/** Вид разрушения на языке интерфейса. */
export function modeName(m: FailureMode): string {
  return {
    tension: tr('разрыв растянутой полки', 'tension flange rupture'),
    compression: tr('разрушение сжатой полки', 'compression flange failure'),
    buckling: tr('потеря устойчивости стенки', 'web buckling'),
    shear: tr('срез стенки', 'web shear'),
    none: '—',
  }[m];
}

export interface StationStress {
  sigmaTension: number; // наибольшее растягивающее, Па (эквивалентное с учётом сдвига)
  sigmaCompression: number; // наибольшее сжимающее, Па
  tau: number; // касательное, Па
  sigmaTop: number; // нормальное в верхней полке со знаком
  corners: number[]; // нормальные напряжения в углах сечения со знаком — для усталости
  margin: number; // запас прочности
  mode: FailureMode;
  yieldMargin: number; // запас до текучести (∞, если нет данных)
  bucklingStress: number; // критическое напряжение потери устойчивости той стенки, что ближе к ней, Па
}

/**
 * Жёсткость тонкой пластины на выпучивание, Па. Критическое напряжение длинной пластины шириной w,
 * опёртой по кромкам и равномерно сжатой вдоль: σ_кр = π²·t² / (6·w²) · B,
 *   B = √(Q₁₁·Q₂₂) + Q₁₂ + 2·Q₆₆  (ортотропная пластина; волокна — вдоль сжатия).
 * Для изотропного материала B = 2E / (1 − ν²), и получается привычное 4·π²E / (12(1 − ν²)) · (t/w)².
 * У однонаправленного композита поперечный модуль в разы меньше продольного — и стенка выпучивается
 * намного раньше, чем дала бы формула для изотропного материала с продольным модулем.
 */
export function plateStiffness(m: Material): number {
  const E1 = m.E;
  const E2 = m.E2 ?? m.E;
  const nu12 = m.nu;
  const den = 1 - nu12 * ((nu12 * E2) / E1);
  const G12 = m.G12 ?? E1 / (2 * (1 + nu12));
  return Math.sqrt(E1 * E2) / den + (nu12 * E2) / den + 2 * G12;
}

/**
 * Коэффициент устойчивости пластины, сжатой неравномерно по ширине (EN 1993-1-5, табл. 4.1).
 * ψ — отношение напряжений на кромках: 1 — равномерное сжатие (k = 4), 0 — на одной кромке ноль
 * (k = 7,81), −1 — чистый изгиб в плоскости пластины (k = 23,9).
 */
export function plateK(psi: number): number {
  const p = Math.max(-3, Math.min(1, psi));
  if (p > 0) return 8.2 / (1.05 + p);
  if (p > -1) return 7.81 - 6.29 * p + 9.78 * p * p;
  return 5.98 * (1 - p) * (1 - p);
}

/** Критическое напряжение пластины шириной w при отношении кромочных напряжений ψ. */
export function plateCritical(m: Material, t: number, w: number, psi: number): number {
  return (plateK(psi) / 4) * ((Math.PI ** 2 * t * t) / (6 * w * w)) * plateStiffness(m);
}

/** Критическое напряжение местной потери устойчивости при изгибе взмаха (справочное значение). */
export function bucklingStress(sec: SectionProps, m: Material): number {
  if (sec.kind === 'tube') return tubeCritical(sec, m);
  // Сжатая полка — равномерное сжатие; стенка — изгиб в своей плоскости.
  return Math.min(plateCritical(m, sec.t, sec.flangeWidth, 1), plateCritical(m, sec.t, sec.webHeight, -1));
}

/** Труба: классическая формула оболочки с поправкой на несовершенства (≈0,3 от теории). */
function tubeCritical(sec: SectionProps, m: Material): number {
  const R = (sec.b - sec.t) / 2;
  // У ортотропной оболочки критическое напряжение пропорционально √(E₁·E₂).
  const E = Math.sqrt(m.E * (m.E2 ?? m.E));
  return (0.3 * E * sec.t) / (R * Math.sqrt(3 * (1 - m.nu * m.nu)));
}

export function stationStress(sec: SectionProps, m: Material, L: StationLoads): StationStress {
  const sN = L.tension / sec.area;
  const f = (L.mFlap * (sec.h / 2)) / sec.iFlap; // со знаком: + растяжение сверху
  const l = (L.mLag * (sec.lagArm ?? sec.b / 2)) / sec.iLag; // + растяжение спереди (с кессоном — изгиб несёт весь кессон)
  // Нормальные напряжения в углах коробки: верх-перёд, верх-зад, низ-перёд, низ-зад.
  // У трубы изгибы складываются как векторы: крайние волокна — на диаметре вдоль суммарного момента.
  const bend = Math.hypot(f, l);
  const corners = sec.kind === 'tube' ? [sN + bend, sN - bend] : [sN + f + l, sN + f - l, sN - f + l, sN - f - l];
  const sigmaT = Math.max(0, ...corners);
  const sigmaC = Math.max(0, ...corners.map((x) => -x));
  // Кручение — поток касательных в замкнутом контуре (Бредт); перерезывающие силы — стенки.
  // Срез от перерезывающей силы — наибольший, на нейтральной оси: τ = V·S / (I·2t) (Журавский),
  // S — статический момент половины сечения. Раньше бралось среднее по стенке V / (2·h·t): у плоской
  // коробки лопасти (ширина вчетверо больше высоты) это на 16 % меньше наибольшего.
  const tauT = Math.abs(L.torsion) / (2 * sec.enclosed * sec.t);
  const bi = sec.b - 2 * sec.t;
  const hi = sec.h - 2 * sec.t;
  const sFlap = (sec.b * sec.h * sec.h - bi * hi * hi) / 8;
  const sLag = sec.lagQ ?? (sec.h * sec.b * sec.b - hi * bi * bi) / 8;
  const tauV = sec.kind === 'tube'
    ? (2 * Math.hypot(L.vNormal, L.vChord)) / sec.area
    : (Math.abs(L.vNormal) * sFlap) / (sec.iFlap * 2 * sec.t) + (Math.abs(L.vChord) * sLag) / (sec.iLag * 2 * sec.t);
  const tau = tauT + tauV;
  const vmT = Math.sqrt(sigmaT * sigmaT + 3 * tau * tau);
  const vmC = Math.sqrt(sigmaC * sigmaC + 3 * tau * tau);

  // Местная потеря устойчивости. У коробки — каждая из четырёх стенок со своим нагружением:
  // от равномерного сжатия до изгиба в своей плоскости.
  let bucklingMargin = Infinity;
  let crit = Infinity;
  if (sec.filled) {
    // Стенки подкреплены заполнителем (соты, пенопласт) — выпучиваться им некуда. Критическое напряжение
    // пустотелого сечения остаётся в отчёте как справочное.
    crit = bucklingStress(sec, m);
  } else if (sec.kind === 'tube') {
    crit = tubeCritical(sec, m);
    if (sigmaC > 1) bucklingMargin = crit / sigmaC;
  } else {
    const [tf, trr, bf, br] = corners;
    const plates: [number, number, number][] = [
      [tf, trr, sec.flangeWidth], [bf, br, sec.flangeWidth], [tf, bf, sec.webHeight], [trr, br, sec.webHeight],
    ];
    for (const [a, b, w] of plates) {
      const c1 = Math.max(-a, -b); // наибольшее сжатие на кромке
      if (c1 <= 1) continue;
      const cr = plateCritical(m, sec.t, w, Math.min(-a, -b) / c1);
      if (cr / c1 < bucklingMargin) {
        bucklingMargin = cr / c1;
        crit = cr;
      }
    }
    if (!Number.isFinite(crit)) crit = bucklingStress(sec, m);
  }

  const cand: [number, FailureMode][] = [
    [m.ultTension / Math.max(vmT, 1e-9), 'tension'],
    [m.ultCompression > 0 ? m.ultCompression / Math.max(vmC, 1e-9) : sigmaC > 1 ? 0 : Infinity, 'compression'],
    [bucklingMargin, 'buckling'],
    [m.shear / Math.max(tau, 1e-9), 'shear'],
  ];
  let margin = Infinity;
  let mode: FailureMode = 'none';
  for (const [n, md] of cand) {
    if (n < margin) {
      margin = n;
      mode = md;
    }
  }
  const yieldMargin = m.yield ? m.yield / Math.max(vmT, vmC, 1e-9) : Infinity;
  return {
    sigmaTension: vmT,
    sigmaCompression: vmC,
    tau,
    sigmaTop: sN + f,
    corners,
    margin,
    mode,
    yieldMargin,
    bucklingStress: crit,
  };
}

/**
 * Усталость по одному циклу нагружения: амплитуда и среднее напряжение,
 * поправка Гудмана, кривая Баскина σ_a = σ_f'·(2N)^b.
 * Возвращает число циклов до разрушения (∞ — ниже предела выносливости).
 */
export function fatigueCycles(m: Material, sigmaMax: number, sigmaMin: number): number {
  const f = m.fatigue;
  if (!f) return NaN;
  const amp = (sigmaMax - sigmaMin) / 2;
  const mean = (sigmaMax + sigmaMin) / 2;
  if (amp <= 0) return Infinity;
  const goodman = mean > 0 ? 1 - mean / m.ultTension : 1;
  if (goodman <= 0) return 0;
  const sa = amp / goodman; // эквивалентная амплитуда при нулевом среднем
  if (f.enduranceLimit && sa <= f.strength) return Infinity;
  const sigmaF = f.strength / (2 * f.cycles) ** f.b; // σ_f'
  const n = 0.5 * (sa / sigmaF) ** (1 / f.b);
  return Math.max(0, n);
}
