// Дополнительная проверка физики (ТЗ, раздел 12, уровень 1 и общие законы):
// свободное падение, установившаяся скорость, маятник, сохранение импульса, тяга и баланс
// энергии машущего крыла, сходимость по шагу, симметрия. Каждая проверка сравнивает расчёт
// с формулой, которая от программы не зависит.
// Запуск отдельно: npm run physics. Эти же проверки входят в npm run check.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { lambCoefficients, Sim, vortexSegment } from '../core/sim.ts';
import { laminateProps } from '../core/laminate.ts';
import { flutterAnalysis } from '../core/aeroelastic.ts';
import type { Spec } from '../core/spec.ts';
import { applyAssumptions } from '../core/spec.ts';
import { add, copy, cross, deg, len, qMul, rotate, scale, sub, v3, type V3 } from '../core/vec.ts';
import { airfoilCoeffs, atmosphere, theodorsen } from '../core/aero.ts';
import { MATERIALS } from '../core/materials.ts';
import { VibrationMeter } from '../core/crew.ts';
import { sectionAt } from '../core/section.ts';
import { fatigueCycles, plateK, plateStiffness, stationStress } from '../core/strength.ts';
import { ornithopter } from '../presets/ornithopter.ts';
import { r22 } from '../presets/r22.ts';
import { cessna172 } from '../presets/cessna172.ts';
import { ProgramRun, type ProgramId, type ProgramOptions } from '../core/programs.ts';

export interface Reporter {
  report: (name: string, measured: number, expected: number, tol: number, unit?: string) => void;
  flag: (name: string, ok: boolean, detail?: string) => void;
  section: (title: string) => void;
  /**
   * Сверка с измерением, где расхождение модели с реальностью известно и объяснено. В допуске — «ПРОЙДЕН»;
   * вне допуска — «РАСХОЖДЕНИЕ» с причиной: печатается и считается отдельно, но не прячется и не валит прогон.
   * Допуск — погрешность эталона и известные упрощения модели, а не «сколько нужно, чтобы прошло».
   */
  diverge: (name: string, measured: number, expected: number, tol: number, reason: string, unit?: string) => void;
  /** Справочно, не проверка: число печатается, в счёт не идёт (например, сверка с эталоном, под который подобран параметр). */
  info: (text: string) => void;
}

/** Счётчики и печать для проверок; одни и те же в npm run check и npm run physics. */
export function makeReporter() {
  const n = { passed: 0, failed: 0, diverged: 0, info: 0 };
  const fmt = (x: number) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-2 && x !== 0) ? x.toExponential(3) : x.toFixed(3));
  const dev = (m: number, e: number) => Math.abs(m - e) / Math.abs(e);
  const line = (name: string, m: number, e: number, tol: number, unit: string) =>
    `${name}: расчёт ${fmt(m)}${unit}, ожидается ${fmt(e)}${unit}, отклонение ${(dev(m, e) * 100).toFixed(2)} % (допуск ${+(tol * 100).toFixed(4)} %)`;
  const rep: Reporter = {
    report: (name, m, e, tol, unit = '') => {
      const ok = dev(m, e) <= tol;
      ok ? n.passed++ : n.failed++;
      console.log(`${ok ? 'ПРОЙДЕН' : 'ПРОВАЛ '}  ${line(name, m, e, tol, unit)}`);
    },
    flag: (name, ok, detail = '') => {
      ok ? n.passed++ : n.failed++;
      console.log(`${ok ? 'ПРОЙДЕН' : 'ПРОВАЛ '}  ${name}${detail ? `: ${detail}` : ''}`);
    },
    section: (t) => console.log(`\n— ${t}`),
    diverge: (name, m, e, tol, reason, unit = '') => {
      const ok = Number.isFinite(m) && dev(m, e) <= tol;
      ok ? n.passed++ : n.diverged++;
      console.log(`${ok ? 'ПРОЙДЕН' : 'РАСХОЖДЕНИЕ'}  ${line(name, m, e, tol, unit)}${ok ? '' : `\n             причина: ${reason}`}`);
    },
    info: (text) => {
      n.info++;
      console.log(`СПРАВОЧНО ${text}`);
    },
  };
  const summary = (what: string) =>
    `\nИтого: ${n.passed} из ${n.passed + n.failed + n.diverged} ${what} пройдено` +
    (n.diverged ? `; ${n.diverged} — известное расхождение модели с измерениями (причины напечатаны выше и в README)` : '') +
    (n.failed ? `; ПРОВАЛЕНО ${n.failed}` : '') + (n.info ? `; справочных строк (не проверки): ${n.info}` : '') + '.';
  return { rep, n, summary };
}

const G = 9.81;
const RHO = 1.225;

const spec0 = (parts: Spec['parts'], joints: Spec['joints'] = [], actuators: Spec['actuators'] = [], bodyY = 100): Spec => ({
  schema: 1,
  meta: { name: 'проверка', class: 'fixed-wing', source: 'preset' },
  environment: { name: 'Земля', g: G, rho: RHO, soundSpeed: 340.3 },
  parts: [{ id: 'body', kind: 'body', position: [0, bodyY, 0], shape: { type: 'box', size: [1, 1, 1] }, mass: 100 }, ...parts],
  joints,
  actuators,
  powerplant: { power: 1e6 },
  crew: { part: 'body', seats: [[0, 0, 0]] },
  assumptions: [],
});

/** Центр масс и импульс всей системы по телам движка. */
function momentum(sim: Sim): { com: V3; p: V3; mass: number } {
  let m = 0;
  let com = v3();
  let p = v3();
  for (const b of sim.bodies) {
    const mb = b.rb.mass();
    const c = add(copy(b.rb.translation()), rotate(b.rb.rotation(), copy(b.rb.localCom())));
    // Скорость центра масс тела: linvel в Rapier — скорость центра масс.
    com = add(com, scale(c, mb));
    p = add(p, scale(copy(b.rb.linvel()), mb));
    m += mb;
  }
  return { com: scale(com, 1 / m), p, mass: m };
}

/** Идеальный профиль для сверки с формулами: без сопротивления и срыва. Проверка спецификации
 *  таких значений не пропускает (и правильно), поэтому они подставляются уже в собранную модель. */
function ideal(sim: Sim, id: string) {
  Object.assign(sim.partById.get(id)!.spec.aero!.airfoil, { cd0: 0, k: 0, clMax: 50, clMin: -50 });
}

/**
 * Прочность: напряжения, местная потеря устойчивости, усталость, резонанс — против формул,
 * посчитанных здесь же независимо от src/core/strength.ts.
 */
export function strengthChecks(RAPIER: typeof RAPIER_NS, { report, flag, section }: Reporter) {
  const al = MATERIALS.al7075;
  // Коробка 200 × 100 мм со стенкой 4 мм.
  const b = 0.2, h = 0.1, t = 0.004;
  const sec = sectionAt({ section: 'box', material: 'al7075', widthFrac: 0.2, heightFrac: 1, wall: t, skinArealMass: 0 }, 1, 0.1);
  const A = b * h - (b - 2 * t) * (h - 2 * t);
  const I = (b * h ** 3 - (b - 2 * t) * (h - 2 * t) ** 3) / 12;
  const Ilag = (h * b ** 3 - (h - 2 * t) * (b - 2 * t) ** 3) / 12;
  const wf = b - t; // ширина полки по средней линии
  const ww = h - t; // высота стенки
  const plate = (k: number, w: number, m = al) => ((k * Math.PI ** 2 * m.E) / (12 * (1 - m.nu ** 2))) * (t / w) ** 2;
  const zero = { tension: 0, mFlap: 0, mLag: 0, torsion: 0, vNormal: 0, vChord: 0 };

  section('Прочность сечения: напряжения по формулам сопромата');
  {
    report('площадь коробки', sec.area, A, 1e-9, ' м²');
    report('момент инерции при изгибе взмаха', sec.iFlap, I, 1e-9, ' м⁴');
    const M = 5000;
    const r1 = stationStress(sec, al, { ...zero, mFlap: M });
    report('изгиб 5 кН·м: напряжение в полке M·(h/2)/I', r1.sigmaTension, (M * h) / 2 / I, 1e-9, ' Па');
    const T = 1000;
    const r2 = stationStress(sec, al, { ...zero, torsion: T });
    report('кручение 1 кН·м: τ = T / (2·A·t) (Бредт)', r2.tau, T / (2 * wf * ww * t), 1e-9, ' Па');
    // Срез: наибольший — на нейтральной оси, τ = V·S/(I·2t) (Журавский); S — статический момент половины
    // сечения: полка b·t на плече (h − t)/2 и две стенки высотой h/2 − t на плече их середины.
    const V = 10000;
    const r3 = stationStress(sec, al, { ...zero, vNormal: V });
    const Shalf = b * t * (h - t) / 2 + 2 * t * (h / 2 - t) * (h / 2 - t) / 2;
    report('перерезывающая сила 10 кН: τ = V·S / (I·2t) (Журавский)', r3.tau, (V * Shalf) / (I * 2 * t), 1e-9, ' Па');
    const N = 200000;
    const r4 = stationStress(sec, al, { ...zero, tension: N, torsion: T });
    report('растяжение с кручением: √(σ² + 3τ²) (Мизес)', r4.sigmaTension, Math.hypot(N / A, Math.sqrt(3) * (T / (2 * wf * ww * t))), 1e-9, ' Па');
    report('запас по разрыву: предел прочности / эквивалентное напряжение', r4.margin, al.ultTension / r4.sigmaTension, 1e-9);
    // Труба: два изгиба складываются как векторы.
    const tube = sectionAt({ section: 'tube', material: 'al7075', diameter: 0.1, wall: 0.003, skinArealMass: 0 }, 1, 0.1);
    const It = (Math.PI * (0.1 ** 4 - 0.094 ** 4)) / 64;
    const r5 = stationStress(tube, al, { ...zero, mFlap: 300, mLag: 400 });
    report('труба, изгибы 300 и 400 Н·м: напряжение от суммарных 500 Н·м', r5.sigmaTension, (500 * 0.05) / It, 1e-9, ' Па');
  }

  section('Прочность сечения: местная потеря устойчивости стенок');
  {
    flag('коэффициент устойчивости: равномерное сжатие 4, ноль на кромке 7,81, чистый изгиб 23,9',
      Math.abs(plateK(1) - 4) < 0.01 && Math.abs(plateK(0) - 7.81) < 0.01 && Math.abs(plateK(-1) - 23.9) < 0.03 && Math.abs(plateK(-0.9999) - 23.9) < 0.03 && Math.abs(plateK(1e-6) - 7.81) < 0.01,
      `${plateK(1).toFixed(2)}, ${plateK(0).toFixed(2)}, ${plateK(-1).toFixed(2)}`);
    // Сжатие вдоль: все четыре стенки сжаты равномерно, первой выпучивается самая широкая.
    const N = -300000;
    const r1 = stationStress(sec, al, { ...zero, tension: N });
    report('чистое сжатие: критическое напряжение — широкой полки, k = 4', r1.bucklingStress, plate(4, wf), 1e-6, ' Па');
    report('чистое сжатие: запас = критическое / действующее', r1.margin, plate(4, wf) / (-N / A), 1e-6);
    // Изгиб взмаха: полка сжата равномерно (k = 4), стенка — изгиб в своей плоскости (k = 23,9).
    const r2 = stationStress(sec, al, { ...zero, mFlap: 20000 });
    report('изгиб взмаха: критическое — меньшее из полки (k = 4) и стенки (k = 23,9)', r2.bucklingStress, Math.min(plate(4, wf), plate(23.9, ww)), 2e-3, ' Па');
    // Изгиб в плоскости крыла: теперь равномерно сжата стенка (k = 4), а полка — в изгибе (k = 23,9).
    const Ml = 20000;
    const r3 = stationStress(sec, al, { ...zero, mLag: Ml });
    const sl = (Ml * b) / 2 / Ilag;
    report('изгиб в плоскости крыла: критическое — стенки, сжатой равномерно (k = 4)', r3.bucklingStress, plate(4, ww), 1e-6, ' Па');
    report('изгиб в плоскости крыла: запас', Math.min(r3.margin, plate(4, ww) / sl), Math.min(plate(4, ww) / sl, al.ultCompression / sl, al.ultTension / sl), 1e-6);
    // Композит: стенка из однонаправленного углепластика.
    const c = MATERIALS.cfrp;
    const nu21 = (c.nu * c.E2!) / c.E;
    const den = 1 - c.nu * nu21;
    const B = Math.sqrt(c.E * c.E2!) / den + (c.nu * c.E2!) / den + 2 * c.G12!;
    report('углепластик вдоль волокон: жёсткость на выпучивание √(Q₁₁Q₂₂) + Q₁₂ + 2Q₆₆', plateStiffness(c), B, 1e-9, ' Па');
    report('то же числом: 50,0 ГПа (E₁ = 135, E₂ = 10, G₁₂ = 5 ГПа, ν = 0,3)', plateStiffness(c), 50.009e9, 1e-3, ' Па');
    const iso = (2 * c.E) / (1 - c.nu ** 2);
    flag('это в 5,9 раза меньше, чем дала бы формула для изотропного материала с продольным модулем', Math.abs(iso / plateStiffness(c) - 5.93) < 0.02, `${(iso / plateStiffness(c)).toFixed(2)} раза`);
    report('у изотропного металла формула сводится к 2E / (1 − ν²)', plateStiffness(al), (2 * al.E) / (1 - al.nu ** 2), 1e-9, ' Па');
  }

  section('Усталость: кривая Баскина и поправка Гудмана');
  {
    const fa = al.fatigue!;
    report('знакопеременная амплитуда, равная пределу выносливости: число циклов из справочника', fatigueCycles(al, fa.strength * 1.0001, -fa.strength * 1.0001), fa.cycles, 0.01);
    const amp = fa.strength * 1.5;
    report('амплитуда в 1,5 раза больше: ресурс меньше в 1,5^(−1/b) раза', fatigueCycles(al, amp, -amp), fa.cycles * 1.5 ** (1 / fa.b), 0.01);
    // Среднее растяжение: по Гудману та же долговечность при амплитуде, уменьшенной на (1 − σ_ср/σ_в).
    const mean = 0.3 * al.ultTension;
    const a2 = amp * (1 - mean / al.ultTension);
    report('среднее растяжение 30 % предела прочности: амплитуда 0,7 от прежней даёт тот же ресурс', fatigueCycles(al, mean + a2, mean - a2), fatigueCycles(al, amp, -amp), 0.01);
    report('среднее сжатие ресурс не уменьшает', fatigueCycles(al, -mean + amp, -mean - amp), fatigueCycles(al, amp, -amp), 1e-9);
  }

  section('Нагрузки от воздуха: изгиб крыла в ровном потоке');
  {
    // Прямое крыло в потоке, подъёмная сила распределена по размаху равномерно:
    // изгибающий момент в корне M = L·b/2, перерезывающая сила V = L.
    const U = 30, span = 5, chord = 1;
    const wing: Spec['parts'][number] = {
      id: 'w', kind: 'wing', position: [0, 100, 0],
      aero: { side: 1, span, rootChord: chord, tipChord: chord, incidenceDeg: 5, sections: 20, induced: 'wing',
        airfoil: { cl0: 0, clAlpha: 5.7, clMax: 1.5, cd0: 0.01, k: 0, thickness: 0.12 } },
      structure: { section: 'box', material: 'al7075', widthFrac: 0.2, heightFrac: 0.9, wall: 0.003, skinArealMass: 2 },
    };
    const sim = new Sim(RAPIER, spec0([wing], [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }]), { wind: v3(-U, 0, 0), gravity: false, breakable: false });
    sim.lockRoot('fixed');
    sim.advance(2);
    const w = sim.partById.get('w')!;
    const st = w.stations[0];
    const sc = w.elements[0].section!;
    const Lf = w.aeroForce.y, Df = -w.aeroForce.x;
    const fl = (Lf * span) / 2 * (sc.h / 2) / sc.iFlap;
    const lg = (Df * span) / 2 * (sc.b / 2) / sc.iLag;
    report('напряжение в корне от подъёмной силы и сопротивления: (L·b/2)·(h/2)/I + (D·b/2)·(c/2)/I', Math.max(...st.corners.map(Math.abs)), fl + lg, 0.01, ' Па');
    // Журавский: τ = V·S/(I·2t), S — статический момент половины сечения относительно нейтральной оси.
    const S = (bb: number, hh: number) => bb * sc.t * (hh - sc.t) / 2 + 2 * sc.t * (hh / 2 - sc.t) ** 2 / 2;
    report('касательное в корне: L·S/(I·2t) + D·S/(I·2t) (Журавский, по двум осям)', st.tau, (Lf * S(sc.b, sc.h)) / (sc.iFlap * 2 * sc.t) + (Df * S(sc.h, sc.b)) / (sc.iLag * 2 * sc.t), 0.01, ' Па');
    sim.free();
  }

  section('Резонанс: усиление нагрузок упругим крылом');
  {
    // Крыло машет в пустоте с частотой вдвое ниже собственной. Колебательная часть изгиба
    // усиливается в 1/√((1 − r²)² + (2ζr)²) раз, r = 0,5, ζ = 0,03.
    const wingSpec = (): Spec['parts'][number] => ({
      id: 'w', kind: 'wing', position: [0, 100, 0],
      aero: { side: 1, span: 4, rootChord: 0.5, tipChord: 0.5, incidenceDeg: 0, sections: 20, induced: 'none',
        airfoil: { cl0: 0, clMax: 1.2, cd0: 0.01, thickness: 0.12 } },
      structure: { section: 'box', material: 'al7075', widthFrac: 0.3, heightFrac: 0.9, wall: 0.002, skinArealMass: 3 },
    });
    const make = (freq: number) => {
      const sp = spec0([wingSpec()], [{ id: 'hinge', type: 'revolute', parent: 'body', child: 'w', axis: [1, 0, 0] }],
        [{ id: 'flap', type: 'oscillator', freqHz: freq, amplitudeDeg: 2, rampTime: 0, joints: [{ joint: 'hinge', sign: 1 }] }]);
      sp.meta.class = 'flapping';
      const sim = new Sim(RAPIER, sp, { aero: false, gravity: false, breakable: false, stepScale: 4 });
      sim.lockRoot('fixed');
      return sim;
    };
    const probe = make(1);
    const f1 = probe.partById.get('w')!.elastic!.f1;
    probe.free();
    const freq = f1 / 2;
    const sim = make(freq);
    const w = sim.partById.get('w')!;
    sim.advance(14 / freq);
    let lo = Infinity, hi = -Infinity;
    sim.advance(2 / freq, () => {
      lo = Math.min(lo, w.stations[0].sigmaTop);
      hi = Math.max(hi, w.stations[0].sigmaTop);
    });
    const sc = w.elements[0].section!;
    const om = 2 * Math.PI * freq;
    const Ih = w.elements.reduce((acc, e) => acc + e.mass * e.r.z * e.r.z, 0);
    const rigid = (Ih * 2 * deg * om * om * (sc.h / 2)) / sc.iFlap;
    const daf = 1 / Math.sqrt((1 - 0.25) ** 2 + (2 * 0.03 * 0.5) ** 2);
    report(`собственная частота ${f1.toFixed(2)} Гц, взмах ${freq.toFixed(2)} Гц: размах напряжения в корне = жёсткое крыло × ${daf.toFixed(3)}`, (hi - lo) / 2, rigid * daf, 0.04, ' Па');
    sim.free();
  }
}

/**
 * Нестационарное обтекание (aero.unsteady): сверка с функцией Вагнера и теорией Теодорсена — Гаррика.
 */
export function unsteadyChecks(RAPIER: typeof RAPIER_NS, { report, flag, section }: Reporter) {
  const U = 20;
  const c = 0.3;
  const R = 2;
  const a = 2 * Math.PI * 0.9;
  const wingPart = (unsteady: boolean): Spec['parts'][number] => ({
    id: 'w', kind: 'wing', position: [0, 100, 0], mass: 2,
    aero: { side: 1, span: R, rootChord: c, tipChord: c, incidenceDeg: 0, sections: 20, induced: 'none', unsteady,
      airfoil: { cl0: 0, clAlpha: a, clMax: 1.5, cd0: 0.01, k: 0, thickness: 0.1 } },
  });

  section('Нестационарное обтекание: скачок угла атаки (функция Вагнера)');
  {
    // Неподвижное крыло в потоке; в какой-то момент поток получает вертикальную составляющую.
    // Подъёмная сила сразу равна половине установившейся и дорастает по φ(s), s — путь в полухордах.
    const sim = new Sim(RAPIER, spec0([wingPart(true)], [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }]), { wind: v3(-U, 0, 0), gravity: false });
    sim.lockRoot('fixed');
    ideal(sim, 'w');
    sim.advance(0.1);
    const w = sim.partById.get('w')!;
    const gust = 1;
    sim.opts.wind = v3(-U, gust, 0);
    const V = Math.hypot(U, gust);
    const steady = 0.5 * RHO * V * V * c * R * a * Math.atan(gust / U);
    const ds = (2 * V * sim.dt) / c;
    const phi = (x: number) => 1 - 0.165 * Math.exp(-0.0455 * x) - 0.335 * Math.exp(-0.3 * x);
    sim.step();
    report('сразу после скачка: около половины установившейся силы', len(w.aeroForce) / steady, phi(ds / 2), 0.01);
    flag('это близко к точному значению функции Вагнера φ(0) = 0,5', Math.abs(len(w.aeroForce) / steady - 0.5) < 0.05, (len(w.aeroForce) / steady).toFixed(3));
    for (let i = 1; i < 18; i++) sim.step();
    report(`через ${(17.5 * ds).toFixed(1)} полухорды пути: φ(s)`, len(w.aeroForce) / steady, phi(17.5 * ds), 0.01);
    sim.advance(3);
    report('через 3 с: установившаяся подъёмная сила', len(w.aeroForce) / steady, 1, 0.01);
    sim.free();
  }

  section('Нестационарное обтекание: запаздывание срыва');
  {
    // Крыло в потоке, угол установки растёт. Медленно — должна получиться статическая поляра
    // (в том числе за срывом). Быстро — срыв запаздывает: подъёмная сила превышает статический
    // максимум и срывается на большем угле; после остановки возвращается к статическому значению.
    const af = { cl0: 0, clAlpha: a, clMax: 1.2, cd0: 0.01, k: 0.01, thickness: 0.1 };
    const stallDeg = (af.clMax / a) / deg;
    const make = () => {
      const part = wingPart(true);
      part.aero!.airfoil = { ...af };
      part.aero!.control = { channel: 'pitch', deg: 1 };
      const sim = new Sim(RAPIER, spec0([part], [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }]), { wind: v3(-U, 0, 0), gravity: false });
      sim.lockRoot('fixed');
      sim.channels.pitch = 0;
      sim.advance(0.2);
      return sim;
    };
    const qS = 0.5 * RHO * U * U * c * R;
    {
      const sim = make();
      const w = sim.partById.get('w')!;
      const T = 40; // с: 25° за 40 с — около 10⁻⁴ рад на полухорду пути
      let worst = 0;
      let at = 0;
      sim.advance(T, () => {
        const ang = (25 * (sim.t - 0.2)) / T;
        sim.channels.pitch = ang;
        if (ang < 4) return;
        const st = airfoilCoeffs(af, ang * deg, U / 340.3).cl;
        const dev = Math.abs(w.aeroForce.y / qS - st) / Math.abs(st);
        if (dev > worst) {
          worst = dev;
          at = ang;
        }
      });
      flag('медленный рост угла от 4° до 25°: подъёмная сила идёт по статической поляре (отклонение меньше 3 %)', worst < 0.03, `наибольшее отклонение ${(worst * 100).toFixed(2)} % на ${at.toFixed(1)}°; срыв в установившемся потоке на ${stallDeg.toFixed(1)}°`);
      sim.free();
    }
    {
      const sim = make();
      const w = sim.partById.get('w')!;
      const T = 0.15; // с: 25° за 0,15 с — около 0,02 рад на полухорду
      let clMax = 0;
      let atMax = 0;
      sim.advance(T, () => {
        const ang = Math.min(25, (25 * (sim.t - 0.2)) / T);
        sim.channels.pitch = ang;
        const cl = w.aeroForce.y / qS;
        if (cl > clMax) {
          clMax = cl;
          atMax = ang;
        }
      });
      sim.channels.pitch = 25;
      sim.advance(3);
      const st = airfoilCoeffs(af, 25 * deg, U / 340.3).cl;
      flag('быстрый рост угла: подъёмная сила превышает статический максимум больше чем на 10 %', clMax > 1.1 * af.clMax, `C_L до ${clMax.toFixed(2)} при статическом максимуме ${af.clMax}`);
      flag('срыв наступает позже: наибольшая подъёмная сила — на угле на 3° и больше за статическим срывным', atMax > stallDeg + 3, `на ${atMax.toFixed(1)}° против ${stallDeg.toFixed(1)}°`);
      report('после остановки подъёмная сила возвращается к статической', w.aeroForce.y / qS, st, 0.02);
      sim.free();
    }
  }

  section('Нестационарное обтекание: взмах против теории Теодорсена — Гаррика');
  for (const f of [2, 6]) {
    // То же машущее крыло, что в квазистационарной проверке, но с запаздыванием подъёмной силы.
    // По Гаррику для чистого взмаха: тяга меньше в F² + G² раз, мощность — в F раз,
    // где F + iG — функция Теодорсена при k = ω·c / 2U. Сравниваются отношения к расчёту
    // без запаздывания: погрешность привода при этом сокращается.
    const run = (unsteady: boolean) => {
      const sp = spec0([wingPart(unsteady)], [{ id: 'hinge', type: 'revolute', parent: 'body', child: 'w', axis: [1, 0, 0] }],
        [{ id: 'flap', type: 'oscillator', freqHz: f, amplitudeDeg: 2, rampTime: 0, joints: [{ joint: 'hinge', sign: 1 }] }]);
      sp.meta.class = 'flapping';
      const sim = new Sim(RAPIER, sp, { wind: v3(-U, 0, 0), gravity: false, breakable: false, stepScale: 4 });
      sim.lockRoot('fixed');
      ideal(sim, 'w');
      const w = sim.partById.get('w')!;
      const j = w.joint!;
      sim.advance(6 / f); // переходный процесс запаздывания: десятки полухорд пути
      let T = 0, P = 0, n = 0;
      sim.advance(3 / f, () => {
        T += w.aeroForce.x;
        P += j.shaftPower;
        n++;
      });
      sim.free();
      return { T: T / n, P: P / n };
    };
    const qs = run(false);
    const un = run(true);
    const k = (2 * Math.PI * f * c) / (2 * U);
    const { F, G } = theodorsen(k);
    report(`k = ${k.toFixed(3)}: тяга меньше в F² + G² раз`, un.T / qs.T, F * F + G * G, 0.05);
    report(`k = ${k.toFixed(3)}: мощность на валу меньше в F раз`, un.P / qs.P, F, 0.05);
    report(`k = ${k.toFixed(3)}: КПД взмаха (F² + G²) / F`, (un.T * U) / un.P, (F * F + G * G) / F, 0.05);
  }
}

/**
 * Четвёртая, независимая проверка (2026-11-12): то, чего прежние проверки не ловили.
 * Каждая находка подтверждена здесь числом против формулы, которая от программы не зависит.
 */
export function auditChecks(RAPIER: typeof RAPIER_NS, { report, flag, section }: Reporter) {
  const st = { section: 'box' as const, material: 'al7075', widthFrac: 0.3, heightFrac: 1, wall: 0.003, skinArealMass: 0 };

  section('Наклонная балка: нагрузки по оси балки, а не по осям детали');
  {
    // Крыло с поперечным V 30° под собственным весом. Сила в корне — вес W; по оси балки это сжатие W·sin Γ,
    // поперёк — срез W·cos Γ; изгибающий момент — W на горизонтальном плече до центра масс (половина проекции размаха).
    // То же крыло, заданное поворотом детали, должно дать то же самое: физика не зависит от способа описания.
    const Gam = 30, span = 2, m = 10;
    const wing = (rot: [number, number, number], sp: number, dih: number): Spec['parts'][number] => ({
      id: 'w', kind: 'wing', position: [0, 100, 0.5], rotation: rot, mass: m,
      aero: { side: 1, span: sp, rootChord: 0.3, tipChord: 0.3, incidenceDeg: 0, dihedralDeg: dih, sections: 20, induced: 'none',
        airfoil: { cl0: 0, clMax: 1, cd0: 0.01, thickness: 0.12 } },
      structure: st,
    });
    const loads = (w: Spec['parts'][number]) => {
      const sim = new Sim(RAPIER, spec0([w], [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }]), { aero: false });
      sim.lockRoot('fixed');
      sim.advance(0.3);
      const l = [...sim.partById.get('w')!.stations[0].lp!];
      sim.free();
      return l;
    };
    const a = loads(wing([0, 0, 0], span, Gam));
    const b = loads(wing([-Gam, 0, 0], span / Math.cos(Gam * deg), 0));
    const W = m * G;
    report('поперечное V 30°: срез поперёк оси балки W·cos Γ', a[4], W * Math.cos(Gam * deg), 1e-3, ' Н');
    report('поперечное V 30°: сжатие вдоль оси балки W·sin Γ', -a[0], W * Math.sin(Gam * deg), 1e-3, ' Н');
    report('поперечное V 30°: изгиб в корне W·(b/2)', -a[1], (W * span) / 2, 1e-3, ' Н·м');
    flag('то же крыло, повёрнутое как деталь: те же нагрузки (до 0,1 %)', a.every((x, i) => Math.abs(x - b[i]) <= 1e-3 * W * span),
      `V: ${a.map((x) => x.toFixed(2)).join(', ')}; поворот: ${b.map((x) => x.toFixed(2)).join(', ')}`);
  }
  {
    // Лопасть с конусностью β в пустоте: центробежная сила горизонтальна, по оси лопасти это растяжение
    // F·cos β, поперёк — срез F·sin β. Раньше срез выходил нулём, а у лопасти с тягой — равным всей тяге.
    const beta = 4, span = 3, R0 = 0.3, rpm = 300;
    const blade = (id: string, z: number, rot: number): Spec['parts'][number] => ({
      id, kind: 'blade', position: [0, 100, z], rotation: [0, rot, 0], mass: 8,
      aero: { side: 1, span, rootChord: 0.2, tipChord: 0.2, incidenceDeg: 0, dihedralDeg: beta, sections: 16, airfoil: { cl0: 0, clMax: 1.4, cd0: 0.01, thickness: 0.12 } },
      structure: { ...st, widthFrac: 0.4, heightFrac: 0.9, wall: 0.004 },
    });
    const s = spec0(
      [{ id: 'hub', kind: 'hub', position: [0, 100, 0], shape: { type: 'cylinder', size: [0.3, 0.2, 0.3] }, mass: 5 }, blade('b1', R0, 0), blade('b2', -R0, 180)],
      [{ id: 'mast', type: 'revolute', parent: 'body', child: 'hub', axis: [0, 1, 0] }, { id: 'f1', type: 'fixed', parent: 'hub', child: 'b1' }, { id: 'f2', type: 'fixed', parent: 'hub', child: 'b2' }],
      [{ id: 'rotor', type: 'spinner', joint: 'mast', rpm, direction: 1, rampTime: 0.5 }],
    );
    s.meta.class = 'rotor';
    const sim = new Sim(RAPIER, s, { aero: false, gravity: false, breakable: false });
    sim.lockRoot('fixed');
    sim.advance(1.5);
    const b1 = sim.partById.get('b1')!;
    const om = (rpm * 2 * Math.PI) / 60;
    const CF = om * om * b1.elements.reduce((acc, e) => acc + e.mass * (R0 + e.spanFrac * span), 0);
    const lp = b1.stations[0].lp!;
    report(`конусность ${beta}°: растяжение в корне F·cos β`, lp[0], CF * Math.cos(beta * deg), 0.01, ' Н');
    report(`конусность ${beta}°: срез поперёк лопасти F·sin β`, Math.abs(lp[4]), CF * Math.sin(beta * deg), 0.02, ' Н');
    sim.free();
  }

  {
    // Мощность винта на висении почти не зависит от конусности: радиальная составляющая подъёмной силы
    // (L·sin β) работы не совершает, тяга меняется в cos β раз — различие порядка β² (0,5 % при 4°).
    // Раньше сила начала шага бралась в точке середины шага (лопасть за шаг поворачивается на 5–7°),
    // и радиальная составляющая давала ложный момент на валу — около 3 % мощности.
    const span = 3, R0 = 0.3;
    const power = (beta: number) => {
      const blade = (id: string, z: number, rot: number): Spec['parts'][number] => ({
        id, kind: 'blade', position: [0, 100, z], rotation: [0, rot, 0], mass: 8,
        aero: { side: 1, span, rootChord: 0.2, tipChord: 0.2, incidenceDeg: 8, dihedralDeg: beta, sections: 16, airfoil: { cl0: 0, clAlpha: 5.7, clMax: 1.4, cd0: 0.01, k: 0, thickness: 0.12 } },
      });
      const s = spec0(
        [{ id: 'hub', kind: 'hub', position: [0, 100, 0], shape: { type: 'cylinder', size: [0.3, 0.2, 0.3] }, mass: 5 }, blade('b1', R0, 0), blade('b2', -R0, 180)],
        [{ id: 'mast', type: 'revolute', parent: 'body', child: 'hub', axis: [0, 1, 0] }, { id: 'f1', type: 'fixed', parent: 'hub', child: 'b1' }, { id: 'f2', type: 'fixed', parent: 'hub', child: 'b2' }],
        [{ id: 'rotor', type: 'spinner', joint: 'mast', rpm: 400, direction: 1, rampTime: 1 }],
      );
      s.meta.class = 'rotor';
      const sim = new Sim(RAPIER, s, { gravity: false, breakable: false });
      sim.lockRoot('fixed');
      sim.advance(2);
      const mast = sim.joints.find((j) => j.spec.id === 'mast')!;
      let P = 0, T = 0, n = 0;
      sim.advance(1, () => {
        P += mast.shaftPower;
        T += sim.rotors[0].thrust;
        n++;
      });
      sim.free();
      return { P: P / n, T: T / n };
    };
    const flat = power(0), coned = power(4);
    report('конусность 4°: мощность на валу та же, что без неё (разница порядка β²)', coned.P / coned.T ** 1.5, flat.P / flat.T ** 1.5, 0.008);
  }

  section('Срез стенки коробки: наибольшее касательное (Журавский), а не среднее');
  {
    // Плоская коробка лопасти Ка-32: ширина 0,208 м, высота 0,0515 м, стенка 6 мм.
    const sec = sectionAt({ section: 'box', material: 'gfrp', widthFrac: 0.4, heightFrac: 0.9, wall: 0.006, skinArealMass: 0 }, 0.52, 0.11);
    const V = 10000;
    const r = stationStress(sec, MATERIALS.gfrp, { tension: 0, mFlap: 0, mLag: 0, torsion: 0, vNormal: V, vChord: 0 });
    const bo = sec.b, ho = sec.h, t = sec.t, bi = bo - 2 * t, hi = ho - 2 * t;
    const I = (bo * ho ** 3 - bi * hi ** 3) / 12;
    const S = bo * t * (ho - t) / 2 + t * (ho / 2 - t) ** 2;
    report('плоская коробка 208 × 51,5 × 6 мм: τ = V·S/(I·2t)', r.tau, (V * S) / (I * 2 * t), 1e-9, ' Па');
    flag('это на 16 % больше среднего по стенке V/(2·h·t), которое считалось раньше', Math.abs(r.tau / (V / (2 * ho * t)) - 1.163) < 0.01, `в ${(r.tau / (V / (2 * ho * t))).toFixed(3)} раза`);
  }

  section('Инерция тела из нескольких деталей: теорема Штейнера');
  {
    // Куб 100 кг со стороной 1 м и два бруска по 10 кг (10 см) на ±1 м по оси z, приварены.
    // Вокруг z: 100·2/12 + 2·10·0,02/12 (бруски лежат на самой оси); вокруг x и y — ещё 2·10·1².
    // Rapier 0.14 при сложении коллайдеров прибавлял m·(|d|²·E + d·dᵀ) вместо m·(|d|²·E − d·dᵀ):
    // вокруг z выходило 56,7 кг·м² вместо 16,7.
    const box = (id: string, z: number): Spec['parts'][number] => ({ id, kind: 'body', position: [0, 100, z], shape: { type: 'box', size: [0.1, 0.1, 0.1] }, mass: 10 });
    const sim = new Sim(RAPIER, spec0([box('a', 1), box('b', -1)], [{ id: 'ja', type: 'fixed', parent: 'body', child: 'a' }, { id: 'jb', type: 'fixed', parent: 'body', child: 'b' }]), { aero: false });
    const own = (100 * 2) / 12 + (2 * 10 * 0.02) / 12;
    const got = Object.values(copy(sim.root.b.rb.principalInertia())).sort((x, y) => x - y);
    report('вокруг оси, на которой лежат бруски: I_собств', got[0], own, 1e-4, ' кг·м²');
    report('поперёк: I_собств + 2·m·d²', got[2], own + 2 * 10, 1e-4, ' кг·м²');
    sim.free();
  }

  section('Сохранение момента импульса: винт раскручивается на свободном корпусе в пустоте');
  {
    // Привод — внутренняя сила: момент импульса системы остаётся нулём, корпус вращается навстречу
    // винту, ω_корп = −I_винт·ω_винт / I_корп. Энергия, отданная приводом (по нагрузкам Ньютона — Эйлера
    // на валу), равна кинетической энергии системы по скоростям движка.
    const span = 2, R0 = 0.2, rpm = 120;
    const blade = (id: string, z: number, rot: number): Spec['parts'][number] => ({
      id, kind: 'blade', position: [0, 100, z], rotation: [0, rot, 0], mass: 3,
      aero: { side: 1, span, rootChord: 0.15, tipChord: 0.15, incidenceDeg: 0, sections: 16, airfoil: { cl0: 0, clMax: 1.4, cd0: 0.01, thickness: 0.12 } },
    });
    const s = spec0(
      [{ id: 'hub', kind: 'hub', position: [0, 100.6, 0], shape: { type: 'box', size: [0.3, 0.2, 0.3] }, mass: 2 }, blade('b1', R0, 0), blade('b2', -R0, 180)],
      [{ id: 'mast', type: 'revolute', parent: 'body', child: 'hub', axis: [0, 1, 0] }, { id: 'f1', type: 'fixed', parent: 'hub', child: 'b1' }, { id: 'f2', type: 'fixed', parent: 'hub', child: 'b2' }],
      [{ id: 'rotor', type: 'spinner', joint: 'mast', rpm, direction: 1, rampTime: 1 }],
    );
    s.parts[0].position = [0, 100.6 - 0.6, 0]; // корпус прямо под втулкой: ось вращения проходит через центры масс
    s.meta.class = 'rotor';
    const sim = new Sim(RAPIER, s, { aero: false, gravity: false, breakable: false });
    const mast = sim.joints.find((j) => j.spec.id === 'mast')!;
    let work = 0;
    let Hmax = 0;
    sim.advance(1.5, () => {
      work += mast.shaftPower * sim.dt;
      Hmax = Math.max(Hmax, len(sim.angularMomentum(sim.systemCom())));
    });
    const hub = sim.partById.get('hub')!;
    const wRot = hub.b.rb.angvel().y - sim.root.b.rb.angvel().y;
    // Моменты инерции — по формулам, а не из движка: корпус-куб 1 м (m·(a²+a²)/12), втулка-брусок, лопасти —
    // точки сечений плюс хорда (как задаёт модель масс).
    const Ibody = (100 * (1 + 1)) / 12;
    const b1 = sim.partById.get('b1')!;
    const Iblades = 2 * b1.elements.reduce((acc, e) => acc + e.mass * ((R0 + e.spanFrac * span) ** 2 + (e.chord * e.chord) / 12), 0);
    const Irot = (2 * (0.3 * 0.3 + 0.3 * 0.3)) / 12 + Iblades;
    report('корпус вращается навстречу: ω_корп = −I_винт·ω_отн / (I_корп + I_винт)', -sim.root.b.rb.angvel().y, (Irot * wRot) / (Ibody + Irot), 0.01, ' рад/с');
    flag('момент импульса системы остаётся нулём (меньше 0,1 % момента импульса винта)', Hmax < 1e-3 * Irot * wRot, `${Hmax.toExponential(2)} из ${(Irot * wRot).toExponential(2)} кг·м²/с`);
    let KE = 0;
    for (const b of sim.bodies) {
      const v = copy(b.rb.linvel());
      const w = copy(b.rb.angvel());
      const qf = qMul(b.rb.rotation(), b.rb.principalInertiaLocalFrame());
      const Ip = copy(b.rb.principalInertia());
      const wl = rotate({ x: -qf.x, y: -qf.y, z: -qf.z, w: qf.w }, w);
      KE += 0.5 * b.rb.mass() * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * (Ip.x * wl.x * wl.x + Ip.y * wl.y * wl.y + Ip.z * wl.z * wl.z);
    }
    report('работа привода по моменту на валу = кинетическая энергия системы', work, KE, 0.02, ' Дж');
    sim.free();
  }

  section('Присоединённая масса воздуха: крыло машет в неподвижном воздухе');
  {
    // Профиль без подъёмной силы и сопротивления: от воздуха остаётся только присоединённая масса
    // ρ·π·c²/4 на метр размаха. Момент на шарнире растёт в (I_крыла + I_возд) / I_крыла раз, I_возд = Σ ρπc²/4·dr·r².
    const span = 1.5, c = 0.4, f = 3;
    const mk = (aero: boolean, unsteady: boolean) => {
      const w: Spec['parts'][number] = {
        id: 'w', kind: 'wing', position: [0, 100, 0], mass: 0.5,
        aero: { side: 1, span, rootChord: c, tipChord: c, incidenceDeg: 0, sections: 20, induced: 'none', addedMass: true, unsteady,
          airfoil: { cl0: 0, clMax: 1, cd0: 0.01, thickness: 0.1 } },
      };
      const sp = spec0([w], [{ id: 'hinge', type: 'revolute', parent: 'body', child: 'w', axis: [1, 0, 0] }],
        [{ id: 'flap', type: 'oscillator', freqHz: f, amplitudeDeg: 10, rampTime: 0, joints: [{ joint: 'hinge', sign: 1 }] }]);
      sp.meta.class = 'flapping';
      const sim = new Sim(RAPIER, sp, { aero, gravity: false, breakable: false, stepScale: 2 });
      sim.lockRoot('fixed');
      Object.assign(sim.partById.get('w')!.spec.aero!.airfoil, { clAlpha: 1e-9, cd0: 0, k: 0, clMax: 50, clMin: -50 });
      sim.advance(1 / f);
      let amp = 0;
      sim.advance(2 / f, () => (amp = Math.max(amp, Math.abs(sim.partById.get('w')!.joint!.moment.x))));
      const el = sim.partById.get('w')!.elements;
      sim.free();
      return { amp, el };
    };
    const vac = mk(false, false);
    const Iw = vac.el.reduce((acc, e) => acc + e.mass * e.r.z * e.r.z, 0);
    const Ia = vac.el.reduce((acc, e) => acc + ((RHO * Math.PI * c * c) / 4) * e.dr * e.r.z * e.r.z, 0);
    report('квазистационарная модель: момент на шарнире растёт в (I_крыла + I_возд)/I_крыла раз', mk(true, false).amp / vac.amp, (Iw + Ia) / Iw, 0.02);
    report('нестационарная модель (поворот сечения в потоке): то же', mk(true, true).amp / vac.amp, (Iw + Ia) / Iw, 0.03);
  }

  section('Поляра на всём круге углов и сжимаемость');
  {
    const af = { cl0: 0, clAlpha: 5.7, clMax: 1.3, cd0: 0.01, k: 0.01, thickness: 0.12 };
    let jump = 0;
    let asym = 0;
    let prev = airfoilCoeffs(af, -Math.PI, 0);
    for (let x = -180 + 0.01; x <= 180; x += 0.01) {
      const c = airfoilCoeffs(af, x * deg, 0);
      jump = Math.max(jump, Math.abs(c.cl - prev.cl), Math.abs(c.cd - prev.cd));
      asym = Math.max(asym, Math.abs(c.cl + airfoilCoeffs(af, -x * deg, 0).cl), Math.abs(c.cd - airfoilCoeffs(af, -x * deg, 0).cd));
      prev = c;
    }
    flag('поляра непрерывна на всём круге: скачок за 0,01° меньше 0,005', jump < 0.005, `наибольший ${jump.toExponential(2)}`);
    flag('симметричный профиль: C_L(−α) = −C_L(α), C_D(−α) = C_D(α)', asym < 1e-9, `${asym.toExponential(2)}`);
    const c90 = airfoilCoeffs(af, Math.PI / 2, 0);
    report('поперёк потока (90°): C_D = C_D0 + 1,98 (пластина, Хёрнер)', c90.cd, af.cd0 + 1.98, 1e-6);
    flag('поперёк потока и задом наперёд (180°): подъёмной силы нет', Math.abs(c90.cl) < 1e-9 && Math.abs(airfoilCoeffs(af, Math.PI, 0).cl) < 1e-9);
    const slope = (m: number) => (airfoilCoeffs(af, 2 * deg, m).cl - airfoilCoeffs(af, -2 * deg, m).cl) / (4 * deg);
    report('Прандтль — Глауэрт: наклон при M 0,5 больше в 1/√(1 − M²) раз', slope(0.5) / slope(0), 1 / Math.sqrt(1 - 0.25), 1e-6);
  }

  section('Вихрь и присоединённые массы тела: формулы против теории');
  {
    // Длинный прямой вихрь: v = Γ/(2πr) (Био — Савар для бесконечной нити), направление — по правилу правой руки.
    const v = vortexSegment(v3(0, 1, 0), v3(-1e4, 0, 0), v3(1e4, 0, 0), 2 * Math.PI, 1e-6);
    report('прямой вихрь Γ = 2π: скорость на расстоянии 1 м — 1 м/с', len(v), 1, 1e-6, ' м/с');
    flag('вихрь вдоль +x наводит над собой скорость вдоль +z (правая рука)', v.z > 0.999 && Math.abs(v.y) < 1e-9);
    // Полубесконечная нить в точке против её конца — половина бесконечной (Γ/(4πr)).
    report('полубесконечный вихрь против своего конца: Γ/(4πr)', len(vortexSegment(v3(0, 1, 0), v3(0, 0, 0), v3(1e5, 0, 0), 4 * Math.PI, 1e-6)), 1, 1e-4, ' м/с');
    // Таблица Лэмба («Гидродинамика», § 373): присоединённые массы эллипсоида вращения при отношении длины к диаметру.
    for (const [ld, k1, k2] of [[1.5, 0.305, 0.621], [3.99, 0.082, 0.86], [6.01, 0.045, 0.918], [9.97, 0.021, 0.96]]) {
      const k = lambCoefficients(ld, 1);
      report(`эллипсоид ${ld}:1 — k₁ = ${k1} (Лэмб)`, k.k1, k1, 0.02);
      report(`эллипсоид ${ld}:1 — k₂ = ${k2} (Лэмб)`, k.k2, k2, 0.005);
    }
  }

  section('Ламинат: классическая теория слоистых пластин против точных свойств');
  {
    const m = MATERIALS.im7_8552;
    const ud = laminateProps(m, { p0: 1, p45: 0, p90: 0 });
    report('однонаправленный: Ex = E1', ud.Ex, m.E, 1e-9, ' Па');
    report('однонаправленный: прочность на растяжение = Xt', ud.Xt, m.ultTension, 1e-9, ' Па');
    // Квазиизотропный ламинат (0/±45/90 поровну) изотропен в плоскости: Ex = Ey, Gxy = Ex/(2(1 + νxy)).
    const qi = laminateProps(m, { p0: 0.25, p45: 0.5, p90: 0.25 });
    report('квазиизотропный: Ex = Ey', qi.Ey, qi.Ex, 1e-9, ' Па');
    report('квазиизотропный: Gxy = Ex/(2(1 + νxy))', qi.Gxy, qi.Ex / (2 * (1 + qi.nuxy)), 1e-9, ' Па');
    // Слои 0/90: сдвиг в плоскости держит только связующее — Gxy = G12.
    report('слои 0/90: Gxy = G12', laminateProps(m, { p0: 0.5, p45: 0, p90: 0.5 }).Gxy, m.G12!, 1e-9, ' Па');
  }

  section('Флаттер: крыло Голанда (расчётный эталон, не измерение)');
  {
    // Goland (1945): консоль 6,096 м, хорда 1,8288 м, упругая ось на 33 % хорды, центр масс на 43 %, 35,71 кг/м,
    // момент инерции относительно центра масс 8,64 кг·м, EI = 9,77·10⁶, GJ = 0,987·10⁶ Н·м², ρ = 1,02 кг/м³.
    // Расчёты по полосам с аэродинамикой Теодорсена дают 137 м/с и около 70 рад/с (Goland 1945; Patil, Hodges, Cesnik 2001).
    const L = 6.096, c = 1.8288, n = 40, xa = 0.1 * c, mm = 35.71;
    const strips = Array.from({ length: n }, (_, i) => ({ y: ((i + 0.5) * L) / n, dy: L / n, b: c / 2, a: -0.34, m: mm, xa, Ia: 8.64 + mm * xa * xa, EI: 9.77e6, GJ: 0.987e6 }));
    const f = flutterAnalysis(strips, 1.02, 300);
    report('крыло Голанда: скорость флаттера', f.vFlutter, 137, 0.03, ' м/с');
    report('крыло Голанда: частота флаттера', f.fFlutter * 2 * Math.PI, 70, 0.05, ' рад/с');
  }

  section('Стандартная атмосфера выше 11 км');
  {
    // МСА (геопотенциальная высота): 11 км — 0,36392 кг/м³, 20 км — 0,08803, 32 км — 0,01322; скорость звука 295,07 м/с.
    // Раньше выше 11 км плотность не менялась.
    const env = { name: 'Земля', g: G, rho: 1.225, soundSpeed: 340.294 };
    report('плотность на 11 км', atmosphere(env, 11000).rho, 0.36392, 2e-4, ' кг/м³');
    report('плотность на 20 км (изотермический слой)', atmosphere(env, 20000).rho, 0.08803, 2e-4, ' кг/м³');
    report('плотность на 32 км', atmosphere(env, 32000).rho, 0.013225, 2e-3, ' кг/м³');
    report('скорость звука на 15 км', atmosphere(env, 15000).soundSpeed, 295.07, 1e-4, ' м/с');
    // Уравнение равновесия dp/dh = −ρ·g: p = ρ·R·T, проверяем численной производной на 15 км.
    const p = (h: number) => { const a = atmosphere(env, h); return a.rho * 287.053 * 216.65; };
    report('гидростатика на 15 км: −dp/dh = ρ·g₀', -(p(15001) - p(14999)) / 2, atmosphere(env, 15000).rho * 9.80665, 1e-3, ' Па/м');
  }

  section('Демпфирование взмаха лопасти воздухом: число Лока');
  {
    // Лопасть R22: γ = ρ·a·c·R⁴ / I_β, I_β — момент инерции лопасти относительно оси винта.
    // У шарнирной лопасти демпфирование взмаха ζ = γ/16; у бесшарнирной с частотой ν оборотов — около γ/(16·ν).
    const sim = new Sim(RAPIER, applyAssumptions(r22), { breakable: false });
    const b = sim.partById.get('blade1')!;
    const a = b.spec.aero!;
    const R0 = 0.45, R = R0 + a.span;
    const Ib = b.elements.reduce((acc, e) => acc + e.mass * (R0 + e.spanFrac * a.span) ** 2, 0);
    const gamma = (RHO * a.airfoil.clAlpha! * a.rootChord * R ** 4) / Ib;
    const el = b.elastic!;
    const nu = el.f1 / el.fe;
    report(`R22: демпфирование воздухом против γ/(16·ν), γ = ${gamma.toFixed(2)}, ν = ${nu.toFixed(3)}`, el.zetaAir, gamma / (16 * nu), 0.1);
    flag('R22: нагрузки усиливаются не больше пика резонансной кривой 1/(2ζ·√(1 − ζ²))', el.daf <= 1 / (2 * el.zeta * Math.sqrt(1 - el.zeta ** 2)) + 1e-9, `×${el.daf.toFixed(2)} при ζ = ${el.zeta.toFixed(3)}; без воздуха было бы ×${(1 / Math.sqrt((1 - el.ratio ** 2) ** 2 + (2 * 0.03 * el.ratio) ** 2)).toFixed(1)}`);
    sim.free();
  }

  section('Вибрация в кресле: тряска вдоль корпуса так же заметна, как вертикальная');
  {
    // Синусоида 5 Гц с амплитудой 2 м/с². Полоса 2–16 Гц — разность двух фильтров первого порядка:
    // |H| = |1/(1 + j·f/16) − 1/(1 + j·f/2)| = 0,775 на 5 Гц; с.к.з. = 2/√2 · |H| = 1,10 м/с².
    const dt = 1 / 2000;
    const H = (fq: number) => {
      const re1 = 1 / (1 + (fq / 16) ** 2), im1 = -(fq / 16) / (1 + (fq / 16) ** 2);
      const re2 = 1 / (1 + (fq / 2) ** 2), im2 = -(fq / 2) / (1 + (fq / 2) ** 2);
      return Math.hypot(re1 - re2, im1 - im2);
    };
    const meter = (axis: number) => {
      const m = new VibrationMeter(dt, 2);
      for (let i = 0; i < 4 / dt; i++) {
        const a = [0, 0, 0];
        a[1] = G; // тяжесть в осях корпуса — постоянная, в полосу не попадает
        a[axis] += 2 * Math.sin(2 * Math.PI * 5 * i * dt);
        m.push(a);
      }
      return m.rms;
    };
    report('вдоль корпуса, 5 Гц, 2 м/с²: с.к.з. в полосе 2–16 Гц', meter(0), (2 / Math.SQRT2) * H(5), 0.01, ' м/с²');
    report('вертикально — то же', meter(1), (2 / Math.SQRT2) * H(5), 0.01, ' м/с²');
    // Раньше в полосу шёл модуль |a − g|: тряска вдоль корпуса меняет его лишь во втором порядке.
    const old = (2 * 2) / (2 * G) / 2 / Math.SQRT2 * H(10);
    flag('прежний расчёт по модулю ускорения показал бы около 0,05 м/с² — в 20 раз меньше', old < 0.06 && meter(0) / old > 15, `${old.toFixed(3)} м/с²`);
  }

  section('Момент, которым фиксатор держит корпус: по моменту импульса и по нагрузкам на шарнире');
  {
    // Одно крыло машет на закреплённом корпусе в пустоте. Момент фиксатора относительно центра масс корпуса —
    // это то, что передаёт шарнир поддереву крыла (Ньютон — Эйлер стенда), а считается он по изменению момента
    // импульса системы по скоростям движка. Два независимых расчёта.
    const w: Spec['parts'][number] = {
      id: 'w', kind: 'wing', position: [0.3, 100.2, 0.5], mass: 2,
      aero: { side: 1, span: 1.5, rootChord: 0.3, tipChord: 0.3, incidenceDeg: 0, sections: 16, induced: 'none', airfoil: { cl0: 0, clMax: 1, cd0: 0.01, thickness: 0.1 } },
    };
    const sp = spec0([w], [{ id: 'hinge', type: 'revolute', parent: 'body', child: 'w', axis: [1, 0, 0] }],
      [{ id: 'flap', type: 'oscillator', freqHz: 2, amplitudeDeg: 20, rampTime: 0, joints: [{ joint: 'hinge', sign: 1 }] }]);
    sp.meta.class = 'flapping';
    const sim = new Sim(RAPIER, sp, { aero: false, breakable: false, stepScale: 2 });
    sim.lockRoot('fixed');
    sim.measureHold = true;
    sim.advance(0.5);
    const j = sim.partById.get('w')!.joint!;
    let err = 0, scaleM = 0;
    sim.advance(1, () => {
      const o = sim.bodyCom(sim.root.b);
      const jp = sim.pose(sim.partById.get('w')!, 'mid').t;
      const ne = add(j.moment, cross(sub(jp, o), j.force));
      err = Math.max(err, len(sub(sim.holdTorque, ne)));
      scaleM = Math.max(scaleM, len(ne));
    });
    flag('момент фиксатора совпадает с моментом на шарнире по Ньютону — Эйлеру (до 2 % наибольшего)', err < 0.02 * scaleM, `расхождение до ${err.toFixed(3)} Н·м при моменте до ${scaleM.toFixed(2)} Н·м`);
    sim.free();
  }
}

export function physicsChecks(RAPIER: typeof RAPIER_NS, rep: Reporter) {
  const { report, flag, section } = rep;
  strengthChecks(RAPIER, rep);
  unsteadyChecks(RAPIER, rep);
  auditChecks(RAPIER, rep);
  // ---------- свободное падение ----------
  section('Свободное падение и падение с сопротивлением');
  {
    const sim = new Sim(RAPIER, spec0([]), { aero: false });
    const y0 = sim.root.b.rb.translation().y;
    let crew = 0;
    sim.advance(2, () => (crew = Math.max(crew, sim.sample.crewAccel)));
    const t = sim.t;
    report('путь за 2 с: g·t²/2', y0 - sim.root.b.rb.translation().y, (G * t * t) / 2, 0.02, ' м');
    report('скорость через 2 с: g·t', -sim.root.b.rb.linvel().y, G * t, 0.02, ' м/с');
    flag('в свободном падении перегрузка в кресле — ноль (невесомость)', crew < 0.01, `${crew.toFixed(4)} g`);
    sim.free();
  }
  {
    const CdA = 5;
    const s = spec0([], [], [], 900);
    s.parts[0].dragArea = CdA;
    // Падение — поперёк продольной оси: сила — по C_D поперечного обтекания и площади плана. План 2 × 2 м, C_D 1,25 → C_D·S = 5 м².
    s.parts[0].shape = { type: 'box', size: [2, 1, 2] };
    s.parts[0].crossflowCd = CdA / 4;
    const sim = new Sim(RAPIER, s, {});
    sim.advance(12);
    const vt = Math.sqrt((2 * 100 * G) / (RHO * CdA));
    report('установившаяся скорость падения √(2mg / ρ·C_D·S)', -sim.root.b.rb.linvel().y, vt, 0.02, ' м/с');
    report('в установившемся падении перегрузка в кресле — 1 g', sim.sample.crewAccel, 1, 0.02, ' g');
    sim.free();
  }
  {
    // На земле: аппарат стоит, перегрузка 1 g.
    const s = spec0([], [], [], 0.5);
    const sim = new Sim(RAPIER, s, { aero: false });
    sim.advance(1);
    let crew = 0;
    let n = 0;
    sim.advance(0.5, () => {
      crew += sim.sample.crewAccel;
      n++;
    });
    report('аппарат стоит на земле: перегрузка в кресле 1 g', crew / n, 1, 0.02, ' g');
    sim.free();
  }

  // ---------- маятник на шарнире ----------
  section('Маятник на шарнире: период и сохранение энергии');
  {
    // Однородный стержень длиной L, шарнир на конце, отпущен из горизонтального положения.
    // Период при размахе 90°: T = 4·K(sin 45°)·√(2L / 3g), K = 1,854075 (полный эллиптический интеграл).
    const L = 1.5;
    const rod: Spec['parts'][number] = {
      id: 'rod', kind: 'wing', position: [0, 100, 0], mass: 4,
      aero: { side: 1, span: L, rootChord: 0.02, tipChord: 0.02, incidenceDeg: 0, sections: 24, induced: 'none',
        airfoil: { cl0: 0, clMax: 1, cd0: 0.01, thickness: 0.1 } },
    };
    const sim = new Sim(RAPIER, spec0([rod], [{ id: 'hinge', type: 'revolute', parent: 'body', child: 'rod', axis: [1, 0, 0] }]), { aero: false });
    sim.lockRoot('fixed');
    const rb = sim.partById.get('rod')!.b.rb;
    const angle = () => 2 * Math.atan2(rb.rotation().x, rb.rotation().w);
    const returns: number[] = [];
    let wMax = 0;
    let prevW = 0;
    let minAngle = Infinity;
    const K = 1.8540746773;
    const T = 4 * K * Math.sqrt((2 * L) / (3 * G));
    sim.advance(3.3 * T, () => {
      const w = rb.angvel().x;
      wMax = Math.max(wMax, Math.abs(w));
      // Возврат в исходную сторону: угловая скорость меняет знак с «назад» на «вперёд».
      if (prevW < 0 && w >= 0 && sim.t > 0.5 * T) {
        returns.push(sim.t);
        minAngle = angle();
      }
      prevW = w;
    });
    const period = returns.length >= 3 ? (returns[2] - returns[0]) / 2 : NaN;
    report('период колебаний (размах 90°)', period, T, 0.02, ' с');
    report('угловая скорость в нижней точке √(3g/L)', wMax, Math.sqrt((3 * G) / L), 0.02, ' рад/с');
    // Потеря высоты центра масс за три периода, в долях начальной: sin(угол недолёта).
    const loss = Math.abs(Math.sin(minAngle));
    // Числовое затухание схемы интегрирования — около 0,7 % за период при шаге 1/240 с.
    flag('энергия сохраняется: за три периода потеряно меньше 3 %', loss < 0.03, `${(loss * 100).toFixed(2)} %`);
    sim.free();
  }

  // ---------- сохранение импульса ----------
  section('Сохранение импульса: махолёт в пустоте');
  {
    // Без воздуха и тяжести внутренние силы приводов не могут сдвинуть центр масс.
    const spec = applyAssumptions(ornithopter);
    const sim = new Sim(RAPIER, spec, { aero: false, gravity: false, breakable: false });
    const a = momentum(sim);
    let pMax = 0;
    let vWing = 0;
    let stroke = 0;
    const wing = sim.partById.get('R1')!;
    const y0 = sim.root.b.rb.translation().y;
    sim.advance(3.5, () => {
      pMax = Math.max(pMax, len(momentum(sim).p));
      vWing = Math.max(vWing, len(copy(wing.b.rb.linvel())));
      stroke = Math.max(stroke, Math.abs(sim.root.b.rb.translation().y - y0));
    });
    const b = momentum(sim);
    const drift = len(sub(b.com, a.com));
    // Масштаб: корпус в противофазе с крыльями ходит на ±stroke; импульс одного крыла на взмахе.
    // Движок считает с одинарной точностью, поэтому за тысячи шагов набегает ошибка округления:
    // с уменьшением шага она растёт, а не падает, — это не ошибка интегрирования.
    const pScale = wing.b.rb.mass() * vWing;
    flag('центр масс стоит на месте: уход меньше 2 % от хода корпуса', drift < 0.02 * stroke, `${(drift * 1000).toFixed(1)} мм при ходе корпуса ±${(stroke * 1000).toFixed(0)} мм, масса ${a.mass.toFixed(0)} кг`);
    flag('суммарный импульс остаётся нулём (меньше 0,1 % импульса одного крыла)', pMax < 1e-3 * pScale, `${pMax.toExponential(2)} из ${pScale.toExponential(2)} кг·м/с`);
    sim.free();
  }

  // ---------- центробежная сила лопасти ----------
  section('Вращающаяся лопасть: центробежная сила в корне');
  {
    const span = 3;
    const R0 = 0.3;
    const rpm = 300;
    const blade = (id: string, z: number, rot: number): Spec['parts'][number] => ({
      id, kind: 'blade', position: [0, 100, z], rotation: [0, rot, 0], mass: 8,
      aero: { side: 1, span, rootChord: 0.2, tipChord: 0.2, incidenceDeg: 0, sections: 16, airfoil: { cl0: 0, clMax: 1.4, cd0: 0.01, thickness: 0.12 } },
    });
    const s = spec0(
      [{ id: 'hub', kind: 'hub', position: [0, 100, 0], shape: { type: 'cylinder', size: [0.3, 0.2, 0.3] }, mass: 5 }, blade('b1', R0, 0), blade('b2', -R0, 180)],
      [{ id: 'mast', type: 'revolute', parent: 'body', child: 'hub', axis: [0, 1, 0] }, { id: 'f1', type: 'fixed', parent: 'hub', child: 'b1' }, { id: 'f2', type: 'fixed', parent: 'hub', child: 'b2' }],
      [{ id: 'rotor', type: 'spinner', joint: 'mast', rpm, direction: 1, rampTime: 1 }],
    );
    s.meta.class = 'rotor';
    const sim = new Sim(RAPIER, s, { aero: false, gravity: false });
    sim.lockRoot('fixed');
    sim.advance(1.5);
    const b1 = sim.partById.get('b1')!;
    const j = b1.joint!;
    let F = 0;
    let n = 0;
    sim.advance(0.5, () => {
      F += len(j.force);
      n++;
    });
    const om = (rpm * 2 * Math.PI) / 60;
    const firstMoment = b1.elements.reduce((acc, e) => acc + e.mass * (R0 + Math.abs(e.r.z)), 0);
    report('сила в корне лопасти ω²·Σm·r', F / n, om * om * firstMoment, 0.02, ' Н');
    sim.free();
  }

  // ---------- тяга и энергия машущего крыла ----------
  section('Машущее крыло в потоке: тяга и баланс энергии (квазистационарный предел)');
  {
    // Крыло качается на шарнире в ровном потоке U. Профиль без сопротивления и срыва,
    // без индуктивного скоса. Местная скорость взмаха w = r·θ₀·ω·cos ωt. Подъёмная сила
    // перпендикулярна местному потоку, поэтому наклоняется вперёд на ходе вниз и вверх:
    //   средняя тяга  T = ¼·ρ·c·a·θ₀²·ω²·∫r²dr   (то же даёт формула Гаррика при F = 1, G = 0),
    //   средняя мощность на валу P = T·U (в этом пределе вся работа уходит в тягу).
    const U = 20;
    const R = 2;
    const c = 0.3;
    const a = 2 * Math.PI * 0.9;
    const th0 = 5 * deg;
    const f = 2;
    const om = 2 * Math.PI * f;
    const wing: Spec['parts'][number] = {
      id: 'w', kind: 'wing', position: [0, 100, 0], mass: 2,
      aero: { side: 1, span: R, rootChord: c, tipChord: c, incidenceDeg: 0, sections: 20, induced: 'none',
        airfoil: { cl0: 0, clAlpha: a, clMax: 1.5, cd0: 0.01, k: 0, thickness: 0.1 } },
    };
    const s = spec0([wing], [{ id: 'hinge', type: 'revolute', parent: 'body', child: 'w', axis: [1, 0, 0] }],
      [{ id: 'flap', type: 'oscillator', freqHz: f, amplitudeDeg: 5, rampTime: 0, joints: [{ joint: 'hinge', sign: 1 }] }]);
    s.meta.class = 'flapping';
    const sim = new Sim(RAPIER, s, { wind: v3(-U, 0, 0), gravity: false, breakable: false });
    sim.lockRoot('fixed');
    const w = sim.partById.get('w')!;
    ideal(sim, 'w');
    const j = w.joint!;
    sim.advance(1 / f); // первый цикл — переходный
    let Fx = 0;
    let Fy = 0;
    let P = 0;
    let n = 0;
    sim.advance(3 / f, () => {
      Fx += w.aeroForce.x;
      Fy += w.aeroForce.y;
      P += j.shaftPower;
      n++;
    });
    Fx /= n;
    Fy /= n;
    P /= n;
    const T = 0.25 * RHO * c * a * th0 * th0 * om * om * (R ** 3 / 3);
    // Привод по скорости отрабатывает амплитуду с недобором около 1 % при 120 шагах на цикл
    // (уходит с уменьшением шага), тяга пропорциональна квадрату амплитуды — отсюда допуск 3 %.
    report('средняя тяга ¼·ρ·c·a·θ₀²·ω²·R³/3', Fx, T, 0.03, ' Н');
    report('средняя мощность на валу = тяга × скорость потока', P, Fx * U, 0.02, ' Вт');
    flag('средняя подъёмная сила симметричного взмаха — ноль', Math.abs(Fy) < 0.02 * T, `${Fy.toFixed(3)} Н при тяге ${Fx.toFixed(2)} Н`);
    sim.free();
  }
  {
    // То же крыло неподвижно под углом: никакой тяги, только подъёмная сила — и нулевая мощность.
    const U = 20;
    const wing: Spec['parts'][number] = {
      id: 'w', kind: 'wing', position: [0, 100, 0], mass: 2,
      aero: { side: 1, span: 2, rootChord: 0.3, tipChord: 0.3, incidenceDeg: 4, sections: 20, induced: 'none',
        airfoil: { cl0: 0, clAlpha: 2 * Math.PI * 0.9, clMax: 1.5, cd0: 0.01, k: 0, thickness: 0.1 } },
    };
    const sim = new Sim(RAPIER, spec0([wing], [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }]), { wind: v3(-U, 0, 0), gravity: false });
    sim.lockRoot('fixed');
    ideal(sim, 'w');
    sim.advance(0.2);
    const w = sim.partById.get('w')!;
    const Lift = 0.5 * RHO * U * U * 0.6 * 2 * Math.PI * 0.9 * 4 * deg;
    report('неподвижное крыло под углом 4°: подъёмная сила', w.aeroForce.y, Lift, 0.02, ' Н');
    flag('у неподвижного крыла без сопротивления нет ни тяги, ни сопротивления (парадокс Даламбера)', Math.abs(w.aeroForce.x) < 1e-6 * Lift, `${w.aeroForce.x.toExponential(2)} Н`);
    sim.free();
  }

  // ---------- симметрия ----------
  section('Симметрия: у симметричного аппарата нет боковой силы');
  {
    const sim = new Sim(RAPIER, applyAssumptions(ornithopter), { breakable: false });
    sim.lockRoot('fixed');
    let side = 0;
    let total = 0;
    sim.advance(3.2, () => {
      if (sim.t < 3) return;
      side = Math.max(side, Math.abs(sim.sample.aeroForce.z));
      total = Math.max(total, len(sim.sample.aeroForce));
    });
    flag('орнитоптер: боковая сила меньше миллионной доли полной', side < 1e-6 * total, `${side.toExponential(2)} Н из ${total.toExponential(2)} Н`);
    // Моменты на левых и правых шарнирах равны и противоположны.
    const jl = sim.partById.get('L1')!.joint!;
    const jr = sim.partById.get('R1')!.joint!;
    const ml = jl.moment.x, mr = jr.moment.x;
    flag('моменты в левом и правом шарнирах зеркальны', Math.abs(ml + mr) < 1e-6 * Math.abs(ml), `${ml.toExponential(4)} и ${mr.toExponential(4)} Н·м`);
    sim.free();
  }

  // ---------- сходимость по шагу ----------
  section('Сходимость по шагу: вдвое меньший шаг не меняет результат');
  {
    const run = (spec: Spec, id: ProgramId, o: ProgramOptions) => {
      const pr = new ProgramRun(RAPIER, spec, id, o);
      const r = pr.runToEnd();
      pr.free();
      return r;
    };
    const o1 = run(applyAssumptions(ornithopter), 'tethered', { breakable: false });
    const o2 = run(applyAssumptions(ornithopter), 'tethered', { breakable: false, stepScale: 2 });
    report('орнитоптер: запас прочности', o2.minMargin, o1.minMargin, 0.03);
    report('орнитоптер: средняя мощность', o2.powerMean, o1.powerMean, 0.03, ' Вт');
    report('орнитоптер: подъёмная сила / вес (макс)', o2.liftToWeightMax, o1.liftToWeightMax, 0.03);
    const h1 = run(applyAssumptions(r22), 'hover', {});
    const h2 = run(applyAssumptions(r22), 'hover', { stepScale: 2 });
    report('R22: мощность висения', h2.hover?.power ?? NaN, h1.hover?.power ?? NaN, 0.03, ' Вт');
    report('R22: запас прочности', h2.minMargin, h1.minMargin, 0.05);
    const c1 = run(applyAssumptions(cessna172), 'flight', {});
    const c2 = run(applyAssumptions(cessna172), 'flight', { stepScale: 2 });
    report('Cessna: скорость сваливания', c2.flight?.vStall ?? NaN, c1.flight?.vStall ?? NaN, 0.02, ' м/с');
    report('Cessna: максимальная скорость', c2.flight?.vMax ?? NaN, c1.flight?.vMax ?? NaN, 0.02, ' м/с');
    report('Cessna: запас прочности', c2.minMargin, c1.minMargin, 0.03);
  }
  void cross;
}

// Запуск отдельно.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('src/cli/physics.ts')) {
  const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
  await RAPIER.init();
  const { rep, n, summary } = makeReporter();
  const a = process.argv;
  if (a.includes('--validate')) {
    const { validationChecks } = await import('./validation.ts');
    validationChecks(RAPIER, rep);
  } else {
    const which = a.includes('--unsteady') ? unsteadyChecks : a.includes('--strength') ? strengthChecks : a.includes('--audit') ? auditChecks : physicsChecks;
    which(RAPIER, rep);
  }
  console.log(summary('проверок физики'));
  process.exit(n.failed ? 1 : 0);
}
