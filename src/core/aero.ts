// Аэродинамика сечения (ТЗ, раздел 7.2): квазистационарные коэффициенты профиля
// на всём круге углов атаки, поправка на сжимаемость и стандартная атмосфера.
import type { Airfoil, Environment, PolarSet } from './spec.ts';

export const MACH_LIMIT = 0.7; // выше — сечение «вне модели»
const FLAT_PLATE_CN = 1.98; // нормальная сила пластины при 90°, по Хёрнеру
const BLEND = 4 * (Math.PI / 180); // ширина перехода через срыв

export interface SectionCoeffs {
  cl: number;
  cd: number;
  stalled: boolean;
  outOfModel: boolean; // сжимаемость за пределом Прандтля — Глауэрта
  // Составляющие — для модели запаздывания срыва:
  w: number; // доля безотрывного обтекания: 1 — без срыва, 0 — полный срыв
  clLin: number; // подъёмная сила безотрывного обтекания, продолженная за срывной угол
  cdLin: number;
  clFp: number; // пластина при полном срыве
  cdFp: number;
}

/**
 * Рост сопротивления от сжимаемости (волновое сопротивление) — по Локу, с числом Маха расходимости по Корну:
 *   M_dd = κ_A − t/c − s·|c_l|,   M_cr = M_dd − (0,1/80)^⅓,   Δc_d = 20·(M − M_cr)⁴ при M > M_cr
 * (при M = M_dd наклон dc_d/dM = 0,1 — так и определяется M_dd). У Корна s = 0,1 — это для профилей на расчётном c_l;
 * у профиля NACA 0012 под нагрузкой пик разрежения у носка растёт быстро, и M_dd падает втрое быстрее. Значения κ_A и s
 * сняты с двумерной продувки NACA 0012 (Carpenter, NACA TN 4357, рис. 5, штриховые кривые — опыт в трубе Langley LTPT):
 * M_dd при наклоне 0,1 — 0,795 (α = 0), 0,651 (4°), 0,56 (6°), 0,505 (8°); прямая по этим точкам — 0,800 − 0,31·c_l
 * (разброс ±0,02), т. е. κ_A = 0,92 при t/c = 0,12. Член −t/c — из уравнения Корна; его подтверждает тот же отчёт:
 * у лопасти с концевым профилем NACA 0015 расходимость при M_t 0,7 наступает при c̄_l на 0,10 ниже, чем у NACA 0012 (0,36 против
 * 0,46): 0,03 толщины = 0,31 × 0,10. Это значения по умолчанию (4-значные профили NACA и неизвестные).
 * Профили 6-й серии: у них разрежение у носка ниже и M_dd слабо зависит от c_l — исходные числа Корна для «обычных»
 * профилей 6-й серии, κ_A = 0,87 и s = 0,1 (уравнение Корна в изложении W. H. Mason: «Some Transonic Aerodynamics», с. 51,
 * и «Configuration Aerodynamics», гл. 7; 0,95 — для сверхкритических). Сверены с винтом NACA 63₂-015 (TN 3850) — профилем лопасти R22.
 * Сверка с винтами — в src/cli/validation.ts (Carpenter, TN 3850, R22).
 */
export const DRAG_RISE = { kappaA: 0.92, clSlope: 0.31 };
export const KORN_6SERIES = { kappaA: 0.87, clSlope: 0.1 };
const LOCK_DM = Math.cbrt(0.1 / 80);
export function dragDivergenceMach(af: Airfoil, cl: number): number {
  const d = af.dragRise ?? DRAG_RISE;
  return d.kappaA - af.thickness - d.clSlope * Math.abs(cl);
}
export function compressibilityDrag(af: Airfoil, cl: number, mach: number): number {
  const dm = Math.min(Math.abs(mach), 1) - (dragDivergenceMach(af, cl) - LOCK_DM);
  return dm > 0 ? 20 * dm ** 4 : 0;
}

const wrap = (a: number) => {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

/** Динамическая вязкость воздуха по Сазерленду, Па·с; температура — по скорости звука (a = 20,05·√T). */
export function airViscosity(soundSpeed: number): number {
  const T = (soundSpeed / 20.05) ** 2;
  return (1.458e-6 * T ** 1.5) / (T + 110.4);
}

const tableAt = (t: PolarSet['tables'][number], aDeg: number) => {
  const A = t.alpha;
  if (aDeg <= A[0]) return { cl: t.cl[0], cd: t.cd[0] };
  for (let i = 1; i < A.length; i++) {
    if (aDeg <= A[i]) {
      const x = (aDeg - A[i - 1]) / (A[i] - A[i - 1]);
      return { cl: t.cl[i - 1] + x * (t.cl[i] - t.cl[i - 1]), cd: t.cd[i - 1] + x * (t.cd[i] - t.cd[i - 1]) };
    }
  }
  return { cl: t.cl[A.length - 1], cd: t.cd[A.length - 1] };
};
const stallOf = (t: PolarSet['tables'][number]) => {
  let k = 0;
  for (let i = 0; i < t.alpha.length && t.alpha[i] <= 30; i++) if (t.cl[i] > t.cl[k]) k = i;
  return { aDeg: t.alpha[k], cl: t.cl[k] };
};
const slopeOf = (t: PolarSet['tables'][number]) => tableAt(t, 4).cl / (4 * (Math.PI / 180));

/**
 * Поляра из таблицы при числе Рейнольдса re: интерполяция по α (линейно) и по ln Re между соседними таблицами
 * (за крайними — крайняя таблица). Возвращает c_l, c_d при малых M, угол и c_l срыва, наклон до срыва (1/рад).
 */
export function polarAt(ps: PolarSet, alpha: number, re: number) {
  const a = wrap(alpha);
  const sign = ps.symmetric && a < 0 ? -1 : 1;
  const aDeg = (Math.abs(a) * 180) / Math.PI;
  const T = ps.tables;
  let i = T.findIndex((t) => t.re >= re);
  let t1 = T[0], t2 = T[0], x = 0;
  if (i < 0) t1 = t2 = T[T.length - 1];
  else if (i > 0) {
    t1 = T[i - 1];
    t2 = T[i];
    x = Math.log(re / t1.re) / Math.log(t2.re / t1.re);
  }
  const c1 = tableAt(t1, aDeg), c2 = tableAt(t2, aDeg);
  const s1 = stallOf(t1), s2 = stallOf(t2);
  return {
    cl: sign * (c1.cl + x * (c2.cl - c1.cl)),
    cd: c1.cd + x * (c2.cd - c1.cd),
    stallDeg: s1.aDeg + x * (s2.aDeg - s1.aDeg),
    clMax: s1.cl + x * (s2.cl - s1.cl),
    slope: slopeOf(t1) + x * (slopeOf(t2) - slopeOf(t1)),
  };
}

/**
 * Коэффициенты по табличной поляре. Сжимаемость: c_l до срыва — по Прандтлю — Глауэрту (таблицы сняты при M ≈ 0,1–0,2),
 * сопротивление — плюс рост от сжимаемости, как у параметрической модели. Для модели динамического срыва:
 * w — доля безотрывного обтекания (по тому, где c_l между продолжением прямой и пластиной Хёрнера).
 */
function tableCoeffs(af: Airfoil, alpha: number, mach: number, re: number): SectionCoeffs {
  const ps = af.polar!;
  const sf = ps.rough?.length ? Math.max(0, Math.min(1, af.surface ?? 0.5)) : 0;
  const pS = polarAt(ps, alpha, re);
  const pR = sf > 0 ? polarAt({ ...ps, tables: ps.rough! }, alpha, re) : pS;
  const mix = (a: number, b: number) => a + sf * (b - a);
  const p = { cl: mix(pS.cl, pR.cl), cd: mix(pS.cd, pR.cd), stallDeg: mix(pS.stallDeg, pR.stallDeg), clMax: mix(pS.clMax, pR.clMax), slope: mix(pS.slope, pR.slope) };
  const m = Math.min(Math.abs(mach), MACH_LIMIT);
  const beta = 1 / Math.sqrt(1 - m * m);
  const aAbs = Math.abs(alpha);
  const cn = FLAT_PLATE_CN * Math.sin(alpha);
  const clFp = cn * Math.cos(alpha);
  const cdFp = p.cd; // за срывом таблица — опыт (WSU), пластина нужна только как предел для w
  const stalled = aAbs > (p.stallDeg * Math.PI) / 180;
  const clLin = p.slope * beta * Math.sign(alpha) * Math.min(aAbs, Math.PI / 2);
  let w = 1;
  if (stalled) {
    const den = clLin - clFp;
    w = aAbs >= Math.PI / 2 || Math.abs(den) < 1e-6 ? 0 : Math.max(0, Math.min(1, (p.cl - clFp) / den));
  }
  // Прандтль — Глауэрт — на безотрывную часть подъёмной силы.
  const cl = p.cl * (w * beta + (1 - w));
  const cdw = aAbs < Math.PI / 2 ? compressibilityDrag(af, w * cl, mach) : 0;
  const aAtt = Math.sign(alpha) * Math.min(aAbs, (p.stallDeg * Math.PI) / 180);
  const cdAtt = mix(polarAt(ps, aAtt, re).cd, sf > 0 ? polarAt({ ...ps, tables: ps.rough! }, aAtt, re).cd : 0);
  return {
    cl,
    cd: p.cd + cdw,
    stalled,
    outOfModel: Math.abs(mach) > MACH_LIMIT,
    w, clLin, cdLin: cdAtt + cdw, clFp, cdFp: FLAT_PLATE_CN * Math.sin(alpha) ** 2 + af.cd0,
  };
}

export function airfoilCoeffs(af: Airfoil, alphaIn: number, mach: number, re?: number): SectionCoeffs {
  if (af.polar && re && re > 0) return tableCoeffs(af, wrap(alphaIn), mach, re);
  const alpha = wrap(alphaIn);
  const m = Math.min(Math.abs(mach), MACH_LIMIT);
  const beta = 1 / Math.sqrt(1 - m * m);
  const a = (af.clAlpha ?? 2 * Math.PI * 0.9) * beta;
  const cl0 = af.cl0 * beta;
  const clMax = af.clMax;
  // Отрицательный срыв. По теории тонкого профиля срыв с передней кромки наступает на одинаковом удалении
  // от «идеального» угла атаки в обе стороны; у средней линии-параболы идеальный C_L равен C_L0, поэтому
  // C_L,min = 2·C_L0 − C_L,max. У симметричного профиля это точно −C_L,max. Раньше было −0,8·C_L,max + 2·C_L0:
  // у симметричного профиля (оперение, лопасти) срыв на отрицательных углах наступал на 20 % раньше.
  const clMin = af.clMin ?? 2 * af.cl0 - af.clMax;
  const aPos = (clMax - cl0) / a;
  const aNeg = (clMin - cl0) / a;
  const k = af.k ?? 0.01;

  // Пластина: работает при больших углах и при обратном обтекании.
  const cn = FLAT_PLATE_CN * Math.sin(alpha);
  const clFp = cn * Math.cos(alpha);
  const cdFp = af.cd0 + cn * Math.sin(alpha);

  let w: number;
  if (alpha >= aNeg && alpha <= aPos) w = 1;
  else if (Math.abs(alpha) > Math.PI / 2) w = 0;
  else {
    const over = alpha > aPos ? alpha - aPos : aNeg - alpha;
    w = Math.exp(-((over / BLEND) ** 2));
  }
  const clAtt = cl0 + a * Math.min(Math.max(alpha, aNeg), aPos);
  // Волновое сопротивление — у безотрывного обтекания при прямом обтекании; за срывом сила — пластина Хёрнера.
  // C_L для M_dd ограничен срывным (clAtt): за c_l,max формула Корна не проверена, а при малых M дала бы ложный рост.
  const cdw = Math.abs(alpha) < Math.PI / 2 ? compressibilityDrag(af, clAtt, mach) : 0;
  const cdAtt = af.cd0 + k * clAtt * clAtt + cdw;
  const clLin = cl0 + a * alpha;
  return {
    cl: w * clAtt + (1 - w) * clFp,
    cd: w * cdAtt + (1 - w) * cdFp,
    stalled: alpha > aPos || alpha < aNeg,
    outOfModel: Math.abs(mach) > MACH_LIMIT,
    w, clLin, cdLin: af.cd0 + k * clLin * clLin + cdw, clFp, cdFp,
  };
}

/**
 * Динамический срыв по схеме Беддоуза — Лейшмана (Leishman & Beddoes 1989; Leishman, Principles of Helicopter
 * Aerodynamics, 2-е изд., 2006, гл. 9). Время — в полухордах пути s. Три части:
 *   1) Tp — давление у передней кромки отстаёт от угла атаки; по запаздывающему углу aF определяется начало срыва
 *      (в схеме — C_N' > C_N1; здесь — aF за статическим срывным углом, т. е. C_N1 — статическая нормальная сила срыва);
 *   2) Tf — пограничный слой (доля безотрывного обтекания w, аналог точки отрыва f) отстаёт от давления;
 *   3) вихрь динамического срыва. Пока обтекание запаздывает к отрыву, у передней кромки копится завихренность:
 *      C_V = C_N безотрывного обтекания − C_N с запаздывающим отрывом (в схеме — C_N^C·(1 − K_N)); её приращения
 *      переходят в нормальную силу вихря C_N^V с запаздыванием Tv:
 *        C_N^V(n) = C_N^V(n−1)·e^(−Δs/Tv) + (C_V(n) − C_V(n−1))·e^(−Δs/2Tv),
 *      пока вихрь над профилем (τ_v ≤ Tvl, τ_v — путь с начала срыва). Когда вихрь сошёл за заднюю кромку или срыва
 *      по критерию нет, завихренность больше не копится и C_N^V спадает вдвое быстрее (Tv/2). Через Tvl + Tsh после
 *      первого, при продолжающемся срыве, начинается следующий вихрь: Tsh = 2(1 − w)/St, St = 0,19.
 *      Знак C_N^V не может быть противоположен нормальной силе без вихря.
 * Постоянные — опубликованные для NACA 0012 и не подбирались под эталоны стенда: Tp 1,7, Tf 3,0 и Tv 6,0 (Leishman &
 * Beddoes; те же числа — значения по умолчанию в OpenFAST AeroDyn), Tvl 7,0 (Leishman & Beddoes 1986, NACA 0012 при
 * M 0,3; в OpenFAST по умолчанию 11 — для лопастей ветряков; диапазон в литературе 6–13), St 0,19.
 * Не моделируются: поправки Tf и Tv по стадиям цикла (в OpenFAST — множители 0,25…4), подсасывающая сила на кромке от
 * вихря, момент тангажа. Сверка с измеренными петлями NACA 0012 — src/cli/validation.ts, раздел «Динамический срыв».
 */
export const DYNAMIC_STALL = { Tp: 1.7, Tf: 3.0, Tv: 6.0, Tvl: 7.0, St: 0.19, vortex: true };
export interface StallState {
  aF: number; // запаздывающий угол, по которому определяется начало срыва
  w: number; // запаздывающая доля безотрывного обтекания
  tauV?: number; // путь с начала срыва в полухордах (положение вихря на хорде); NaN — срыва по критерию нет
  cv?: number; // C_V на прошлом шаге
  cnV?: number; // нормальная сила вихря
}
export function dynamicStall(af: Airfoil, st: StallState, c: SectionCoeffs, alpha: number, mach: number, ds: number, re?: number): { cl: number; cd: number; stalled: boolean; cnV: number } {
  const P = DYNAMIC_STALL;
  if (!Number.isFinite(st.aF)) {
    st.aF = alpha;
    st.w = c.w;
  }
  st.aF += (alpha - st.aF) * (1 - Math.exp(-ds / P.Tp));
  const lag = airfoilCoeffs(af, st.aF, mach, re);
  st.w += (lag.w - st.w) * (1 - Math.exp(-ds / P.Tf));
  const dw = st.w - c.w; // > 0 — срыв запаздывает; < 0 — запаздывает восстановление
  let cl = c.cl + dw * (c.clLin - c.clFp);
  let cd = c.cd + dw * (c.cdLin - c.cdFp);
  let cnV = 0;
  if (P.vortex) {
    const a = wrap(alpha);
    const attached = Math.abs(a) < Math.PI / 2; // при обратном обтекании вихря нет
    const ca = Math.cos(a), sa = Math.sin(a);
    const cnF = cl * ca + cd * sa;
    const cv = attached ? c.clLin * ca + c.cdLin * sa - cnF : 0;
    const onset = attached && lag.stalled && Math.abs(wrap(st.aF)) < Math.PI / 2;
    if (!onset) st.tauV = NaN;
    else if (!Number.isFinite(st.tauV)) st.tauV = 0;
    else {
      st.tauV! += ds;
      if (st.tauV! >= P.Tvl + (2 * (1 - st.w)) / P.St) st.tauV = 0; // следующий вихрь
    }
    const prev = st.cnV ?? 0;
    const grow = onset && st.tauV! <= P.Tvl;
    cnV = grow ? prev * Math.exp(-ds / P.Tv) + (cv - (Number.isFinite(st.cv) ? st.cv! : cv)) * Math.exp(-ds / (2 * P.Tv)) : prev * Math.exp((-2 * ds) / P.Tv);
    if (cnV * cnF < 0) cnV = 0;
    st.cv = cv;
    st.cnV = cnV;
    cl += cnV * ca;
    cd += cnV * sa;
  }
  return { cl, cd, stalled: st.w < 0.5, cnV };
}

/**
 * Во сколько раз квазистационарная модель завышает тягу колеблющегося профиля.
 * Теория Гаррика для чистого взмаха: тяга ∝ F² + G², где C(k) = F + iG — функция Теодорсена,
 * k = ω·b/U — приведённая частота (b — полухорда). При k → 0 множитель 1 (установившееся обтекание).
 * Табличные значения функции Теодорсена; между узлами — линейная интерполяция.
 */
const THEODORSEN: [number, number, number][] = [
  [0, 1, 0], [0.05, 0.909, -0.1305], [0.1, 0.8319, -0.1723], [0.2, 0.7276, -0.1886], [0.3, 0.665, -0.1793],
  [0.4, 0.625, -0.165], [0.5, 0.5979, -0.1507], [0.6, 0.5788, -0.1378], [0.8, 0.5541, -0.1165], [1, 0.5394, -0.1003], [2, 0.5129, -0.0577],
];
/** Функция Теодорсена C(k) = F + iG по таблице. */
export function theodorsen(k: number): { F: number; G: number } {
  const T = THEODORSEN;
  if (!(k > 0)) return { F: 1, G: 0 };
  for (let i = 1; i < T.length; i++) {
    if (k <= T[i][0]) {
      const x = (k - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
      return { F: T[i - 1][1] + x * (T[i][1] - T[i - 1][1]), G: T[i - 1][2] + x * (T[i][2] - T[i - 1][2]) };
    }
  }
  return { F: T[T.length - 1][1], G: T[T.length - 1][2] };
}

export function quasiSteadyThrustOverestimate(k: number): number {
  const { F, G } = theodorsen(k);
  return 1 / (F * F + G * G);
}

/**
 * Нестационарная подъёмная сила во времени: функция Вагнера в приближении Р. Т. Джонса,
 *   φ(s) = 1 − 0,165·e^(−0,0455·s) − 0,335·e^(−0,3·s),  s = 2·V·t / c — путь в полухордах.
 * После скачка угла атаки подъёмная сила сразу равна половине установившейся и дорастает
 * за десятки полухорд. Для гармонических колебаний это то же, что функция Теодорсена.
 * Состояние — две «запаздывающие» добавки x и y; эффективный угол α_E = α − x − y.
 */
export const WAGNER = { A1: 0.165, A2: 0.335, b1: 0.0455, b2: 0.3 };
export function wagnerStep(state: { x: number; y: number }, dAlpha: number, ds: number): void {
  const W = WAGNER;
  state.x = state.x * Math.exp(-W.b1 * ds) + W.A1 * dAlpha * Math.exp((-W.b1 * ds) / 2);
  state.y = state.y * Math.exp(-W.b2 * ds) + W.A2 * dAlpha * Math.exp((-W.b2 * ds) / 2);
}

/**
 * Международная стандартная атмосфера (высота геопотенциальная), масштабированная на заданную среду:
 * тропосфера до 11 км (−6,5 К/км), изотермический слой до 20 км (216,65 К, давление падает в e раз
 * на 6 341,6 м), слой с +1 К/км до 32 км; выше — как на 32 км. Раньше выше 11 км плотность замирала
 * на значении 11 км: на 15 км 0,364 кг/м³ вместо 0,194, на 20 км — в 4 раза больше настоящей.
 */
/**
 * Атмосфера на высоте: стандартная (МСА) по давлению, температура — стандартная плюс dT (°C, «ISA ± dT»).
 * Давление на высоте от температуры не зависит (высота — барометрическая), плотность — по уравнению состояния.
 */
export function atmosphere(env: Environment, altitude: number, dT = 0) {
  const std = atmosphereStd(env, altitude);
  if (!dT) return std;
  const Tstd = 288.15 * (std.soundSpeed / env.soundSpeed) ** 2;
  const k = Tstd / (Tstd + dT);
  return { rho: std.rho * k, soundSpeed: std.soundSpeed / Math.sqrt(k) };
}

function atmosphereStd(env: Environment, altitude: number) {
  const h = Math.max(0, Math.min(altitude, 32000));
  const T0 = 288.15, T11 = 216.65, H11 = 6341.62; // H = R·T/g для изотермического слоя
  const d11 = (T11 / T0) ** 5.2559;
  let T: number, delta: number;
  if (h <= 11000) {
    T = T0 - 0.0065 * h;
    delta = (T / T0) ** 5.2559;
  } else if (h <= 20000) {
    T = T11;
    delta = d11 * Math.exp(-(h - 11000) / H11);
  } else {
    T = T11 + 0.001 * (h - 20000);
    delta = d11 * Math.exp(-9000 / H11) * (T / T11) ** -34.1632;
  }
  const theta = T / T0;
  return { rho: env.rho * (delta / theta), soundSpeed: env.soundSpeed * Math.sqrt(theta) };
}

/** Индуктивная скорость винта по импульсной теории (Глауэрт), итерацией. */
/**
 * Влияние земли на несущий винт: во сколько раз индуктивная скорость у земли меньше, чем вдали от неё.
 * Модель зеркального отображения Чизмена — Беннета (ARC R&M 3021, 1955): винт — источник, земля — его отражение;
 * v_IGE / v_OGE = 1 − (R/4z)² / (1 + (V/vᵢ)²). V — скорость вдоль диска: в полёте вперёд струя уходит назад
 * и влияние земли пропадает. z — расстояние от втулки до земли вдоль оси винта.
 * Эта формула не подбиралась под опыты; сверка с лётными и стендовыми измерениями — в src/cli/validation.ts.
 * Ниже z/R = 0,35 формула вырождается (при z = R/4 — ноль); там берётся её значение при 0,35 — у таких высот
 * лопасти почти касаются земли, и модель за них не отвечает.
 */
export function rotorGroundFactor(z: number, radius: number, vEdge: number, vi: number): number {
  if (!(z > 0) || !(radius > 0)) return 1;
  const zr = Math.max(z / radius, 0.35);
  if (zr > 6) return 1;
  const s = 1 / (4 * zr);
  const fwd = vi > 1e-6 ? 1 / (1 + (vEdge / vi) ** 2) : 0;
  return 1 - s * s * fwd;
}

/**
 * Влияние земли на крыло: доля индуктивного скоса, которая остаётся у земли. Теория Визельсбергера (зеркальное крыло,
 * NACA TM 77, 1922) в общепринятой записи: 1 − (1 − 1,32·h/b) / (1,05 + 7,4·h/b). h — высота четверти хорды над землёй,
 * b — полный размах. При h/b ≥ 0,76 — 1 (влияния нет). Ниже h/b ≈ 0,03 теория занижает выгоду (TN D-926).
 */
export function wingGroundFactor(h: number, span: number): number {
  if (!(span > 0) || !(h > 0)) return 1;
  const hb = h / span;
  if (hb >= 0.757) return 1;
  return 1 - (1 - 1.32 * hb) / (1.05 + 7.4 * hb);
}

export function rotorInflow(thrust: number, rho: number, area: number, vAxial: number, vEdge: number, prev: number): number {
  if (thrust <= 0 || area <= 0) return 0;
  let vi = Math.max(prev, Math.sqrt(thrust / (2 * rho * area)) * 0.5);
  for (let i = 0; i < 20; i++) {
    const next = thrust / (2 * rho * area * Math.sqrt(vEdge * vEdge + (vAxial + vi) ** 2));
    if (Math.abs(next - vi) < 1e-6 * (1 + vi)) return next;
    vi = 0.5 * vi + 0.5 * next;
  }
  return vi;
}
