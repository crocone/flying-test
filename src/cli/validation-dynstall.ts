// Сверка динамического срыва с измеренными петлями NACA 0012 (шестая проверка физики, 2026-11-12).
// Входит в npm run physics -- --validate (раздел dynstall) и в npm run check.
//
// Эталон — McAlister, Pucci, McCroskey, Carr, NASA TM-84245 (1982), т. 2: профиль NACA 0012 качается вокруг ¼ хорды,
// α = a0 + a1·sin ωt, силы — интегралы давления. Данные и происхождение каждого числа — src/cli/dynamic-stall-data.ts
// и data/research.md, раздел 4.7.
//
// Модель — то же крыло, что в стенде: деталь Sim с нестационарным обтеканием (функция Вагнера, присоединённая масса,
// запаздывание срыва и вихрь по Беддоузу — Лейшману, src/core/aero.ts), большое удлинение без индуктивного скоса
// (двумерное сечение); угол задаётся каналом pitch каждый шаг, как в опыте. Скорость потока — по числу Маха опыта.
//
// Статическая поляра модели — не из этого опыта (там статика NACA 0012 снята только при M 0,3) и под петли не подбиралась:
// - M 0,3, Re 3,6·10⁶: c_l,max 1,39 — статика того же опыта (кадры 4019 и 11018: 1,40 и 1,38), наклон 0,105 на градус
//   (Ladson, NASA TM-4074, M 0,15; модель сама добавляет Прандтля — Глауэрта);
// - M 0,035, Re 0,5·10⁶: c_l,max 1,00 — Critzos et al., NACA TN 3361, Re 0,5·10⁶ (у Jacobs & Sherman при 0,45·10⁶ — 0,89);
// - M 0,072, Re 1,0·10⁶: c_l,max 1,19 — Loftin & Smith, NACA TN 1945, Re 1·10⁶ (по каталогу Miley);
// - при малых Re наклон 0,10 на градус (0,098 у Jacobs & Sherman, 0,103 у TN 3361), c_d0 0,008, k 0,005.
// Постоянные срыва — опубликованные для NACA 0012 (src/core/aero.ts, DYNAMIC_STALL), под эти петли не подбирались.
//
// Допуск. Точность опыта по C_L,max — ±0,03 при M 0,3 и растёт с уменьшением M «примерно в 5 раз» к M 0,035 (т. 1, с. 13:
// давление на малых скоростях мало); поправка на стенки трубы в данных т. 2 не сделана (около 1,5 % по C_L); оцифровка ±0,015.
// Статическая поляра при малых Re взята из других труб (c_l,max ±10 %; по прогону модели это ±3–4 % по C_L,max петли).
// Итого: 6 % при M 0,3, 8 % при M 0,07, 10 % при M 0,035.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Reporter } from './physics.ts';
import type { Airfoil, Spec } from '../core/spec.ts';
import { DYNAMIC_STALL } from '../core/aero.ts';
import { Sim } from '../core/sim.ts';
import { v3 } from '../core/vec.ts';
import { MCALISTER_0012, type DynStallFrame } from './dynamic-stall-data.ts';

const deg = Math.PI / 180;

/** Профиль качается: a0 + a1·sin ωt (градусы) при приведённой частоте k и числе Маха; C_L и C_D за пятый цикл. */
export function pitchLoop(RAPIER: typeof RAPIER_NS, af: Airfoil, a0: number, a1: number, k: number, mach: number) {
  const c = 1, span = 2, U = mach * 340.3;
  const om = (2 * k * U) / c;
  const spec: Spec = {
    schema: 1, meta: { name: 'NACA 0012 на качании', class: 'fixed-wing', source: 'preset' },
    environment: { name: 'труба', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
    parts: [{ id: 'body', kind: 'body', position: [0, 100, 0], shape: { type: 'box', size: [1, 1, 1] }, mass: 100 },
      { id: 'w', kind: 'wing', position: [0, 100, 0], mass: 2,
        aero: { side: 1, span, rootChord: c, tipChord: c, incidenceDeg: 0, sections: 4, induced: 'none', unsteady: true, addedMass: true, airfoil: af, control: { channel: 'pitch', deg: 1 } } }],
    joints: [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }], actuators: [], powerplant: { power: 1e6 }, crew: { part: 'body', seats: [[0, 0, 0]], unmanned: true }, assumptions: [],
  };
  const sim = new Sim(RAPIER, spec, { wind: v3(-U, 0, 0), gravity: false, breakable: false });
  sim.lockRoot('fixed');
  const w = sim.partById.get('w')!;
  const qS = 0.5 * 1.225 * U * U * c * span;
  const T = (2 * Math.PI) / om;
  const t0 = sim.t;
  const ang = () => a0 + a1 * Math.sin(om * (sim.t - t0));
  sim.channels.pitch = ang();
  sim.advance(4 * T, () => { sim.channels.pitch = ang(); });
  const out: { wt: number; cl: number; cd: number }[] = [];
  sim.advance(T, () => {
    sim.channels.pitch = ang();
    out.push({ wt: (((om * (sim.t - t0)) / deg) % 360 + 360) % 360, cl: w.aeroForce.y / qS, cd: -w.aeroForce.x / qS });
  });
  sim.free();
  return out;
}

const staticPolar = (f: DynStallFrame): Airfoil => {
  const [clMax, slope] = f.mach > 0.2 ? [1.39, 0.105] : f.re < 0.7e6 ? [1.0, 0.1] : [1.19, 0.1];
  return { name: 'NACA 0012', cl0: 0, clAlpha: slope / deg, clMax, cd0: 0.008, k: 0.005, thickness: 0.12 };
};

/** Сравнение петли модели с опытом: наибольший C_L и его угол, средние за цикл C_L, C_D, C_N, СКО C_L по циклу. */
function compare(RAPIER: typeof RAPIER_NS, f: DynStallFrame, af: Airfoil) {
  const m = pitchLoop(RAPIER, af, f.a0, f.a1, f.k, f.mach);
  const alpha = (wt: number) => (f.a0 + f.a1 * Math.sin(wt * deg)) * deg;
  const near = (wt: number) => m.reduce((b, p) => (Math.abs(((p.wt - wt + 540) % 360) - 180) < Math.abs(((b.wt - wt + 540) % 360) - 180) ? p : b));
  let clMax = -Infinity, aMax = 0;
  for (const p of m) if (p.cl > clMax) { clMax = p.cl; aMax = alpha(p.wt) / deg; }
  const n = f.cl.length;
  let mCl = 0, eCl = 0, mCd = 0, eCd = 0, mCn = 0, eCn = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const wt = i * 5, a = alpha(wt), p = near(wt);
    mCl += p.cl / n; eCl += f.cl[i] / n; mCd += p.cd / n; eCd += f.cd[i] / n;
    mCn += (p.cl * Math.cos(a) + p.cd * Math.sin(a)) / n; eCn += (f.cl[i] * Math.cos(a) + f.cd[i] * Math.sin(a)) / n;
    sq += (p.cl - f.cl[i]) ** 2 / n;
  }
  return { clMax, aMax, mCl, eCl, mCd, eCd, mCn, eCn, rms: Math.sqrt(sq) };
}

export function dynamicStallLoops(RAPIER: typeof RAPIER_NS, { section, diverge, info, flag }: Reporter) {
  section('Динамический срыв NACA 0012 против измеренных петель (McAlister et al., NASA TM-84245)');
  const tol = (f: DynStallFrame) => (f.mach > 0.2 ? 0.06 : f.mach > 0.05 ? 0.08 : 0.1);
  const fmt = (x: number) => String(x).replace('.', ',');
  const why = (f: DynStallFrame, over: boolean) => (over
    ? 'модель завышает силу на обратном ходе: в опыте после срыва обтекание восстанавливается медленнее, чем за Tf = 3 полухорды (в полной схеме и в OpenFAST '
      + 'Tf на восстановлении увеличивают вдвое-вчетверо; здесь эти поправки по стадиям цикла не введены)'
    : f.mach > 0.2
      ? 'за срывом нормальная сила в модели падает к пластине Хёрнера быстрее, чем у профиля в опыте; вихрь (Беддоуз — Лейшман) возмещает лишь часть потери, '
        + 'а вторичные вихри (второй пик C_L в опыте) почти не набирают силы: приращения C_V к тому времени малы'
      : 'при Re 0,5–1·10⁶ статический срыв NACA 0012 ранний (c_l,max 1,0–1,2: лопается ламинарный пузырь у носка), а при качании профиль держит безотрывное '
        + 'обтекание до 18–20°, как при Re 3,6·10⁶. Модель начинает срыв от статического угла; вихрь возмещает лишь часть потери (см. справочную строку в конце раздела)');
  const saved = DYNAMIC_STALL.vortex;
  let errOn = 0, errOff = 0, rmsOn = 0, rmsOff = 0;
  for (const f of MCALISTER_0012) {
    const af = staticPolar(f);
    DYNAMIC_STALL.vortex = false;
    const off = compare(RAPIER, f, af);
    DYNAMIC_STALL.vortex = saved;
    const on = compare(RAPIER, f, af);
    errOn += Math.abs(on.clMax / f.clMax - 1); errOff += Math.abs(off.clMax / f.clMax - 1);
    rmsOn += on.rms; rmsOff += off.rms;
    const head = `кадр ${f.frame}: α = ${fmt(f.a0)}° + ${fmt(f.a1)}°·sin ωt, k ${fmt(f.k)}, M ${fmt(f.mach)}, Re ${fmt(+(f.re / 1e6).toFixed(2))}·10⁶`;
    diverge(`${head} — наибольший C_L ${fmt(f.clMax)} на ${fmt(f.aClMax)}° (с. ${f.page})`, on.clMax, f.clMax, tol(f), why(f, on.clMax > f.clMax), '');
    diverge(`${head} — средняя за цикл нормальная сила C_N`, on.mCn, on.eCn, tol(f), why(f, on.mCn > on.eCn), '');
    info(`кадр ${f.frame}: угол наибольшего C_L ${on.aMax.toFixed(1)}° (опыт ${f.aClMax}°); среднее C_L ${on.mCl.toFixed(3)} (опыт ${on.eCl.toFixed(3)}), `
      + `среднее C_D ${on.mCd.toFixed(3)} (опыт, только давление, ${on.eCd.toFixed(3)}); СКО C_L по циклу ${on.rms.toFixed(3)}. Без вихря: C_L,max ${off.clMax.toFixed(2)}, `
      + `среднее C_N ${off.mCn.toFixed(3)}, СКО ${off.rms.toFixed(3)}`);
  }
  const N = MCALISTER_0012.length;
  flag(`вихрь динамического срыва приближает модель к опыту: средняя ошибка C_L,max и СКО C_L по ${N} петлям меньше, чем без вихря`,
    errOn < errOff && rmsOn < rmsOff,
    `ошибка C_L,max ${(100 * errOn / N).toFixed(1)} % против ${(100 * errOff / N).toFixed(1)} % без вихря; СКО ${(rmsOn / N).toFixed(3)} против ${(rmsOff / N).toFixed(3)}`);
  // Справочно: те же петли малых Re со статикой высокого Re (c_l,max 1,39). Не проверка и не подбор — показывает, какая часть
  // расхождения при малых Re идёт от раннего статического срыва, а какая — от самой схемы.
  let d1 = 0, d2 = 0, k = 0;
  for (const f of MCALISTER_0012.filter((x) => x.mach < 0.2)) {
    const r = compare(RAPIER, f, { ...staticPolar(f), clMax: 1.39, clAlpha: 0.105 / deg });
    d1 += r.clMax / f.clMax - 1; d2 += r.mCn / r.eCn - 1; k++;
  }
  info(`петли M 0,035–0,07 со статикой Re 3,6·10⁶ (c_l,max 1,39 вместо 1,0–1,19): C_L,max модели в среднем ${(100 * d1 / k).toFixed(1)} % от опыта, `
    + `средняя C_N ${(100 * d2 / k).toFixed(1)} % (с опытной статикой этих Re — в проверках выше)`);
}
