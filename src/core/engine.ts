// Двигатели и источники энергии: мощность на высоте и расход топлива или энергии батареи.
// Все зависимости — из документации производителей и измерений (data/research.md, часть 7); подгоночных множителей нет.
//
// Поршневой (без наддува). Полный газ: P/P₀ = 1 − k·(1 − δ/√θ), δ — давление, θ — температура к МСА у земли.
//   Так выглядит график Lycoming «Sea Level and Altitude Performance» (IO-360-L2A, рис. 3-25): ось высоты на нём
//   линейна по δ/√θ; при 2400 об/мин k = 1,04. Это же — поправка Lycoming на температуру (√(T_s/T)).
//   Дросселированный мотор (R22): мощность не больше разрешённой (взлётной), пока полный газ её даёт.
//   Удельный расход — по графику Lycoming «Part Throttle Fuel Consumption» (рис. 3-9) по доле мощности: смесь от
//   «наивыгоднейшей» (best economy, разрешена до 75 %) до «наибольшей мощности» (best power); положение — mixture.
// Турбовальный. Мощность при постоянных приведённых оборотах и температуре газа: N ∝ δ/√θ (модель ТВ3-117ВМ, МАИ),
//   не больше взлётной (ограничение по режиму). Удельный расход по доле мощности — кривая T700-GE-700 (GE, NASA TM-100991),
//   отнесённая к расходу на номинале.
// Электрический. Батарея: энергия до отсечки — по измеренной кривой разряда (HV-LiPo Melasta, SINTEF): средний вольтаж
//   при данном токе и отдаваемая ёмкость; моторы и регуляторы — КПД из спецификации (powerplant.losses).
import { atmosphere } from './aero.ts';
import type { Environment } from './spec.ts';

export type EngineSpec =
  | {
      type: 'piston';
      fullThrottleSL: number; // мощность на полном газе у земли при рабочих оборотах, Вт
      lapseK?: number; // k в P/P₀ = 1 − k·(1 − δ/√θ); по умолчанию 1,04 (Lycoming IO-360, 2400 об/мин)
      mixture?: number; // 0 — наивыгоднейшая смесь (best economy), 1 — наибольшей мощности (best power); по умолчанию 0,5
      fuelKg?: number; // запас топлива, который можно выработать, кг
    }
  | {
      type: 'turboshaft';
      sfcRated: number; // удельный расход на взлётном режиме, кг/(Вт·с)
      fuelKg?: number;
    }
  | {
      // Человек: мощность на педалях (или рукоятках) зависит от того, сколько её держать. Кривые NASA SP-3006
      // (Bioastronautics Data Book, 1973, рис. 18-15): «здоровые мужчины» и «чемпионы».
      type: 'human';
      level: 'healthy' | 'champion';
      durationS?: number; // сколько нужно держать мощность (полёт), с; по умолчанию час
    }
  | {
      type: 'electric';
      batteryWh: number; // номинальная энергия батареи, Вт·ч
      cells: number; // последовательных элементов (S)
      capacityAh: number; // номинальная ёмкость, А·ч
    };

const LB_PER_HPH = 0.45359237 / (745.7 * 3600); // 1 lb/(hp·h) в кг/Дж

// Lycoming IO-360-L2A, рис. 3-9 (чтение ±0,5 lb/h): удельный расход, lb/(hp·h), по доле мощности полного газа у земли.
// best economy — до 75 %, выше разрешена только best power.
const BSFC_POWER: [number, number][] = [[0.53, 0.552], [0.66, 0.52], [0.75, 0.504], [1.0, 0.474]];
const BSFC_ECON: [number, number][] = [[0.53, 0.476], [0.66, 0.447], [0.75, 0.433]];
// T700-GE-700 (GE Status-81, NASA TM-100991, рис. 7): удельный расход к наименьшему по доле наибольшей мощности.
const SFC_TURBO: [number, number][] = [[0.19, 1.80], [0.30, 1.40], [0.41, 1.23], [0.46, 1.17], [0.58, 1.10], [0.65, 1.06], [0.74, 1.02], [0.83, 1.00], [0.95, 1.00], [1.0, 1.01]];

const interp = (t: [number, number][], x: number) => {
  if (x <= t[0][0]) return t[0][1] + ((x - t[0][0]) * (t[1][1] - t[0][1])) / (t[1][0] - t[0][0]);
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return t[i - 1][1] + ((x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])) * (t[i][1] - t[i - 1][1]);
  return t[t.length - 1][1];
};

/** δ/√θ на высоте (МСА, с той температурой, что задана средой). */
function deltaOverRootTheta(env: Environment, altitude: number, dT = 0): number {
  const a = atmosphere(env, altitude, dT);
  const theta = (a.soundSpeed / env.soundSpeed) ** 2;
  const sigma = a.rho / env.rho;
  return (sigma * theta) / Math.sqrt(theta);
}

// NASA SP-3006, рис. 18-15 (оцифровка, ±1 % по мощности): длительность, с — мощность, Вт. Здоровые молодые мужчины,
// привычные к нагрузке; чемпионы (на длинном конце кривая в источнике пунктиром). Масса людей не указана.
const HUMAN: Record<'healthy' | 'champion', [number, number][]> = {
  healthy: [[6.6, 914], [10.2, 795], [16, 686], [24.6, 584], [37.8, 492], [59, 418], [90.4, 361], [139, 328], [215.2, 307], [330.4, 294], [518.1, 284], [814, 276], [1269, 268], [1981.2, 251], [3096.2, 224], [4817.7, 192], [7542.4, 157], [11734.8, 131], [13058.4, 125]],
  champion: [[8, 1190], [12.4, 984], [19.6, 830], [29.6, 708], [46.2, 617], [71.6, 544], [109.7, 489], [169.4, 453], [261.1, 426], [410.4, 407], [638.6, 393], [995.2, 382], [1554.2, 372], [2417.1, 362], [3789.8, 346], [5902, 319], [8265.2, 292]],
};

/** Мощность человека, которую можно держать t секунд, Вт (лог-лог интерполяция; за краями — продолжение крайнего участка). */
export function humanPower(level: 'healthy' | 'champion', t: number): number {
  const T = HUMAN[level];
  const lt = Math.log(Math.max(t, 1e-3));
  let i = 1;
  while (i < T.length - 1 && lt > Math.log(T[i][0])) i++;
  const [t0, p0] = T[i - 1], [t1, p1] = T[i];
  const k = (lt - Math.log(t0)) / (Math.log(t1) - Math.log(t0));
  return Math.exp(Math.log(p0) + k * (Math.log(p1) - Math.log(p0)));
}

/** Сколько секунд человек выдержит мощность P (обратная кривой), с. */
export function humanEndurance(level: 'healthy' | 'champion', P: number): number {
  let lo = Math.log(1), hi = Math.log(1e6);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (humanPower(level, Math.exp(mid)) > P) lo = mid; else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/** Мощность на валу, которую силовая установка может дать на этой высоте, Вт. cap — разрешённая (паспортная) мощность. */
export function availablePower(e: EngineSpec, cap: number, env: Environment, altitude: number, dT = 0): number {
  const x = deltaOverRootTheta(env, altitude, dT);
  if (e.type === 'piston') return Math.max(0, Math.min(cap, e.fullThrottleSL * (1 - (e.lapseK ?? 1.04) * (1 - x))));
  if (e.type === 'turboshaft') return Math.max(0, Math.min(cap, cap * x));
  if (e.type === 'human') return Math.min(cap, humanPower(e.level, e.durationS ?? 3600)); // от высоты до 1500 м почти не зависит
  return cap; // электромотор от высоты не зависит
}

/** Расход топлива, кг/с, при мощности на валу P (Вт). */
export function fuelFlow(e: EngineSpec, P: number, ratedPower: number): number {
  if (P <= 0) return 0;
  if (e.type === 'piston') {
    const f = P / e.fullThrottleSL;
    const mix = Math.max(0, Math.min(1, e.mixture ?? 0.5));
    const bp = interp(BSFC_POWER, f);
    const be = f > 0.75 ? bp : interp(BSFC_ECON, f);
    return P * (be + mix * (bp - be)) * LB_PER_HPH;
  }
  if (e.type === 'turboshaft') return P * e.sfcRated * interp(SFC_TURBO, P / ratedPower);
  return 0;
}

// HV-LiPo (Melasta SLPBA842124HV, SINTEF, измерения): отдаваемая ёмкость к номинальной и средний вольтаж элемента до 3,0 В
// по току разряда в C.
const CELL: [number, number, number][] = [[0.1, 7.28 / 6.5, 3.873], [1, 7.25 / 6.5, 3.83], [2, 7.24 / 6.5, 3.795], [5, 7.21 / 6.5, 3.72], [9.15, 7.19 / 6.5, 3.641]];

/** Энергия батареи, которую можно снять при электрической мощности P (Вт), Дж — до отсечки 3,0 В на элемент. */
export function batteryEnergy(e: Extract<EngineSpec, { type: 'electric' }>, P: number): number {
  const v0 = (e.batteryWh / e.capacityAh) / e.cells; // номинальный вольтаж элемента
  let c = P / (v0 * e.cells) / e.capacityAh; // ток в C
  for (let i = 0; i < 3; i++) {
    const vm = interp(CELL.map((r) => [r[0], r[2]] as [number, number]), c);
    c = P / (vm * e.cells) / e.capacityAh;
  }
  // Ёмкость элемента Melasta больше номинала (7,2 А·ч при 6,5): берётся не абсолютная, а относительная к 0,1C.
  const capRel = interp(CELL.map((r) => [r[0], r[1] / CELL[0][1]] as [number, number]), c);
  const vm = interp(CELL.map((r) => [r[0], r[2]] as [number, number]), c);
  return e.capacityAh * capRel * vm * e.cells * 3600;
}

/** Время работы, с, при средней мощности P на валу: топливо или батарея. losses — потери в трансмиссии/моторах. */
export function endurance(e: EngineSpec, Pshaft: number, ratedPower: number, losses = 0): number {
  if (Pshaft <= 0) return Infinity;
  if (e.type === 'human') return humanEndurance(e.level, Pshaft);
  if (e.type === 'electric') {
    const Pel = Pshaft; // в стенде мощность уже включает потери моторов и регуляторов (powerplant.losses)
    return batteryEnergy(e, Pel) / Pel;
  }
  const ff = fuelFlow(e, Pshaft, ratedPower);
  return e.fuelKg && ff > 0 ? e.fuelKg / ff : NaN;
}
