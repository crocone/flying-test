// Сверка модели с реальными измерениями (пятая проверка физики, 2026-11-12).
// Запуск отдельно: npm run physics -- --validate. Входит в npm run check.
//
// Правила этого файла:
// - эталон — измерение (продувка, лётные или стендовые испытания, таблица руководства), а не формула;
//   источник каждого числа — в data/research.md (раздел «Пятая проверка: реальные измерения»);
// - параметры модели под эти эталоны не подбирались; где параметр модели — оценка, это сказано;
// - допуск = погрешность эталона + известные упрощения модели; бюджет расписан у каждой проверки.
//   Не попавшее в допуск печатается как «РАСХОЖДЕНИЕ» с причиной (Reporter.diverge), а не прячется.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Reporter } from './physics.ts';
import type { Airfoil, Spec } from '../core/spec.ts';
import { applyAssumptions } from '../core/spec.ts';
import { airfoilCoeffs, atmosphere, dragDivergenceMach, DYNAMIC_STALL, rotorGroundFactor, wingGroundFactor } from '../core/aero.ts';
const groundFns = { rotorGroundFactor, wingGroundFactor };
import { activityFactor, propellerEquilibrium, propellerLoads, type FixedPitchGeometry } from '../core/propeller.ts';
import { ProgramRun, type ProgramId, type ProgramOptions } from '../core/programs.ts';
import { Sim } from '../core/sim.ts';
import { cessna172 } from '../presets/cessna172.ts';
import { r22 } from '../presets/r22.ts';
import { quadcopter } from '../presets/quadcopter.ts';
import { smartbird, snowbird } from '../presets/flappers.ts';
import { copy, unrotate, v3 } from '../core/vec.ts';
import { COAXIAL_INTERFERENCE } from '../core/design.ts';
import { dynamicStallLoops } from './validation-dynstall.ts';
import { NACA0012, NACA0015 } from '../core/polar-data.ts';
import { availablePower, batteryEnergy, endurance, fuelFlow, humanPower, type EngineSpec } from '../core/engine.ts';
import { airborne, extrema, oscillation, Pilot, tunnelCoefficients, trimLevel } from './flightdyn.ts';
import { heliTrim } from './rotorflight.ts';
import { CrewLoad, toleranceLimit } from '../core/crew.ts';
import { flutterAnalysis } from '../core/aeroelastic.ts';
import { laminateProps, type Layup } from '../core/laminate.ts';
import type { Material } from '../core/materials.ts';

const KT = 0.514444;
const FT = 0.3048;
const HP = 745.7;
const FPM = 0.00508;
const deg = Math.PI / 180;
const KINT = COAXIAL_INTERFERENCE; // та же величина, что ставит сборщик соосных вертолётов

const run = (RAPIER: typeof RAPIER_NS, spec: Spec, id: ProgramId, o: ProgramOptions = {}) => {
  const pr = new ProgramRun(RAPIER, spec, id, o);
  const r = pr.runToEnd();
  pr.free();
  return r;
};

export function validationChecks(RAPIER: typeof RAPIER_NS, rep: Reporter) {
  // VALIDATE_ONLY=rotors,r22 — только эти разделы (для отладки; без переменной — все).
  const only = (process.env.VALIDATE_ONLY ?? '').split(',').filter(Boolean);
  const on = (k: string) => !only.length || only.includes(k);
  if (on('airfoils')) airfoilFullCircle(rep);
  if (on('airfoils')) presetAirfoils(rep);
  if (on('airfoils')) airfoilCompressibility(rep);
  if (on('cessna')) cessnaPoh(RAPIER, rep);
  if (on('rotors')) rotorRigs(RAPIER, rep);
  if (on('r22')) r22Poh(RAPIER, rep);
  if (on('props')) props(RAPIER, rep);
  if (on('dynstall')) dynamicStallLoops(RAPIER, rep);
  if (on('flappers')) flappers(RAPIER, rep);
  if (on('ground')) groundEffect(RAPIER, rep);
  if (on('download')) download(RAPIER, rep);
  if (on('engines')) engines(RAPIER, rep);
  if (on('sixdof')) sixdof(RAPIER, rep);
  if (on('heli')) heli(RAPIER, rep);
  if (on('structure')) structureChecks(RAPIER, rep);
  if (on('human')) humanChecks(rep);
  if (on('stress')) stressChecks(RAPIER, rep);
  if (on('helistress')) heliStressChecks(RAPIER, rep);
}

// ---------- 16. Стресс-тесты R22 в свободном полёте (нормы FAR 27) против POH и бюллетеней Robinson ----------
function heliStressChecks(RAPIER: typeof RAPIER_NS, { section, flag, info }: Reporter) {
  section('R22 в свободном полёте: стресс-тесты (программа «Стресс-тесты») против POH и бюллетеней Robinson');
  const t0 = Date.now();
  const r = run(RAPIER, applyAssumptions(r22), 'stress', { breakable: false });
  const st = (id: string) => r.stress?.find((s) => s.id === id);
  const val = (id: string, key: string) => st(id)?.values.find(([k]) => k.startsWith(key))?.[1] ?? '';
  const num = (s: string) => parseFloat(s.replace(/[\s   ]/g, '').replace(',', '.').replace('−', '-'));
  info(`шагов ${r.stress?.length ?? 0}; ${((Date.now() - t0) / 1000).toFixed(0)} с счёта, ${r.simTime.toFixed(0)} с полёта`);
  for (const s of r.stress ?? []) info(`${s.pass === null ? '—' : s.pass ? 'да ' : 'НЕТ'} ${s.name}: ${s.values.map(([k, x]) => `${k} ${x}`).join('; ')}`);
  // Сертифицированный вертолёт: висит вне влияния земли на 600 м при наибольшей массе (POH: потолок висения вне влияния
  // земли при 1370 lb — несколько тысяч футов), с запасом педалей.
  flag('висение вне влияния земли на 600 м при 1370 lb: мощности и педалей хватает (POH, разд. 5)', st('hHover')?.pass === true, val('hHover', 'Мощность') + '; ' + val('hHover', 'Педали'));
  flag('отказ двигателя на 0,9·VNE с задержкой 1 с: установившиеся обороты 90–110 % (§27.143(e), POH)', st('hPowerFail')?.pass === true, val('hPowerFail', 'Обороты на установившейся'));
  const sink = num(val('hPowerFail', 'Установившееся снижение').split('(')[1] ?? 'NaN');
  flag('авторотация на 65 узлах: снижение меньше 1500 ft/min (Robinson SN-38)', sink < 1500, `${sink.toFixed(0)} ft/min`);
  flag('малая перегрузка: вертолёт кренится вправо (POH R22, SN-11)', /вправо/.test(val('hLowG', 'Крен')), val('hLowG', 'Крен'));
  flag('на 1,1·VNE остаётся запас ручки вперёд (§27.175; вертолёт сертифицирован)', st('hVne')?.pass === true, val('hVne', 'Запас ручки'));
  info('прочность лопастей в полёте вперёд — справочно (эквивалентный лонжерон, подвеска втулки не опубликована); перегрузки ручкой, порывы и педали — замеры без критерия: измерений R22 нет');
}

// ---------- 15. Стресс-тесты Cessna 172S по нормам FAR 23 против POH и самих норм ----------
function stressChecks(RAPIER: typeof RAPIER_NS, { section, flag, diverge, info }: Reporter) {
  section('Cessna 172S: стресс-тесты по нормам FAR 23 (программа «Стресс-тесты») против POH, рис. 5-3, и норм');
  const t0 = Date.now();
  const r = run(RAPIER, applyAssumptions(cessna172), 'stress', { breakable: false });
  const st = (id: string) => r.stress?.find((s) => s.id === id);
  const val = (id: string, key: string) => {
    const v = st(id)?.values.find(([k]) => k.startsWith(key))?.[1] ?? '';
    return parseFloat(v.replace(/[\s   ]/g, '').replace(',', '.').replace('−', '-'));
  };
  info(`шагов ${r.stress?.length ?? 0}, пройдено ${r.stress?.filter((s) => s.pass).length ?? 0}; ${((Date.now() - t0) / 1000).toFixed(0)} с счёта, ${r.simTime.toFixed(0)} с полёта`);
  for (const s of r.stress ?? []) info(`${s.pass === null ? '—' : s.pass ? 'да ' : 'НЕТ'} ${s.name}: ${s.values.map(([k, x]) => `${k} ${x}`).join('; ')}${s.note ? ' — ' + s.note : ''}`);
  // POH рис. 5-3 (2550 lb, газ убран, закрылки убраны): 0° — 53 KCAS, 30° — 57 KCAS; «потеря высоты при выводе — до 230 ft».
  // Допуск 5 %: в POH скорости округлены до узла, торможение «около 1 узла в секунду»; срыв в программе — по доле
  // сорванных сечений крыла (30 %), в сертификации — по клевку носом или упору ручки.
  const why = 'срыв в программе определяется по доле сорванных сечений крыла, а не по клевку носом; торможение 1 узел/с держит автопилот';
  diverge('сваливание с прямой, газ убран: скорость (POH: 53 KCAS)', val('stall', 'Скорость сваливания'), 53, 0.05, why, ' kt');
  diverge('сваливание в развороте 30°: скорость (POH: 57 KCAS)', val('turnStall', 'Скорость сваливания'), 57, 0.05, why, ' kt');
  const hLoss = val('stall', 'Потеря высоты');
  flag('потеря высоты при выводе из сваливания не больше 230 ft = 70 м (POH, рис. 5-3)', hLoss <= 70, `${hLoss.toFixed(0)} м`);
  flag('сваливания в развороте: крен после срыва в пределах §23.203 (самолёт сертифицирован)', !!st('turnStall')?.pass && !!st('accStall')?.pass,
    `${st('turnStall')?.values[1]?.[1]}; ${st('accStall')?.values[1]?.[1]}`);
  const rpm = val('dive', 'Обороты винта');
  flag('пикирование до VD с убранным газом: обороты не выше 110 % номинальных — 2970 об/мин (§23.33(b)(2), самолёт сертифицирован)', rpm <= 2970, `${rpm.toFixed(0)} об/мин`);
  info(`порывы ±50 ft/s на VC: в модели ${val('gustUp', 'Перегрузка в модели')} и ${val('gustDown', 'Перегрузка в модели')}, по формуле норм (§23.341) ${val('gustUp', 'По формуле')} и ${val('gustDown', 'По формуле')}. `
    + 'Формула норм — расчётная: коэффициент ослабления порыва K_g получен по самолётам 1950-х для одного поступательного движения; в модели самолёт входит в порыв носом и ещё поворачивается по тангажу');
  info('запасы прочности в стресс-тестах — у эквивалентного консольного лонжерона (стенка — оценка, подкос на прочность не влияет): это не проверка конструкции настоящего самолёта');
  if (st('spin')?.pass === null) info('штопор: модель по полосам крыла в штопор не входит — нужны данные продувок на вращающемся стенде (rotary balance), их в модели нет');
}

// ---------- 14. Человек: мощность по длительности (и переносимость перегрузок) против измерений ----------
function humanChecks({ section, flag, diverge, info }: Reporter) {
  section('Перегрузки экипажа: модель Брикли против опытов на ракетных тележках (Стэпп; NASA SP-3006, табл. 4)');
  {
    // Профиль удара в источниках не записан: взята трапеция — нарастание с указанным темпом до пика, держится до конца
    // длительности, спадает так же (оценка формы). Кресло, ремни — как в опытах (не моделируются).
    const g = 9.81, dt = 1 / 2000;
    const run = (sign: number, peak: number, total: number, onset: number) => {
      const c = new CrewLoad(dt, g);
      const rise = peak / onset;
      for (let t = 0; t < total + rise + 0.5; t += dt) {
        const a = t < rise ? onset * t : t < total ? peak : Math.max(0, peak - onset * (t - total));
        c.push({ x: sign * a * g, y: g, z: 0 });
      }
      return c.r.dr;
    };
    const runs: [string, number, number, number, number, boolean][] = [
      ['−Gx 45 g, 0,09 с, 500 g/с — без шока', -1, 45, 0.09, 500, false],
      ['−Gx 38 g, 0,16 с, > 1300 g/с — тяжёлый шок', -1, 38, 0.16, 1300, true],
      ['−Gx 45 g, 0,23 с, 413 g/с — тяжёлые отсроченные последствия', -1, 45, 0.23, 413, true],
      ['−Gx 38,6 g, 0,12 с, 1370 g/с — тяжёлый шок', -1, 38.6, 0.12, 1370, true],
      ['+Gx 30 g, 0,11 с, 1065 g/с — перенесено', 1, 30, 0.11, 1065, false],
      ['+Gx 40,4 g, 0,04 с, 2139 g/с — тяжёлый шок, потеря сознания', 1, 40.4, 0.04, 2139, true],
      ['−Gx 25 g 1,1 с (пики 35–40), 600 g/с, Стэпп 10.12.1954 — кровоизлияния в глаза', -1, 25, 1.1, 600, true],
    ];
    let injuredAboveLow = true;
    for (const [nm, s, pk, T, on, hurt] of runs) {
      const d = run(s, pk, T, on);
      if (hurt && d.low < 1) injuredAboveLow = false;
      info(`${nm}: отклик DR ${d.value.toFixed(0)}; доля предела — низкого риска ${d.low.toFixed(2)}, среднего ${d.med.toFixed(2)}, высокого ${d.high.toFixed(2)}`);
    }
    flag('все опыты с травмой — выше предела низкого риска травмы по модели Брикли', injuredAboveLow);
    info('перенесённые без вреда удары (−Gx 45 g 0,09 с; +Gx 30 g 0,11 с) модель тоже относит к среднему риску: пределы NASA — для проектирования, '
      + 'с запасом, а у −Gx («глаза наружу») демпфирование модели 0,04 — отклик раскачивается сильно');
  }

  section('Перегрузки экипажа: переносимость +Gz против измерений на центрифуге');
  {
    // Модель: средняя переносимость здоровых людей (Chambers 1963, SP-3006, рис. 4-25). Эталон — выносливость лётчиков-
    // испытателей (Chambers & Hitchcock 1963, SP-3006, рис. 4-26, оцифровка ±5 %). Бюджет 10 %: оцифровка двух графиков.
    for (const [G, t] of [[9, 8], [8, 29], [6, 157]] as const)
      diverge(`+Gz ${G} g: лётчики-испытатели держали ${t} с (Chambers & Hitchcock 1963)`, toleranceLimit('+Gz', t), G, 0.1,
        'средняя кривая против отдельных лётчиков; оцифровка двух графиков', ' g');
    // Потеря сознания без защиты: модель — 5,4 g (Cochran 1954). Другие опыты — другие конечные точки (потеря
    // периферического или центрального зрения наступает раньше потери сознания), поэтому справочно.
    info('потеря сознания без защиты в модели — 5,4 ± 0,9 g (Cochran 1954, 935 человек); потеря центрального зрения — 5,3 ± 0,8 g '
      + '(Zarriello 1958, 30 человек); периферического — 4,89 ± 0,67 g (Kasture 2020, 39 мужчин, 0,1 g/с) и 5,1 ± 0,9 g (Chiang 2021, 92 лётчика); '
      + 'при быстром нарастании сознание теряют через 9,1 ± 2,4 с и не раньше 5 с (Whinnery & Forster 2013) — в модели средняя за 5 с');
  }

  section('Мощность человека по длительности: кривые NASA SP-3006 (модель) против независимых измерений');
  {
    // Модель — NASA SP-3006 (1973), рис. 18-15. Эталоны — другие работы:
    // - «здоровый человек»: Whitt & Wilson, Bicycling Science (1982), рис. в Evans «The Human Power Plant»;
    // - «чемпионы»: велосипедисты-профессионалы с измерителями мощности на педалях в гонках и тренировках —
    //   Pinot & Grappe 2014 (26 человек, 67 кг, средние рекорды сезона), Valenzuela 2022 (144 профессионала, медиана),
    //   Gallo 2022 (46 гонщиков WorldTour); Wilkie 1960 — чемпион-велосипедист (Nonweiler 1958).
    // Бюджет 10 %: оцифровка графика SP-3006 (около 2 %), разброс людей внутри группы (8–10 % от среднего), рекорды
    // сезона в поле против замеров на эргометре.
    const ww: [number, number][] = [[20, 622], [60, 398], [300, 297], [600, 283], [3600, 208]];
    for (const [t, P] of ww)
      diverge(`здоровый человек, ${t} с: ${P} Вт (Whitt & Wilson 1982)`, humanPower('healthy', t), P, 0.1, 'разные выборки «здоровых мужчин»', ' Вт');
    const pros: [string, number, number][] = [
      ['Pinot & Grappe 2014', 30, 865], ['Pinot & Grappe 2014', 60, 648], ['Pinot & Grappe 2014', 300, 443], ['Pinot & Grappe 2014', 600, 408], ['Pinot & Grappe 2014', 3600, 329],
      ['Valenzuela 2022', 60, 677], ['Valenzuela 2022', 300, 472], ['Valenzuela 2022', 3600, 350],
      ['Gallo 2022', 60, 591], ['Gallo 2022', 300, 434], ['Gallo 2022', 1200, 363], ['Gallo 2022', 2400, 330],
      ['Wilkie 1960, чемпион-велосипедист', 21, 891], ['Wilkie 1960, чемпион-велосипедист', 3552, 383],
    ];
    for (const [src, t, P] of pros)
      diverge(`чемпион, ${t} с: ${P} Вт (${src})`, humanPower('champion', t), P, 0.1,
        'кривая SP-3006 — 1960-е; у современных профессионалов на коротких усилиях (до 5 мин) мощность выше на 10–20 %: рекорды сезона в гонке, '
        + 'а не замер на эргометре', ' Вт');
    // Daedalus (Bussolari & Nadel 1989): пилоты-атлеты держали 3,1 Вт/кг 6 часов на эргометре (с питьём глюкозы).
    // Кривая SP-3006 кончается на 2,3 ч — 6 ч здесь продолжение; масса пилотов в источнике не указана.
    const p6 = humanPower('champion', 6 * 3600);
    info(`6 ч по продолжению кривой чемпионов — ${p6.toFixed(0)} Вт; Daedalus: 3,1 Вт/кг (при 70 кг — 217 Вт). Кривая за пределом данных — оценка`);
  }
}


// ---------- 13. Конструкция: флаттер крыла и ламинаты против измерений ----------
function structureChecks(RAPIER: typeof RAPIER_NS, { section, flag, diverge, info }: Reporter) {
  section('Cessna 172S: флаттер крыла с подкосом (кессон и подкос — оценки; сверка на правдоподобие)');
  {
    // Измерений нет: ни жёсткостей крыла, ни частот. Проверка — правдоподобие: самолёт сертифицирован, а нормы
    // (CS-23.629) требуют отсутствия флаттера до 1,2·V_D. V_NE = 163 KIAS (POH), V_NE ≤ 0,9·V_D → V_D ≥ 181 kt,
    // 1,2·V_D ≥ 217 kt ≈ 112 м/с (у земли). Разброс — по оценкам: обшивка 0,016–0,025 in, лонжероны ±5 % хорды,
    // подкос ±0,3 м.
    const variant = (mod: (s: NonNullable<Spec['parts'][number]['structure']>) => void) => {
      const spec = applyAssumptions(cessna172);
      for (const p of spec.parts) if (p.structure) { p.structure = structuredClone(p.structure); mod(p.structure); }
      if (!spec.parts.some((p) => p.structure?.strut)) spec.assumptions = spec.assumptions.filter((x) => !x.path.includes('.strut'));
      const sim = new Sim(RAPIER, spec, { aero: false });
      const r = sim.flutterInfo(sim.parts.find((p) => p.spec.id === 'wingR')!)!;
      sim.free();
      return r;
    };
    const base = variant(() => {});
    const vars = [
      variant((s) => (s.torsionBox = { ...s.torsionBox!, skin: 0.016 * 0.0254 })),
      variant((s) => (s.torsionBox = { ...s.torsionBox!, skin: 0.025 * 0.0254 })),
      variant((s) => (s.torsionBox = { ...s.torsionBox!, from: 0.15, to: 0.6 })),
      variant((s) => (s.torsionBox = { ...s.torsionBox!, from: 0.25, to: 0.7 })),
      variant((s) => (s.strut = { ...s.strut!, at: (2.3 - 0.05) / 5.45 })),
      variant((s) => (s.strut = { ...s.strut!, at: (2.9 - 0.05) / 5.45 })),
    ];
    const all = [base, ...vars];
    const vMin = Math.min(...all.map((r) => Math.min(r.vFlutter, r.vDivergence)));
    const fmt = (v: number) => (Number.isFinite(v) ? `${v.toFixed(0)} м/с` : 'нет до 270 м/с');
    info(`оценка: частоты форм ${base.modes.map((f) => f.toFixed(1)).join(' / ')} Гц; флаттер ${fmt(base.vFlutter)}, дивергенция ${fmt(base.vDivergence)}; `
      + `в пределах оценок: флаттер ${fmt(Math.min(...all.map((r) => r.vFlutter)))}, дивергенция от ${fmt(Math.min(...all.map((r) => r.vDivergence)))}`);
    flag('флаттера и дивергенции крыла нет до 1,2·V_D ≈ 112 м/с ни при одной оценке (самолёт сертифицирован)', vMin > 112, `наименьшая ${fmt(vMin)}`);
    const cant = variant((s) => (s.strut = undefined));
    info(`без подкоса (как консоль) — первая частота ${cant.modes[0].toFixed(1)} Гц против ${base.modes[0].toFixed(1)}, дивергенция ${fmt(cant.vDivergence)}: `
      + 'подкос сдерживает и прогиб, и закручивание. Флаттер элеронов (у настоящего самолёта они балансируются грузами) не считается');
  }

  section('Флаттер консольного крыла против продувки NACA TN 1594 (Runyan & Sewall, 1948)');
  {
    // Прямое крыло без сужения: хорда 0,2032 м, размах 1,2192 м, NACA 16-010, бальза с дюралевой вставкой. Измерено (статикой):
    // EI = 403,8 Н·м², GJ = 198,6 Н·м²; масса 1,2947 кг/м, момент инерции относительно упругой оси 3,559·10⁻³ кг·м²/м;
    // упругая ось на 43,7 % хорды, центр масс на 45,4 %. Частоты до продувки: изгиб 6,25–6,45 Гц, кручение 44,6–47,6 Гц.
    // Флаттер (табл. II): прогоны 96 и 60 — воздух, 34 — тоже воздух, 5 — фреон-12 (в 4 раза плотнее: другое отношение масс).
    const L = 1.2192, c = 0.2032, n = 40;
    const st = Array.from({ length: n }, (_, i) => ({ y: ((i + 0.5) * L) / n, dy: L / n, b: c / 2, a: 2 * 0.437 - 1, m: 1.2947,
      xa: (0.454 - 0.437) * c, Ia: 3.559e-3, EI: 403.8, GJ: 198.6 }));
    const r0 = flutterAnalysis(st, 1.077, 300);
    diverge('частота изгиба: 6,25–6,45 Гц (замер до продувок)', r0.fBending, 6.35, 0.03,
      'заделка в модели абсолютно жёсткая, у крыла в трубе — податливая (частота ниже)', ' Гц');
    diverge('частота кручения: 44,6–47,6 Гц', r0.fTorsion, 46.1, 0.04, 'заделка в модели абсолютно жёсткая', ' Гц');
    // Бюджет скорости 5 %: скорость в трубе ±1 %, разброс повторных прогонов (101,7 / 103,0 / 104,7 м/с) ±1,5 %, теория
    // по полосам без концевых потерь на удлинении 6 (несколько процентов), сжимаемость при M ≈ 0,3 (около 2 %).
    for (const [run, rho, V, f, M] of [[96, 1.077, 101.7, 22.1, 0.288], [60, 1.181, 103.0, 22.0, 0.302], [5, 4.255, 55.4, 25.2, 0.365]]) {
      const r = flutterAnalysis(st, rho, 300);
      diverge(`прогон ${run} (${run === 5 ? 'фреон-12' : 'воздух'}, ρ ${rho}, M ${M}): скорость флаттера ${V} м/с`, r.vFlutter, V, 0.05,
        'теория по полосам: нет концевых потерь и сжимаемости', ' м/с');
      diverge(`прогон ${run}: частота флаттера ${f} Гц`, r.fFlutter, f, 0.05,
        'теория по полосам без концевых потерь даёт частоту флаттера выше настоящей; расчёт NACA TN 1848 по той же теории дал 25,27 Гц против 22,1', ' Гц');
    }
    info(`дивергенция по модели при ρ 1,077 — ${r0.vDivergence.toFixed(0)} м/с: упругая ось на 43,7 % хорды, далеко за фокусом`);
    info('крыло Тэнга — Доуэлла (Duke) и Pazy (Технион) не сверяются: у первого флаттер второй формы изгиба с кручением при грузе на конце, '
      + 'у второго — нелинейный, от больших прогибов; двух линейных форм для них мало');
  }

  section('Ламинаты IM7/8552 против испытаний NCAMP (2019): жёсткость и прочность пяти укладок');
  {
    // Слой (NCAMP CAM-RP-2009-015 Rev B, RTD, средние по 3 партиям, как измерено): E1 162,1 ГПа при растяжении
    // и 140,9 — при сжатии, E2 8,96, G12 4,69 ГПа, ν12 0,316; Xt 2559 МПа (прямой замер), Xc 1731 (пересчитано NCAMP
    // по теории из перекрёстного [90/0/90] — не независимо), Yt 64,1, Yc 285,7, S12 91,2 МПа (при 5 % сдвига).
    const ply = (E1: number): Material => ({ id: 'ncamp', name: 'IM7/8552 NCAMP', group: 'composite', kind: 'typical', density: 1570,
      E: E1, E2: 8.96e9, G12: 4.69e9, nu: 0.316, ultTension: 2559e6, ultCompression: 1731e6, shear: 91.2e6, Yt: 64.1e6, Yc: 285.7e6, sources: [] });
    const T = ply(162.1e9), Cm = ply(140.9e9);
    // Бюджеты: модуль 5 % (разброс партий 2–3 %, разная доля волокна панелей слоя и ламината около 1 %);
    // прочность 10 % (разброс партий 3–5 %, расчёт по наибольшей деформации волокна).
    const cases: [string, Layup, number, number, number, number][] = [
      ['квазиизотропный 25/50/25', { p0: 0.25, p45: 0.5, p90: 0.25 }, 57.5, 717.1, 54.2, 599.5],
      ['«мягкий» 10/80/10', { p0: 0.1, p45: 0.8, p90: 0.1 }, 36.06, 462.5, 34.34, 465.3],
      ['«жёсткий» 50/40/10', { p0: 0.5, p45: 0.4, p90: 0.1 }, 91.0, 1215, 82.3, 834.7],
    ];
    for (const [nm, l, Et, Xt, Ec, Xc] of cases) {
      const pt = laminateProps(T, l), pc = laminateProps(Cm, l);
      diverge(`${nm}: модуль на растяжение ${Et} ГПа`, pt.Ex / 1e9, Et, 0.05, 'классическая теория завышает модуль на растяжение на 4–6 % у всех укладок NCAMP: '
        + 'слой и ламинат — из разных панелей, нелинейность волокна', ' ГПа');
      diverge(`${nm}: модуль на сжатие ${Ec} ГПа`, pc.Ex / 1e9, Ec, 0.05, '', ' ГПа');
      diverge(`${nm}: прочность на растяжение ${Xt} МПа`, pt.Xt / 1e6, Xt, 0.1,
        'расчёт по деформации разрушения волокна однонаправленного слоя: в ламинате волокна рвутся раньше — концентрация у кромок образца, '
        + 'растрескивание соседних слоёв, свободные кромки', ' МПа');
      diverge(`${nm}: прочность на сжатие ${Xc} МПа`, pc.Xc / 1e6, Xc, 0.1,
        'сжатие слоя Xc пересчитано NCAMP по этой же теории; в ламинате волокна теряют устойчивость при другой деформации', ' МПа');
    }
    const x = laminateProps(T, { p0: 0.5, p45: 0, p90: 0.5 });
    diverge('перекрёстный [0/90]: модуль на растяжение 81,7 ГПа', x.Ex / 1e9, 81.7, 0.05, 'как у остальных укладок', ' ГПа');
    diverge('перекрёстный [0/90]: прочность на растяжение 1166 МПа', x.Xt / 1e6, 1166, 0.1, 'как у остальных укладок', ' МПа');
  }
}


// ---------- 12. R22 в полёте вперёд и на авторотации против данных Robinson ----------
// Лопасти машут свободно (качающаяся втулка с шарнирами конусности), диск наклоняется циклическим шагом; на авторотации
// мотор отключён обгонной муфтой и обороты держит общий шаг. Корпус — в «трубе» со свободой по вертикали (rotorflight.ts):
// положение фюзеляжа по тангажу не балансируется. Масса — наибольшая взлётная, 1370 lb (в источниках масса не указана).
function heli(RAPIER: typeof RAPIER_NS, { section, flag, diverge, info }: Reporter) {
  const spec = applyAssumptions(r22);
  section('R22: мощность в полёте вперёд против данных Robinson (AAIB Bulletin 11/98, G-BUIW)');
  {
    // Robinson для AAIB: горизонтальный полёт 90 kt на 500 ft — 90 HP; набор 1000 ft/min на 60 kt — 103 HP (всего).
    // Бюджет 10 %: масса не указана (1200–1370 lb меняет мощность на 5–7 %), числа круглые.
    const lvl = heliTrim(RAPIER, spec, { V: 90 * KT, altitude: 500 * FT });
    flag('90 kt горизонтально: балансировка установилась', lvl.steady,
      `общий шаг ${lvl.collective.toFixed(1)}°, продольный циклический ${lvl.cyclicLon.toFixed(1)}°, поперечный ${lvl.cyclicLat.toFixed(1)}°`);
    diverge('90 kt горизонтально: 90 л. с. (Robinson)', lvl.power / HP, 90, 0.1,
      'вредное сопротивление фюзеляжа (0,59 м²) — оценка; масса в источнике не указана', ' л. с.');
    const clb = heliTrim(RAPIER, spec, { V: 60 * KT, climb: 1000 * FPM, altitude: 500 * FT });
    flag('60 kt, набор 1000 ft/min: балансировка установилась', clb.steady, `общий шаг ${clb.collective.toFixed(1)}°`);
    diverge('60 kt, набор 1000 ft/min: 103 л. с. (Robinson)', clb.power / HP, 103, 0.1,
      'вредное сопротивление фюзеляжа — оценка; масса в источнике не указана', ' л. с.');
    info(`90 kt: хвостовой винт ${(lvl.tailPower / HP).toFixed(1)} л. с., взмах лопасти ±${lvl.beta.toFixed(1)}°; наименьший запас прочности лопасти `
      + `${lvl.minMargin.toFixed(2)} — у корня (лонжерон — эквивалентная коробка 40 % хорды, слабее настоящей лопасти в плоскости вращения; `
      + 'подвеска втулки ниже шарнира, гасящая кориолисовы силы у R22, не опубликована — в модели её нет): справочно');
  }

  section('R22: авторотация против POH и Flight Training Guide Robinson');
  {
    // POH, Safety Notice SN-38: на установившейся авторотации 60–70 KIAS вертикальная скорость «обычно меньше 1500 ft/min».
    for (const kt of [60, 70]) {
      const a = heliTrim(RAPIER, spec, { V: kt * KT, autorotation: true, rpmFrac: 1 });
      flag(`${kt} KIAS, обороты 100 %: снижение меньше 1500 ft/min (POH, SN-38)`, a.steady && -a.vz / FPM < 1500,
        `${(-a.vz / FPM).toFixed(0)} ft/min, общий шаг ${a.collective.toFixed(1)}°, обороты ${a.rpm.toFixed(0)}`);
    }
    // POH, с. 3-3: наибольшая дальность — 75 KIAS при 90 % оборотов, качество около 4:1 (1 морская миля на 1500 ft) —
    // вертикальная скорость около 1900 ft/min (расчёт по этим числам). Бюджет 10 %: «около».
    const g = heliTrim(RAPIER, spec, { V: 75 * KT, autorotation: true, rpmFrac: 0.9 });
    diverge('75 KIAS, 90 %: снижение около 1900 ft/min (качество 4:1, POH)', -g.vz / FPM, 1900, 0.1,
      'модели нужно меньше мощности для этой скорости: вредное сопротивление фюзеляжа (0,59 м²) — оценка; на 75 kt около половины потерь — '
      + 'фюзеляж; кроме того, фюзеляж в модели не наклонён (у настоящего на авторотации — нос вверх, сопротивление больше)', ' ft/min');
    info(`75 KIAS, 90 %: качество модели ${((75 * KT) / -g.vz).toFixed(1)}:1 (POH — около 4:1)`);
    // Flight Training Guide, с. 7.27: наименьшая вертикальная скорость — на 53 kt при 90 % оборотов (числа нет).
    const sweep = [40, 45, 53, 60, 65].map((kt) => ({ kt, rod: -heliTrim(RAPIER, spec, { V: kt * KT, autorotation: true, rpmFrac: 0.9 }).vz / FPM }));
    const best = sweep.reduce((m, x) => (x.rod < m.rod ? x : m));
    info(`90 % оборотов, вертикальная скорость по скорости полёта: ${sweep.map((x) => `${x.kt} kt — ${x.rod.toFixed(0)}`).join('; ')} ft/min; `
      + `наименьшая на ${best.kt} kt (Robinson — 53 kt)`);
    flag('наименьшая вертикальная скорость авторотации — на 45–60 kt (Robinson: 53 kt), а не на краях диапазона', best.kt >= 45 && best.kt <= 60, `${best.kt} kt`);
  }

  section('R22: энергия вращения винта (справочно)');
  {
    // Robinson для AAIB: кинетическая энергия винта на 104 % — 100 HP·s. Что именно названо так — вся энергия или запас до
    // оборотов, после которых винт не восстановить, — из текста не ясно. Модель: лопасти по 13 кг (оценка).
    const sim = new Sim(RAPIER, spec, { aero: false });
    const I = sim.rotors[0].blades.reduce((s, b) => s + (b.flap?.Ib ?? 0), 0);
    sim.free();
    const w = (530 * 2 * Math.PI) / 60;
    const E = 0.5 * I * w * w;
    info(`момент инерции лопастей ${I.toFixed(0)} кг·м²; энергия на 104 % — ${(E / HP).toFixed(0)} HP·s, запас до 80 % — ${((E * (1 - (80 / 104) ** 2)) / HP).toFixed(0)} HP·s; `
      + 'Robinson: 100 HP·s');
  }
}


// ---------- 11. Cessna 172S во всех шести степенях свободы против лётного испытания AAIB ----------
// Самолёт собран по своим данным (presets/cessna172.ts): геометрия, рули, массы агрегатов. Устойчивость не задаётся —
// она получается из геометрии: поверхности по элементам, скос потока за крылом (вихревая подкова с запаздыванием),
// обтекание фюзеляжа поперечным потоком, момент Мунка. Эталон — лётное испытание AAIB (Bulletin 12/2020, G-CBXJ, с. 26–28):
// Cessna 172S, 2300 lb, центровка 41,43 in, 110 KIAS на 2500 об/мин, газ закреплён.
function sixdof(RAPIER: typeof RAPIER_NS, { section, flag, diverge, info }: Reporter) {
  const LB = 0.45359237;
  section('Cessna 172S: масса, центровка и моменты инерции модели');
  {
    const sim = new Sim(RAPIER, applyAssumptions(cessna172), { aero: false });
    const c = sim.systemCom();
    // Зависимые: массы и плечи агрегатов взяты так, чтобы пустой самолёт сошёлся с примером взвешивания POH.
    flag('масса при полной загрузке — 2550 lb (зависимая: собрана из POH)', Math.abs(sim.totalMass / LB - 2550) < 1, `${(sim.totalMass / LB).toFixed(1)} lb`);
    flag('центровка — 42,6 in (POH, рис. 6-5; зависимая)', Math.abs(42.6 - c.x / 0.0254 - 42.6) < 0.2, `${(42.6 - c.x / 0.0254).toFixed(2)} in`);
    const I = [v3(1, 0, 0), v3(0, 0, 1), v3(0, 1, 0)].map((ax) => sim.inertiaAbout(c, ax));
    sim.free();
    // Измеренных моментов инерции C172 в открытых данных нет. Есть расчётные: NASA CR-1975 (1972, рис. 82a) — у Cessna 182
    // (их же повторяет JSBSim c172p); модели mscsim (C172, пустой 754 кг) и Wolfram/Cel 2019 (C172, 1060 кг) — по чертежам
    // и весовым группам. Разброс — вдвое; модель — между ними.
    const S2 = 1.35582;
    info(`моменты инерции модели при 1157 кг: крен ${I[0].toFixed(0)}, тангаж ${I[1].toFixed(0)}, рыскание ${I[2].toFixed(0)} кг·м²; `
      + `расчёты: Cessna 182 (NASA CR-1975) ${(948 * S2).toFixed(0)} / ${(1346 * S2).toFixed(0)} / ${(1967 * S2).toFixed(0)}; `
      + 'mscsim C172 (754 кг) 2028 / 2271 / 3857; Wolfram C172 (1060 кг) 2424 / 2427 / 4372 — измерений нет');
  }

  section('Cessna 172S: производные устойчивости в «трубе» (справочно: эталоны — расчёты, не измерения)');
  {
    // Корпус закреплён, поток 60 м/с, газ убран. Эталоны — расчётные: NASA CR-1975 (Cessna 182, крейсер C_L = 0,31,
    // табл. 25) и JSBSim c172p (по открытым данным и «догадкам», по словам самого файла).
    const ref = { S: 16.2, c: 1.494, b: 11.0 };
    const spec = applyAssumptions(cessna172);
    const tc = (a: number, b: number, ch: Record<string, number> = {}) => tunnelCoefficients(RAPIER, spec, 60, a, b, ref, ch);
    const r = (d: number) => (d * Math.PI) / 180;
    const a1 = tc(-2, 0), a2 = tc(4, 0), b1 = tc(2, -5), b2 = tc(2, 5), z = tc(2, 0), ail = tc(2, 0, { roll: 10 }), rud = tc(2, 0, { yaw: 10 });
    const CLa = (a2.CL - a1.CL) / r(6), Cma = (a2.Cm - a1.Cm) / r(6);
    info(`C_Lα = ${CLa.toFixed(2)} 1/рад (C182: 4,61); C_mα = ${Cma.toFixed(2)} (C182: −0,89; JSBSim: −1,8 — центровки разные); `
      + `запас устойчивости ${((-Cma / CLa) * 100).toFixed(0)} % САХ`);
    info(`C_Yβ = ${((b2.CY - b1.CY) / r(10)).toFixed(3)} (C182: −0,309; JSBSim: −0,393); C_lβ = ${((b2.Cl - b1.Cl) / r(10)).toFixed(3)} (−0,089; −0,092); `
      + `C_nβ = ${((b2.Cn - b1.Cn) / r(10)).toFixed(3)} (0,065; 0,059)`);
    info(`элероны: C_lδa = ${((ail.Cl - z.Cl) / r(10 * 0.875)).toFixed(3)} на радиан среднего отклонения (JSBSim: 0,229); `
      + `руль направления: C_nδr = ${((rud.Cn - z.Cn) / r(10)).toFixed(3)} (C182: 0,066 по модулю; JSBSim: 0,043)`);
    {
      // Скос потока у стабилизатора: dε/dα по формуле DATCOM (разд. 4.4.1, обобщение продувок):
      // dε/dα = 4,44·[K_A·K_λ·K_h·√cos Λ]^1,19, K_A = 1/A − 1/(1 + A^1,7), K_λ = (10 − 3λ)/7, K_h = (1 − |h/b|)/∛(2·l/b).
      // Cessna: A = 7,47, λ = 1,13/1,626, стреловидность 0, стабилизатор на 0,45 м ниже крыла, плечо 4,79 м.
      const A = 7.47, lam = 1.13 / 1.626, KA = 1 / A - 1 / (1 + A ** 1.7), Kl = (10 - 3 * lam) / 7, Kh = (1 - 0.45 / 11) / Math.cbrt((2 * 4.79) / 11);
      const datcom = 4.44 * (KA * Kl * Kh) ** 1.19;
      const eps = (aDeg: number) => {
        const a = r(aDeg);
        const wind = v3(-60 * Math.cos(a), 60 * Math.sin(a), 0);
        const sim = new Sim(RAPIER, spec, { gravity: false, wind });
        sim.lockRoot('fixed');
        sim.shift(v3(0, 500, 0));
        sim.channels.throttle = 0;
        while (sim.t < 2) sim.step();
        // Точка — середина правой половины стабилизатора по размаху, на линии четвертей хорд.
        const tail = cessna172.parts.find((p) => p.id === 'tailR')!;
        const P = v3(tail.position[0], tail.position[1] + 500, tail.position[2] + 0.45 * tail.aero!.span);
        const w = sim.wingWash(P, wind);
        sim.free();
        // Угол скоса — поворот потока вниз относительно набегающего: составляющая w поперёк потока в плоскости симметрии.
        return Math.atan2(-(w.x * Math.sin(a) + w.y * Math.cos(a)), 60);
      };
      diverge(`скос потока у стабилизатора dε/dα: ${datcom.toFixed(2)} (DATCOM, обобщение продувок)`, (eps(6) - eps(0)) / r(6), datcom, 0.15,
        'модель — свёрнутые концевые вихри (подкова на π/4 размаха) и прямой след по потоку; на плече 3 хорды след ещё не свернулся '
        + 'и опущен скосом, формула DATCOM этого не разделяет; её разброс по продувкам — около 10–15 %', '');
    }
    info('поперечная устойчивость C_lβ модели меньше расчётов: высокоплан учтён только через обтекание фюзеляжа поперечным потоком '
      + '(двумерный диполь); путевая C_nβ больше: киль по площади Jane’s (1,73 м²) с удлинением «стенки» и боковым скосом от фюзеляжа '
      + 'даёт по раскладке DATCOM около 0,1–0,15; нормальная сила винта при скольжении (дестабилизирует) в модели не считается');
  }

  // Загрузка испытания: 2300 lb, 41,43 in. Распределение между топливом и людьми не опубликовано: топливо 240 lb (оценка),
  // люди — так, чтобы сошлись масса и центровка (впереди 259,6 lb на 37 in, сзади 158,4 lb на 73 in).
  const aaib = applyAssumptions(cessna172, {
    'parts[occFront].mass': 259.6 * LB, 'parts[occRear].mass': 158.4 * LB, 'parts[fuelR].mass': 120 * LB, 'parts[fuelL].mass': 120 * LB,
  });
  const ALT = 3500 * FT; // GPS-высота опыта 3300–3780 ft
  const start = () => {
    const sim = airborne(RAPIER, aaib, ALT, 115 * KT);
    const sig = Math.sqrt(sim.rho / 1.225); // приборная скорость ≈ истинная × √σ (без ошибок приёмника давления)
    const pilot = new Pilot(sim);
    const trim = trimLevel(sim, pilot, (110 * KT) / sig);
    return { sim, sig, pilot, trim };
  };

  section('Фугоида Cessna 172S против лётного испытания AAIB: 110 KIAS, 3500 ft, газ закреплён, ручка отпущена');
  {
    {
      const s0 = new Sim(RAPIER, aaib, { aero: false });
      const c = s0.systemCom();
      flag('загрузка испытания: 2300 lb на 41,43 in (зависимая)', Math.abs(s0.totalMass / LB - 2300) < 1 && Math.abs(42.6 - c.x / 0.0254 - 41.43) < 0.2,
        `${(s0.totalMass / LB).toFixed(1)} lb, ${(42.6 - c.x / 0.0254).toFixed(2)} in`);
      s0.free();
    }
    const { sim, sig, pilot, trim } = start();
    flag('горизонтальный полёт на 110 KIAS сбалансирован', trim.steady, `руль высоты ${trim.channels.pitch.toFixed(2)}°, газ ${trim.channels.throttle.toFixed(3)}`);
    diverge('обороты на 110 KIAS в горизонтальном полёте: 2500 об/мин (AAIB)', trim.rpm, 2500, 0.02,
      'винт «лёгкий»: геометрия лопасти не опубликована (как и в крейсерской таблице POH, где обороты модели выше)', ' об/мин');
    // Снижение 1000 ft/min на том же газе: AAIB — 135 KIAS и 2650 об/мин, нужно лёгкое давление от себя (2 кгс).
    const tD = sim.t;
    while (sim.t < tD + 60) {
      pilot.climb((-1000 * FT) / 60);
      pilot.lateral(0);
      sim.step();
    }
    const vDesc = (sim.sample.airspeed * sig) / KT, rpmDesc = sim.sample.propRpm, deDesc = sim.channels.pitch;
    diverge('снижение 1000 ft/min на том же газе: 135 KIAS (AAIB)', vDesc, 135, 0.03, 'скорость в отчёте округлена; винт модели «лёгкий»', ' узл.');
    diverge('снижение 1000 ft/min: 2650 об/мин (AAIB)', rpmDesc, 2650, 0.02,
      'винт «лёгкий»: обороты растут со скоростью быстрее, чем у настоящего', ' об/мин');
    flag('в снижении на большей скорости руль высоты отклонён «от себя» сильнее, чем в балансировке (устойчивость по скорости: AAIB — давление 2 кгс)',
      deDesc < trim.channels.pitch, `${deDesc.toFixed(2)}° против ${trim.channels.pitch.toFixed(2)}°`);
    // Ручка отпущена: руль высоты возвращается в положение балансировки (в модели — закреплён; у настоящего — свободен).
    sim.channels.pitch = trim.channels.pitch;
    const tR = sim.t;
    const T: number[] = [], V: number[] = [];
    while (sim.t < tR + 110) {
      pilot.lateral(0);
      sim.step();
      if (sim.steps % 5 === 0) {
        T.push(sim.t - tR);
        V.push((sim.sample.airspeed * sig) / KT);
      }
    }
    sim.free();
    const ex = extrema(T, V, 1).slice(1, 6); // первый экстремум — момент отпускания
    const m = oscillation(ex);
    // AAIB, рис. 5 (чтение графика ±3 kt, ±2 с): минимум 78 kt (11:25:06), максимум 131 (:24), минимум 95 (:43), максимум 117 (11:26:02).
    const ref = oscillation([{ t: 6, x: 78 }, { t: 24, x: 131 }, { t: 43, x: 95 }, { t: 62, x: 117 }]);
    diverge('период фугоиды: 35–40 с (AAIB, текст)', m.period, 37.5, 2.5 / 37.5,
      'в испытании ручка брошена — руль высоты свободен и «плавает», запас устойчивости меньше, чем с закреплённым рулём модели, '
      + 'а при меньшем запасе фугоида длиннее; обдувка оперения струёй винта (растёт при падении скорости на закреплённом газе) не учтена', ' с');
    diverge(`затухание фугоиды ζ: по экстремумам рис. 5 AAIB — ${ref.zeta.toFixed(2)} («сильно задемпфирована»)`, m.zeta, ref.zeta, 0.3,
      'чтение графика ±3 kt на размахах 22–53 kt даёт ±0,04 по ζ', '');
    info(`скорость после отпускания, KIAS: модель ${ex.map((e) => e.x.toFixed(0)).join(' → ')}; AAIB 78 → 131 → 95 → 117 (из снижения на 135)`);
  }

  section('Крен на полных элеронах: Cessna 172S против лётного испытания Cessna 177B (NASA CR-2337, табл. IV)');
  {
    // Измерений крена у самой C172 в открытых данных нет. Ближайший измеренный — Cessna 177B Cardinal (тот же класс:
    // размах 36 ft, крыло 175 ft²; но консольное крыло без подкоса и свои элероны): полные элероны как можно быстрее,
    // педали закреплены, около 4000 ft. 120 mph IAS (≈104 kt): наибольшая угловая скорость 54,5 °/с, pb/2V 0,090–0,096;
    // 80 mph (≈70 kt): 34,8 °/с, pb/2V 0,083–0,090. Расчётные модели C172: JSBSim c172x (C_lp = −0,47, C_lδa = 0,23) даёт
    // pb/2V ≈ 0,15, UIUC (C_lδa = 0,178) — 0,12; без учёта скольжения обе — верхняя граница.
    const roll = (vKt: number) => {
      const sig = Math.sqrt(atmosphere(cessna172.environment, 1219).rho / cessna172.environment.rho);
      const vTas = (vKt * KT) / sig;
      const sim = airborne(RAPIER, applyAssumptions(cessna172), 1219, vTas);
      const pilot = new Pilot(sim);
      const trim = trimLevel(sim, pilot, vTas, 200);
      const t0 = sim.t;
      let pMax = 0, t30 = NaN;
      while (sim.t < t0 + 4) {
        sim.channels.roll = trim.channels.roll + 20 * Math.min(1, (sim.t - t0) / 0.2);
        sim.step();
        const p = Math.abs(unrotate(sim.root.b.rb.rotation(), copy(sim.root.b.rb.angvel())).x);
        pMax = Math.max(pMax, p);
        if (Number.isNaN(t30) && Math.abs(sim.sample.rollDeg) >= 30) t30 = sim.t - t0;
      }
      sim.free();
      return { p: (pMax * 180) / Math.PI, pb2v: (pMax * 11.0) / (2 * vTas), t30 };
    };
    const r104 = roll(104), r70 = roll(70);
    const why = 'измерение — у другого самолёта (Cessna 177B: консольное крыло, свои элероны); щели элеронов и обратное рыскание '
      + 'с закреплёнными педалями (скольжение 8–11° в испытании) в модели не учтены; расчётные модели C172 тоже дают 0,12–0,15';
    diverge('pb/2V на 104 kt: 0,093 (Cessna 177B, NASA CR-2337)', r104.pb2v, 0.093, 0.1, why, '');
    diverge('pb/2V на 70 kt: 0,087 (Cessna 177B, NASA CR-2337)', r70.pb2v, 0.087, 0.1, why, '');
    info(`крен 30° через ${r104.t30.toFixed(2)} с на 104 kt и ${r70.t30.toFixed(2)} с на 70 kt (177B: 0,70–0,74 и 1,02–1,41 с); `
      + `наибольшая угловая скорость ${r104.p.toFixed(0)} и ${r70.p.toFixed(0)} °/с (177B: 54,5 и 34,8)`);
  }

  section('Спираль Cessna 172S против лётного испытания AAIB: органы управления закреплены, небольшая правая педаль');
  {
    // AAIB: «небольшое (2 см) нажатие правой педали — самолёт медленно кренится вправо, нос опускается, скорость растёт:
    // спираль за 10–15 с». Сколько градусов руля дают 2 см педали, не опубликовано: полный ход руля 16°, ход педали — около
    // 10 см (оценка), 2 см — около 3°. Модель: элероны и руль высоты закреплены в балансировке (у настоящего — свободны).
    const run = (dr: number) => {
      const { sim, sig, trim } = start();
      sim.channels.yaw = trim.channels.yaw + dr;
      const t0 = sim.t, v0 = sim.sample.airspeed;
      let t30 = NaN, theta30 = NaN, dv30 = NaN;
      while (sim.t < t0 + 40 && Number.isNaN(t30)) {
        sim.step();
        if (Math.abs(sim.sample.rollDeg) >= 30) {
          t30 = sim.t - t0;
          theta30 = sim.sample.pitchDeg - trim.pitchDeg;
          dv30 = ((sim.sample.airspeed - v0) * sig) / KT;
        }
      }
      const roll = sim.sample.rollDeg;
      sim.free();
      return { t30, theta30, dv30, roll };
    };
    const r3 = run(3);
    flag('правая педаль — крен вправо, нос опускается, скорость растёт (поперечная устойчивость от скольжения, AAIB)',
      r3.roll > 0 && r3.theta30 < 0 && r3.dv30 > 0, `крен 30° через ${r3.t30.toFixed(1)} с; нос на ${r3.theta30.toFixed(1)}°, скорость +${r3.dv30.toFixed(1)} kt`);
    diverge('руль 3° (2 см педали, оценка): крен 30° — «спираль за 10–15 с» (AAIB)', r3.t30, 12.5, 0.2,
      'поперечная устойчивость модели (C_lβ) меньше расчётной в 1,4 раза — крен от скольжения нарастает медленнее; сколько градусов руля '
      + 'в 2 см педали — оценка; у настоящего самолёта элероны свободны', ' с');
    for (const dr of [2, 4]) {
      const r = run(dr);
      info(`руль ${dr}°: крен 30° через ${r.t30.toFixed(1)} с, нос ${r.theta30.toFixed(1)}°, скорость +${r.dv30.toFixed(1)} kt`);
    }
  }
}


// ---------- 10. Двигатели и батареи против документации производителей ----------
// Модель — engine.ts: удельный расход и закон высоты — по руководству Lycoming (60297-12); батарея — по измеренной
// кривой разряда HV-LiPo (Melasta, SINTEF). Эталоны здесь — другие документы: руководство Cessna 172S и паспорт DJI.
function engines(RAPIER: typeof RAPIER_NS, { section, diverge, info }: Reporter) {
  section('Расход топлива Cessna 172S против таблицы крейсерских режимов POH (рис. 5-8)');
  {
    // POH, рис. 5-8, стандартная температура (точная перепись таблицы): высота ft, об/мин, % от 180 л. с., GPH.
    // Смесь в POH — «recommended lean»; у Lycoming две кривые — наивыгоднейшая и наибольшей мощности; модель считает обе,
    // и проверяется, что расход POH лежит между ними. Бюджет 3 %: округление GPH до 0,1 (около 1 %), чтение графика
    // Lycoming ±0,5 lb/h (около 1 %), график снят при 2400 об/мин, а строки POH — при 2100–2700 (около 1 %).
    const rows: [number, number, number, number][] = [
      [2000, 2550, 77, 10.5], [2000, 2400, 64, 9.0], [2000, 2200, 50, 7.3], [4000, 2600, 77, 10.4], [4000, 2400, 61, 8.5], [4000, 2200, 48, 7.0],
      [6000, 2650, 77, 10.4], [6000, 2400, 57, 8.2], [6000, 2200, 45, 6.7], [8000, 2700, 77, 10.4], [8000, 2400, 54, 7.8], [8000, 2200, 43, 6.5],
      [10000, 2700, 72, 9.8], [10000, 2400, 51, 7.5], [12000, 2650, 64, 8.9], [12000, 2400, 49, 7.1],
    ];
    const e = cessna172.powerplant.engine!;
    const gph = (P: number, mix: number) => (fuelFlow({ ...e, mixture: mix } as typeof e, P, cessna172.powerplant.power) * 3600) / (6 * 0.45359237);
    for (const [ft, rpm, pct, poh] of rows) {
      const P = (pct / 100) * 180 * HP;
      const lo = gph(P, 0), hi = gph(P, 1);
      const lo2 = Math.min(lo, hi), hi2 = Math.max(lo, hi);
      const near = Math.max(lo2, Math.min(hi2, poh));
      diverge(`${ft} ft, ${rpm} об/мин, ${pct} %: расход ${poh} gal/h в POH между наивыгоднейшей (${lo.toFixed(2)}) и наибольшей мощности (${hi.toFixed(2)})`,
        near, poh, 0.03, pct <= 50
          ? 'график Lycoming кончается на 53 % мощности; ниже удельный расход продолжен по прямой — у настоящего мотора на малой мощности он растёт быстрее'
          : 'удельный расход снят с графика Lycoming при 2400 об/мин; при других оборотах он немного другой', ' gal/h');
    }
  }

  section('Мощность на полном газе в жару и в холод: модель против POH Cessna 172S (рис. 5-8, 8000 ft, 2700 об/мин)');
  {
    // POH: при 2700 об/мин на 8000 ft — 83 % (ISA −20 °C), 77 % (ISA), 71 % (ISA +20 °C). Это полный газ (наибольшие обороты
    // строки). Модель: закон Lycoming по δ/√θ с фактической температурой. Бюджет 3 %: округление % до целого (около 1,3 %),
    // закон снят при 2400 об/мин (около 1 %).
    for (const [dT, pct] of [[-20, 83], [0, 77], [20, 71]]) {
      const P = availablePower(cessna172.powerplant.engine!, 1e9, cessna172.environment, 8000 * FT, dT) / (180 * HP);
      diverge(`ISA ${dT >= 0 ? '+' : ''}${dT} °C: полный газ ${pct} %`, P, pct / 100, 0.03, 'закон Lycoming снят при стандартной температуре и 2400 об/мин', '');
    }
  }

  section('Мощность Lycoming O-360-J2A с высотой (мотор R22): закон модели против графика Lycoming рис. 3-41');
  {
    // Справочно, не проверка: k = 1,10 у R22 снят с этого же графика.
    const e = r22.powerplant.engine!;
    for (const [ft, hp] of [[8000, 133.9], [10000, 124.1], [15000, 101.5], [20000, 82.1]]) {
      const P = availablePower(e, 1e9, r22.environment, ft * FT) / HP;
      info(`${ft} ft, полный газ, 2700 об/мин: модель ${P.toFixed(1)} л. с., график ${hp} л. с. (${((P / hp - 1) * 100).toFixed(1)} %; k снят с этого графика)`);
    }
  }

  section('Время полёта DJI Phantom 4 против паспорта (28 мин, висение на уровне моря)');
  {
    // Паспорт DJI (руководство v1.2, с. 61): «около 28 мин» на уровне моря без ветра. Модель: мощность висения квадрокоптера
    // (ротор сверен со стендом NASA Ames выше) с потерями моторов и регуляторов, батарея 81,3 Вт·ч до 3,0 В на элемент по
    // измеренной кривой разряда HV-LiPo. Бюджет 10 %: «около 28 мин» — округление (около 2 %); электроника, подвес и камера
    // в модели не потребляют (5–10 Вт из 160–170, около 5 %); DJI сажает аппарат до полного разряда (около 3 %).
    const spec = applyAssumptions(quadcopter);
    const h = trimHover(RAPIER, spec);
    const t = endurance(spec.powerplant.engine!, h.power, spec.powerplant.power);
    diverge(`висение: мощность ${h.power.toFixed(0)} Вт, батарея — ${(batteryEnergy(spec.powerplant.engine as Extract<EngineSpec, { type: 'electric' }>, h.power) / 3600).toFixed(1)} Вт·ч до отсечки: время`, t / 60, 28, 0.1,
      'мощность висения модели и потери моторов — оценки (КПД 0,75 сверен со стендом NASA); электроника, подвес и камера не учтены', ' мин');
  }

  section('Удельный расход турбовального двигателя по режиму: два двигателя (справочно)');
  info('модель — кривая T700-GE-700 (GE Status-81, NASA TM-100991); у ТВ3-117ВМ по модели МАИ при той же доле мощности расход выше: '
    + '0,47 — 1,35 против 1,16; 0,57 — 1,23 против 1,10; 0,69 — 1,13 против 1,04; 0,85 — 1,05 против 1,00. Разные двигатели расходятся на 5–15 % — '
    + 'для проектов ИИ это неопределённость расхода, если тип двигателя не известен');
}

// ---------- 9. Струя несущего винта на корпусе (download) ----------
// Makofski & Menkick, NACA TN 3900 (1956): двухлопастный винт R = 18,74 ft (5,712 м), хорда 9,4 in (0,239 м), без крутки,
// NACA 23015, концевая скорость 500 ft/s; плоские фанерные панели хордой 4 ft (1,219 м) поперёк струи на 1–12 ft под диском,
// размах — диаметр винта (площадь 0,136 диска) или радиус (0,068). Вертикальная сила на панели к тяге винта, нагрузка
// на диск 2,36 lb/ft² (C_T ≈ 0,004); при 1,36 lb/ft² — то же. C_D пластины поперёк потока по удлинению — 1,25 и 1,18
// (так взяли авторы, по справочнику). Числа — из текста отчёта: большая панель 11 % при 0,05 R, 9,3 % при 0,2 R,
// 8,5–9 % от 0,2 до 0,65 R; малая — в среднем 2 % от 0,2 до 0,64 R. Мощность винта от панелей не менялась.
// Профиль лопасти: NACA 23015 — c_l0 0,12, наклон 0,1 на градус, c_l,max 1,5, c_d0 0,008 (Report 824, оценка; на долю
// нагрузки почти не влияет).
function download(RAPIER: typeof RAPIER_NS, { section, diverge, info }: Reporter) {
  section('Струя несущего винта на корпусе: панели под винтом на вышке Langley (NACA TN 3900)');
  const R = 5.712;
  const g0: Rig = { R, root: 0.05 * R, cRoot: 0.239, cTip: 0.239, blades: 2, twistDeg: 0, rpm: (152.4 * 60) / (2 * Math.PI * R),
    af: { name: 'NACA 23015', cl0: 0.12, clAlpha: 0.1 / deg, clMax: 1.5, cd0: 0.008, k: 0.006, thickness: 0.15 } };
  // Шаг — такой, чтобы C_T была около 0,004 (нагрузка на диск 2,36 lb/ft²).
  const th = 7;
  // Бюджет 10 %: по тексту отчёта «8,5–9 %» — разброс ±3 %; тягу авторы мерили по натяжению вала (±2 %); близко к диску
  // на панель действуют периодические нагрузки от лопастей (авторы: до 20 % разницы со стационарным расчётом) — их в модели нет.
  for (const [depth, meas] of [[0.05, 0.11], [0.2, 0.093], [0.35, 0.0875], [0.5, 0.0875], [0.64, 0.0875]] as [number, number][]) {
    const m = hoverRig(RAPIER, { ...g0, panel: { span: 2 * R, chord: 1.219, depth: depth * R, cd: 1.25 } }, th);
    diverge(`большая панель (0,136 диска) на ${depth} R под диском: нагрузка / тяга (опыт ${(meas * 100).toFixed(1)} %; C_T модели ${m.ct.toFixed(4)})`, m.download, meas, 0.1,
      'струя в модели — вихревой цилиндр за диском с потоком по кольцам (BEMT) и сжатием по расходу; у диска на панель приходят '
      + 'ещё периодические нагрузки от пролетающих лопастей, а сжатие струи у настоящего винта идёт быстрее');
  }
  for (const [depth, meas] of [[0.2, 0.02], [0.4, 0.02], [0.64, 0.02]] as [number, number][]) {
    const m = hoverRig(RAPIER, { ...g0, panel: { span: R, chord: 1.219, depth: depth * R, cd: 1.18 } }, th);
    // Бюджет 25 %: «averages about 2 percent» — одно округлённое число на весь диапазон глубин (±0,5 п. п.).
    diverge(`малая панель (0,068 диска) на ${depth} R под диском: нагрузка / тяга (опыт около 2 %)`, m.download, meas, 0.25,
      'внутренняя половина диска: поток там слабее среднего; доля зависит от того, как быстро поток падает к комлю лопасти');
  }
  info('справочно — крупные вертолёты: RSRA (класс S-61) в полёте 4,0 % тяги (NASA CR-166399); модель AH-64 в масштабе 0,27 — 5–6 % (NASA TM-4201); '
    + 'у R22 и R44 замеров нет');
}

// ---------- 8. Влияние земли на винт и крыло ----------
// Модель — зеркальное отображение: Чизмен — Беннет для винта (ARC R&M 3021), Визельсбергер для крыла (NACA TM 77).
// Ни одна из формул не подбиралась под эти опыты. Числа и адреса — data/research.md, часть 5.
function groundEffect(RAPIER: typeof RAPIER_NS, { section, diverge, info }: Reporter) {
  section('Влияние земли на несущий винт: стендовые замеры Knight & Hefner (NACA TN 835) — винт с постоянным шагом');
  {
    // TN 835, таблица III: 4 лопасти, D = 5 ft, σ = 0,0849, NACA 0015 без крутки, 900 об/мин — тот же винт, что в TN 626
    // (хорда 2 in от r = 5 in). Шаг постоянный, тяга меряется на разной высоте втулки над землёй. Сравнивается тяга
    // при z/R против тяги при z/R = 2 — так в опыте не нужен ни c_d0, ни наклон профиля.
    // Бюджет 4 %: точность весов ±1 % на каждую из двух тяг, чтение высоты стенда; модель за вращающимся следом у земли
    // (рециркуляция при z/R < 0,5) не следит — там допуск не спасает, и это будет видно.
    const meas: Record<number, [number, number][]> = {
      8: [[0.5, 1.82], [1.0, 1.56], [1.5, 1.42], [2.0, 1.38]],
      10: [[0.5, 2.38], [1.0, 2.15], [1.5, 1.99], [2.0, 1.93]],
    };
    const g0: Omit<Rig, 'hubZ'> = { R: 0.762, root: 0.127, cRoot: 0.0508, cTip: 0.0508, blades: 4, twistDeg: 0, rpm: 900,
      af: { name: 'NACA 0015', cl0: 0, clAlpha: 0.1 / deg, clMax: 1.1, cd0: 0.0101, k: 0.01, thickness: 0.15, polar: NACA0015 } };
    for (const th of [8, 10]) {
      const ref = hoverRig(RAPIER, { ...g0, hubZ: 2 * g0.R }, th).ct;
      for (const [zr, tsig] of meas[th]) {
        if (zr === 2) continue;
        const m = hoverRig(RAPIER, { ...g0, hubZ: zr * g0.R }, th).ct;
        diverge(`θ = ${th}°, z/R = ${zr}: тяга / тяга при z/R = 2 (опыт ${(tsig / meas[th][3][1]).toFixed(3)})`, m / ref, tsig / meas[th][3][1], 0.04,
          'модель — зеркальный источник Чизмена — Беннета, один множитель на весь диск; у настоящего винта без крутки поток к концу '
          + 'лопасти сильнее, и у самой земли след растекается и частью засасывается обратно (рециркуляция) — этого в модели нет');
      }
    }
  }

  section('Влияние земли на несущий винт: лётные замеры (ARC R&M 3021, Зброжек R&M 2347)');
  {
    const { rotorGroundFactor } = groundFns;
    // R&M 3021, рис. 2: средние кривые по лётным испытаниям S-51, Dragonfly и Sycamore — индуктивная мощность у земли
    // к индуктивной вдали от неё при том же весе, без скорости. Чтение графика ±2–3 %.
    // Бюджет 4 %: чтение 3 % плюс то, что «индуктивная мощность» в опыте получена вычитанием профильной (оценка авторов).
    for (const [zr, ratio] of [[0.6, 0.8], [0.8, 0.865], [1.0, 0.905], [2.0, 0.985]]) {
      diverge(`z/R = ${zr}: индуктивная мощность у земли / вдали (лётные испытания, средняя кривая ${ratio})`, rotorGroundFactor(zr, 1, 0, 1), ratio, 0.04,
        'формула Чизмена — Беннета даёт выгоду от земли меньше, чем средняя лётная кривая: у винта с настоящей неравномерной нагрузкой '
        + 'по диску отражённый след тормозит концы лопастей сильнее');
    }
    // Зброжек (R&M 2347) — точки на рис. 4 R&M 3021: тяга у земли / вдали при той же мощности. В модели при той же индуктивной
    // мощности T^1,5·k = const, т. е. T/T∞ = k^(−2/3); профильная мощность при этом тоже меняется (шаг другой) — около 1 %.
    // Бюджет 4 %: чтение ±2–3 % плюс 1 % от профильной мощности.
    for (const [zr, ratio] of [[0.6, 1.145], [0.7, 1.09], [1.0, 1.065], [1.25, 1.047], [1.5, 1.03], [2.8, 1.0]]) {
      diverge(`z/R = ${zr}: тяга у земли / вдали при той же мощности (Зброжек, ${ratio})`, rotorGroundFactor(zr, 1, 0, 1) ** (-2 / 3), ratio, 0.04,
        'формула Чизмена — Беннета даёт выгоду от земли меньше опыта при малых высотах');
    }
    info('справочно — сводка Таннера и др. (NASA, 2016, рис. 2) по десятку опытов: T/T∞ при z/R 0,5 — 1,15…1,35; 1,0 — 1,05…1,15; 1,5 — 1,01…1,05; 2,0 — 1,00…1,04. '
      + `Модель (T^1,5·k = const): ${[0.5, 1, 1.5, 2].map((z) => (rotorGroundFactor(z, 1, 0, 1) ** (-2 / 3)).toFixed(3)).join(', ')}`);
  }

  section('Влияние земли на крыло: продувки Fink & Lastinger (NASA TN D-926)');
  {
    const { wingGroundFactor } = groundFns;
    // Рис. 10: измеренное эффективное удлинение A_e/A_e,∞ у прямоугольных крыльев A = 1–6 (метод зеркального крыла).
    // Индуктивное сопротивление у земли / вдали = A_e,∞ / A_e. Чтение графика ±2–3 %, разброс между удлинениями при
    // h/b = 0,088 — от 0,40 до 0,49 (±10 % от среднего).
    // Бюджет: 10 % при h/b < 0,1 (разброс опытов), 5 % выше (чтение и разброс меньше).
    for (const [hb, ratio] of [[0.047, 0.32], [0.088, 0.445], [0.13, 0.55], [0.17, 0.69], [0.25, 0.8], [0.34, 0.89], [0.5, 0.95]]) {
      diverge(`h/b = ${hb}: индуктивное сопротивление у земли / вдали (опыт ${ratio})`, wingGroundFactor(hb, 1), ratio, hb < 0.1 ? 0.1 : 0.05,
        'теория Визельсбергера в общепринятой записи; у толстого изогнутого профиля опыта у самой земли добавляется эффект «воздушной подушки» под профилем');
    }
  }
}

// ---------- 1. Поляра профиля на всём круге против продувок NACA 0012 ----------
// Critzos, Heyson & Boswinkle, NACA TN 3361 (1955): Re 1,8·10⁶, M 0,12, гладкий; числа из текста и с графика
// Fig. 3(a) (чтение ±0,04). Sheldahl & Klimas, SAND80-2114 (1981): опыты WSU при Re 0,36–0,7·10⁶, с графиков
// Fig. 10/19 (±0,03 по C_L, ±0,05 по C_D). Это два независимых опыта при разных Re.
// Параметры профиля модели — по тому же опыту в доотрывной области (наклон 0,103 на градус по Fig. 3(b),
// c_l,max = 1,33, c_d,min = 0,007 — из текста TN 3361); за срывом модель от них не зависит: там пластина Хёрнера,
// нормальная сила 1,98·sin α.
// Допуск 10 %: чтение графика 3–4 % плюс расхождение двух опытов между собой (C_D(90°) 2,08 против 1,8, C_L(45°)
// 1,16 против 1,09 — около ±7 % от среднего); числа Рейнольдса за срывом модель не различает.
function airfoilFullCircle({ section, diverge }: Reporter) {
  section('Поляра NACA 0012 на всём круге углов против продувок (TN 3361 и SAND80-2114)');
  const af: Airfoil = { name: 'NACA 0012, Re 1,8·10⁶', cl0: 0, clAlpha: 0.103 / deg, clMax: 1.33, cd0: 0.007, k: 0.005, thickness: 0.12 };
  const c = (a: number) => airfoilCoeffs(af, a * deg, 0);
  const cn = (a: number) => { const x = c(a); return x.cl * Math.cos(a * deg) + x.cd * Math.sin(a * deg); };
  const stall = af.clMax / af.clAlpha! / deg;
  diverge('угол срыва: модель c_l,max/наклон против опыта (14°, TN 3361)', stall, 14, 0.1,
    'подъёмная сила в модели растёт линейно до самого c_l,max; у настоящего профиля кривая перед срывом загибается, и тот же максимум достигается на 1–2° позже', '°');
  // Среднее двух опытов там, где они оба есть; разброс — в допуске.
  const pts: [number, number, number, number, number][] = [
    // α, C_L(TN 3361), C_D(TN 3361), C_L(WSU), C_D(WSU)
    [30, 0.95, 0.61, 0.90, 0.59],
    [45, 1.16, 1.23, 1.09, 1.135],
    [60, 0.95, 1.67, 0.87, 1.49],
    [90, 0.12, 2.08, 0.05, 1.785],
    [135, -1.055, 1.23, -0.965, 1.105],
  ];
  const why = 'за срывом модель — пластина с нормальной силой 1,98·sin α (Хёрнер); у профиля при 30–60° нормальная сила на 10–20 % больше: '
    + 'скруглённая передняя кромка ещё даёт подсасывающую силу и подъёмная сила не падает до пластины. Модель за срывом занижает силы — в сторону осторожности для подъёмной силы и в сторону оптимизма для сопротивления';
  for (const [a, l1, d1, l2, d2] of pts) {
    const nMeas = ((l1 + l2) / 2) * Math.cos(a * deg) + ((d1 + d2) / 2) * Math.sin(a * deg);
    diverge(`α = ${a}°: нормальная сила C_N (среднее двух опытов ${nMeas.toFixed(2)}; TN 3361 — ${(l1 * Math.cos(a * deg) + d1 * Math.sin(a * deg)).toFixed(2)}, WSU — ${(l2 * Math.cos(a * deg) + d2 * Math.sin(a * deg)).toFixed(2)})`,
      cn(a), nMeas, 0.1, why);
    if (a !== 90) diverge(`α = ${a}°: C_L`, c(a).cl, (l1 + l2) / 2, 0.1, why);
  }
  diverge('α = 20° (переход через срыв): C_L', c(20).cl, 0.72, 0.1, 'ширина перехода через срыв в модели (4°) — оценка; у настоящего профиля после срыва C_L держится около 0,7–0,8 до 25°', '');
  // Допуск 43 %: точность весов TN 3361 при Re 1,8·10⁶ по сопротивлению ±0,006 — это 43 % от самого числа.
  diverge('α = 180° (задней кромкой вперёд): C_D против 0,014 (TN 3361, текст)', c(180).cd, 0.014, 0.006 / 0.014,
    'при обтекании задом наперёд модель берёт C_D0 прямого обтекания (0,007); измерено вдвое больше — у острой кромки впереди ламинарный участок короче. На силы влияет мало: это доли процента скоростного напора');
}

// ---------- 2. Профили эталонов против продувок при их числах Рейнольдса ----------
// Это сверка входных данных, а не модели: профиль эталона задан числами, и надо знать, что они не подобраны.
function presetAirfoils({ section, flag, diverge }: Reporter) {
  section('Профили эталонов против продувок при их числах Рейнольдса');
  // Cessna 172S: NACA 2412. Report 824 (Abbott, von Doenhoff, Stivers 1945), с графиков листа с. 136:
  // c_l,max ≈ 1,59 (Re 3,1·10⁶) и 1,67 (5,7·10⁶), со стандартной шероховатостью ≈ 1,19; c_d,min 0,0063 гладкий,
  // 0,0097 шероховатый; α₀ ≈ −2°. Re крыла на сваливании: 27,3 м/с × 1,45 м / 1,46·10⁻⁵ ≈ 2,7·10⁶.
  const w = cessna172.parts.find((p) => p.id === 'wingR')!.aero!.airfoil;
  const re = (27.3 * 1.45) / 1.46e-5;
  const clmaxSmooth = 1.59 + ((re - 3.1e6) / (5.7e6 - 3.1e6)) * (1.67 - 1.59);
  diverge(`Cessna, NACA 2412: c_l,max модели против гладкого профиля в трубе при Re ${(re / 1e6).toFixed(1)}·10⁶ (Report 824)`, w.clMax, clmaxSmooth, 0.05,
    'в модели взят профиль немного хуже гладкого', '');
  flag('Cessna, NACA 2412: c_l,max модели лежит между шероховатым (1,19) и гладким профилем — у настоящего крыла заклёпки и краска', w.clMax >= 1.19 && w.clMax <= clmaxSmooth + 0.02, `${w.clMax}`);
  flag('Cessna, NACA 2412: c_d0 модели между гладким (0,0063) и шероховатым (0,0097) профилем', w.cd0 >= 0.0063 && w.cd0 <= 0.0097, `${w.cd0}`);
  diverge('Cessna, NACA 2412: подъёмная сила при нулевом угле C_L0 = наклон × 2° (α₀ ≈ −2°, Report 824)', w.cl0, (w.clAlpha ?? 5.9) * 2 * deg, 0.15,
    'угол нулевой подъёмной силы снят с графика с точностью около ±0,3°', '');
  // R22: NACA 63-015 в модели; в Report 824 есть 63₂-015 (с. 166): c_l,max ≈ 1,39 при Re 3·10⁶, с шероховатостью ≈ 1,13;
  // c_d,min 0,0054. Re лопасти на 0,75 R: 160 м/с × 0,183 м / 1,46·10⁻⁵ ≈ 2,0·10⁶ — ниже, чем 3·10⁶ (c_l,max меньше).
  flag('R22, NACA 63-015: c_l,max модели (1,3) между шероховатым (1,13) и гладким (1,39 при Re 3·10⁶) профилем', 1.13 <= 1.3 && 1.3 <= 1.39, 'соответствие 63₂-015 профилю настоящей лопасти не проверено');
}

// ---------- 2а. Рост сопротивления от сжимаемости против продувки NACA 0012 ----------
// Carpenter, NACA TN 4357 (1958), рис. 5, штриховые кривые — двумерный профиль в трубе Langley LTPT (опыт; сплошные кривые
// того же рисунка — «синтезированные» по винту, здесь не используются). Чтение с рендера 300 dpi с наложенной сеткой:
// ±0,005 по M, ±0,0003 по c_d. Коэффициенты модели (κ_A = 0,92, s = 0,31 в M_dd = κ_A − t/c − s·c_l) сняты с этих же
// кривых — по M_dd при наклоне 0,1 (прямая по четырём углам), поэтому M_dd здесь — самосогласование, а не проверка.
// Проверка — форма роста по Локу, 20·(M − M_cr)⁴: числа Маха, при которых прирост c_d достигает 0,002 и 0,01.
function airfoilCompressibility({ section, diverge, info }: Reporter) {
  section('Рост сопротивления от сжимаемости: NACA 0012 против продувки (Carpenter, NACA TN 4357, рис. 5)');
  const af: Airfoil = { name: 'NACA 0012', cl0: 0, clAlpha: 0.103 / deg, clMax: 1.33, cd0: 0.006, k: 0.005, thickness: 0.12 };
  // Прирост c_d модели над значением при M = 0,3 (у опыта — над почти постоянным участком при M 0,3–0,5).
  const dcd = (a: number, m: number) => airfoilCoeffs(af, a * deg, m).cd - airfoilCoeffs(af, a * deg, 0.3).cd;
  const machAt = (a: number, d: number) => {
    let lo = 0.3, hi = 0.95;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (dcd(a, m) < d) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const clPG = (a: number, m: number) => (0.103 * a) / Math.sqrt(1 - m * m);
  // α; M_dd опыта (наклон 0,1); M при Δc_d = 0,002; M при Δc_d = 0,01 — по штриховым кривым
  const rows: [number, number, number, number][] = [[0, 0.795, 0.763, 0.811], [4, 0.651, 0.623, 0.685], [6, 0.56, 0.553, 0.599], [8, 0.505, 0.477, 0.528]];
  const why = 'M_dd модели линейно зависит от c_l (одна прямая на все углы); у опыта зависимость изогнута: при α = 0 расходимость позже, '
    + 'при 8° (до срыва 4–5°) — раньше. Рост за M_dd у двумерного профиля круче формулы Лока, а у концевого сечения лопасти — положе '
    + '(сплошные кривые рис. 5: трёхмерное обтекание конца), поэтому на винте формула Лока ближе к опыту';
  for (const [a, mdd, m20, m100] of rows) {
    info(`α = ${a}°: M_dd модели ${dragDivergenceMach(af, clPG(a, mdd)).toFixed(3)} против ${mdd} по опыту (коэффициенты сняты с этих точек — самосогласование)`);
    // Допуск 3 %: чтение ±0,005 по M (0,8 %) и разброс точек около прямой M_dd(c_l) ±0,02 (3 %).
    diverge(`α = ${a}°: M, при котором c_d выросло на 0,002 (опыт ${m20})`, machAt(a, 0.002), m20, 0.03, why, '');
    diverge(`α = ${a}°: M, при котором c_d выросло на 0,01 (опыт ${m100})`, machAt(a, 0.01), m100, 0.03, why, '');
  }
}

// ---------- 3. Cessna 172S против руководства по лётной эксплуатации ----------
// POH 172S (Information Manual, Rev 5, 2004; таблицы раздела 5 совпадают с NAV III 2006): рис. 5-3 (сваливание),
// 5-6/5-7 (набор), 5-8 (крейсер), спецификация (максимальная скорость). Масса 2550 lb, стандартная температура.
// Скорости в таблицах — с обтекателями колёс («increase the speeds by approximately 2 knots»); есть ли они
// у модели, неизвестно: сопротивление фюзеляжа, шасси и оперения (0,36 м²) — оценка, под POH не подбиралась.
function cessnaPoh(RAPIER: typeof RAPIER_NS, { section, diverge, info, flag }: Reporter) {
  section('Cessna 172S против руководства по лётной эксплуатации (POH, раздел 5)');
  const spec = () => applyAssumptions(cessna172);
  const env = cessna172.environment;
  // Винт фиксированного шага McCauley 1A170E/JHA7660 (src/core/propeller.ts): D = 76 in, шаг 60 in — по обозначению,
  // остальная геометрия лопасти — оценки (cessna172.ts), выбраны до сверки и под POH не подбирались.
  // Мотор IO-360-L2A: момент на полном газе постоянный — по сертификату типа EASA.IM.E.032 (Issue 03, 2022, разд. 6):
  // 160 hp при 2400 об/мин и 180 hp при 2700, т. е. 474 Н·м в обеих точках. Ниже 2400 постоянство момента — допущение.
  const s0 = spec();
  const pa = s0.actuators.find((a) => a.type === 'propeller' && a.fixedPitch) as Extract<Spec['actuators'][number], { type: 'propeller' }>;
  const geom: FixedPitchGeometry = { ...pa.fixedPitch!, radius: pa.diameter / 2 };
  const wRated = ((s0.powerplant.ratedRpm ?? 2700) * Math.PI) / 30;
  const Q0 = s0.powerplant.power / wRated;
  const rpmOf = (om: number) => (om * 30) / Math.PI;
  info(`винт модели: активность лопасти AF ${activityFactor(geom).toFixed(0)} (у винтов лёгких самолётов обычно 80–100; геометрия McCauley не опубликована)`);

  // Сваливание: 53 KCAS, закрылки 0°, обе центровки, без тяги; торможение ~1 узел в секунду — как в программе.
  // Бюджет 5 %: округление таблицы до узла (1 %); c_l,max профиля — с графика и с неизвестной шероховатостью
  // (±5 % → ±2,5 % по скорости); в модели при торможении газ не убран (около 1 %).
  const base = run(RAPIER, spec(), 'flight');
  diverge('сваливание, закрылки 0°, 2550 lb: 53 KCAS (POH, рис. 5-3)', base.flight?.vStall ?? NaN, 53 * KT, 0.05,
    'c_l,max самолёта модели отличается от настоящего', ' м/с');
  // Максимальная скорость у земли 126 kt (спецификация POH, с обтекателями колёс). У винта фиксированного шага на полном
  // газе в горизонтальном полёте у земли обороты ушли бы за красную черту (в модели — около 3080 об/мин), поэтому программа,
  // как пилот, прибирает газ и держит не больше 2700 об/мин (POH, раздел 2). Бюджет 4 %: 2 узла на обтекатели (1,6 %),
  // мощность мотора на 2700 об/мин у земли и обеднение (около 1 %), шаг и профиль лопасти — оценки: ±5 % поглощаемой
  // мощности при 2700 об/мин дают ±1,7 % скорости (P ~ V³). Корень из суммы квадратов — 2,5 %, с запасом 4 %.
  diverge('максимальная скорость у земли при не больше 2700 об/мин: 126 kt (POH, спецификация)', base.flight?.vMax ?? NaN, 126 * KT, 0.04,
    'винт модели «лёгкий» — при 2700 об/мин поглощает меньше мощности, чем настоящий (см. сверку поглощаемой мощности ниже), поэтому газ прибран сильнее', ' м/с');
  info(`на максимальной скорости обороты модели ${(base.flight?.vMaxRpm ?? NaN).toFixed(0)} об/мин (ограничение 2700)`);

  // Статические обороты на полном газе: 2300–2400 об/мин (POH, раздел 2 «Engine»; это допуск приёмки винта на самолёте).
  // Равновесие момента мотора (474 Н·м) и момента винта при V = 0, у земли. Бюджет 2,5 %: половина диапазона POH (2,1 %),
  // тахометр (около 1 %), постоянство момента ниже 2400 об/мин — допущение (около 1 %).
  const staticRpm = (g: FixedPitchGeometry) => rpmOf(propellerEquilibrium(g, 0, () => Q0, env.rho, env.soundSpeed).omega);
  const st = propellerEquilibrium(geom, 0, () => Q0, env.rho, env.soundSpeed);
  // Какой C_P нужен, чтобы винт на месте поглотил 474 Н·м при 2300 и при 2400 об/мин, и сколько даёт модель при 2350.
  const D = 2 * geom.radius;
  const cpNeed = (rpm: number) => (Q0 * ((rpm * Math.PI) / 30)) / (env.rho * (rpm / 60) ** 3 * D ** 5);
  const cp2350 = propellerLoads(geom, 0, (2350 * Math.PI) / 30, env.rho, env.soundSpeed).cp;
  // Чувствительность к оценкам (не подбор: геометрия в модели не меняется, числа — для причины расхождения).
  const rpmWideChord = staticRpm({ ...geom, chord: geom.chord.map(([x, c]) => [x, 1.25 * c] as [number, number]) });
  const rpmClMax = staticRpm({ ...geom, airfoil: { ...geom.airfoil, clMax: 1.6 } });
  diverge('статические обороты на полном газе у земли: 2300–2400 об/мин (POH, раздел 2)', rpmOf(st.omega), 2350, 0.025,
    `винт модели на месте «лёгкий»: при 2350 об/мин C_P ${cp2350.toFixed(4)}, а чтобы поглотить момент мотора, нужно ${cpNeed(2400).toFixed(4)}–${cpNeed(2300).toFixed(4)}. `
    + 'На месте лопасть в срыве на большей части радиуса: за срывом модель сечения быстро переходит к пластине Хёрнера, а c_l,max не растёт вместе с наклоном '
    + 'по Прандтлю — Глауэрту; задержки срыва на вращающейся лопасти в модели нет. Тот же недобор у винта APC 9x4.7 SF с измеренной геометрией '
    + `(C_P на месте ниже опыта UIUC, раздел «малый винт»). Хорда (AF ${activityFactor(geom).toFixed(0)}) и профиль лопасти — оценки: `
    + `с хордой ×1,25 (AF ${(1.25 * activityFactor(geom)).toFixed(0)}) было бы ${rpmWideChord.toFixed(0)} об/мин, с c_l,max 1,6 — ${rpmClMax.toFixed(0)}`, ' об/мин');
  info(`винт на месте у земли: тяга ${st.loads.thrust.toFixed(0)} Н, C_T ${st.loads.ct.toFixed(4)}, C_P ${st.loads.cp.toFixed(4)}, M конца ${st.loads.tipMach.toFixed(2)}`);
  // Верификация: обороты в расчёте (I·dΩ/dt = Q_мотора − Q_винта, шаг 1/240 с) сходятся к тому же равновесию.
  {
    const sim = new Sim(RAPIER, spec(), { breakable: false });
    sim.lockRoot('fixed');
    sim.channels.throttle = 1;
    sim.advance(10);
    const rpm = sim.sample.propRpm;
    sim.free();
    flag('обороты винта в расчёте на закреплённом самолёте сходятся к равновесию моментов (верификация)', Math.abs(rpm / rpmOf(st.omega) - 1) < 0.005,
      `${rpm.toFixed(0)} против ${rpmOf(st.omega).toFixed(0)} об/мин`);
  }

  // Падение мощности поршневого мотора с высотой (Гэгг — Феррар, 1,132σ − 0,132) против строк таблицы на 2700 об/мин
  // — наибольших оборотов, т. е. полного газа: 8000 ft — 77 %, 10 000 ft — 72 %. Бюджет 3 %: округление процента (0,7 %)
  // и режим «рекомендуемое обеднение» вместо наилучшей мощности (около 2 %).
  for (const [ft, pct] of [[8000, 77], [10000, 72]]) {
    const s = atmosphere(env, ft * FT).rho / env.rho;
    diverge(`мощность мотора на полном газе на ${ft} ft: ${pct} % (POH, рис. 5-8, 2700 об/мин)`, 1.132 * s - 0.132, pct / 100, 0.03,
      'формула Гэгга — Феррара средняя для поршневых моторов без наддува', '');
  }

  // Винт отдельно от планера: какую мощность поглощает винт модели при скорости и оборотах строки POH (рис. 5-8, все 37 строк
  // стандартной температуры). У настоящего самолёта это мощность мотора в той же строке. От сопротивления планера сверка
  // не зависит. Бюджет 4 %: %BHP в POH — по графикам мотора при рекомендуемом обеднении (около 3 %), отбор мощности
  // на генератор и вакуумный насос (около 1,5 кВт, 2 %), округление 1 узел и 1 % (около 1 %).
  const table: [number, number, number, number][] = [
    // высота, ft; об/мин; %BHP; KTAS — POH рис. 5-8, стандартная температура
    [2000, 2550, 77, 118], [2000, 2500, 73, 115], [2000, 2400, 64, 110], [2000, 2300, 57, 104], [2000, 2200, 50, 97], [2000, 2100, 44, 90],
    [4000, 2600, 77, 120], [4000, 2550, 73, 117], [4000, 2500, 69, 115], [4000, 2400, 61, 109], [4000, 2300, 54, 102], [4000, 2200, 48, 96], [4000, 2100, 42, 89],
    [6000, 2650, 77, 122], [6000, 2600, 73, 119], [6000, 2500, 65, 114], [6000, 2400, 57, 108], [6000, 2300, 51, 101], [6000, 2200, 45, 94],
    [8000, 2700, 77, 124], [8000, 2650, 72, 122], [8000, 2600, 68, 119], [8000, 2500, 61, 112], [8000, 2400, 54, 106], [8000, 2300, 48, 99], [8000, 2200, 43, 92],
    [10000, 2700, 72, 123], [10000, 2650, 68, 120], [10000, 2600, 64, 117], [10000, 2500, 57, 111], [10000, 2400, 51, 104], [10000, 2300, 46, 97],
    [12000, 2650, 64, 119], [12000, 2600, 61, 116], [12000, 2500, 54, 109], [12000, 2400, 49, 102], [12000, 2300, 44, 95],
  ];
  const absorbed: number[] = [];
  const js: number[] = [];
  for (const [ft, rpm, pct, kt] of table) {
    const at = atmosphere(env, ft * FT);
    const om = (rpm * Math.PI) / 30;
    const L = propellerLoads(geom, kt * KT, om, at.rho, at.soundSpeed);
    absorbed.push((L.torque * om) / ((pct / 100) * 180 * HP));
    js.push(L.j);
  }
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  diverge('винт: мощность, поглощаемая при скорости и оборотах строки POH, к %BHP той же строки (рис. 5-8, среднее по 37 строкам)', mean(absorbed), 1, 0.04,
    'винт модели «лёгкий». Угол установки лопасти известен только через шаг 60 in, а отсчёт угла (плоская сторона или хорда) и нулевой угол профиля — оценки: '
    + 'на J ≈ 0,7 сечения работают при угле атаки около 1°, и ошибка в 1° меняет поглощаемую мощность примерно на 15 %. Не моделируется торможение потока '
    + 'перед винтом капотом и обтекателем втулки — оно делает настоящий винт «тяжелее»', '');
  info(`винт по строкам POH: J ${Math.min(...js).toFixed(2)}–${Math.max(...js).toFixed(2)}, поглощаемая мощность от ${(100 * (Math.min(...absorbed) - 1)).toFixed(0)} до ${(100 * (Math.max(...absorbed) - 1)).toFixed(0)} % к POH; недобор растёт к малым J`);

  // Потребная мощность и обороты на крейсере в полёте. Модель держит истинную скорость и высоту строки; мощность мотора —
  // момент (газ × 474 Н·м × падение с высотой) × обороты. Бюджет мощности 8 %: таблица POH расчётная по лётным испытаниям,
  // округление 1 узел и 1 % (около 2 %); обтекатели колёс — 2 узла, около 5 % мощности при P ~ V³; КПД винта модели
  // зависит от оценённой геометрии лопасти — около ±5 %. Корень из суммы квадратов — 7,4 %.
  // Бюджет оборотов 2 %: на J ≈ 0,7 C_P винта круто падает с J, и ошибка мощности на 5 % меняет обороты всего на 1 %
  // (P ∝ n³·C_P(J), d ln C_P / d ln J ≈ −2); обтекатели (около 1 %), тахометр (около 1 %), округление скорости 0,4 %.
  // Строка 8000 ft, 2700 об/мин, 77 % — это полный газ (77 % = падение мощности с высотой) на красной черте; модель на этих
  // оборотах держит меньшую скорость (винт «лёгкий», газ прибирается), поэтому строка сверяется как наибольшая скорость
  // на 8000 ft при не больше 2700 об/мин против 124 KTAS. Бюджет 4 % — как у наибольшей скорости у земли.
  {
    const r = run(RAPIER, spec(), 'flight', { altitude: 8000 * FT });
    diverge('наибольшая скорость на 8000 ft при не больше 2700 об/мин: 124 KTAS (POH, рис. 5-8: 2700 об/мин, 77 %)', r.flight?.vMax ?? NaN, 124 * KT, 0.04,
      'винт модели «лёгкий» — при 2700 об/мин поглощает меньше мощности, чем настоящий, газ прибран', ' м/с');
    info(`на 8000 ft на наибольшей скорости: ${(r.flight?.vMaxRpm ?? NaN).toFixed(0)} об/мин`);
  }
  const rows: [number, number, number, number][] = [
    // высота, ft; KTAS; %BHP; об/мин — POH рис. 5-8, стандартная температура
    [8000, 112, 61, 2500], [8000, 99, 48, 2300], [8000, 92, 43, 2200],
    [2000, 118, 77, 2550], [2000, 104, 57, 2300], [2000, 90, 44, 2100],
    [12000, 109, 54, 2500],
  ];
  const devs: number[] = [];
  const rpmDevs: number[] = [];
  for (const [ft, kt, pct, rpmRef] of rows) {
    const r = run(RAPIER, spec(), 'flight', { altitude: ft * FT, cruiseSpeed: kt * KT });
    const p = r.flight?.cruiseSteady ? r.flight.cruisePower ?? NaN : NaN;
    const rpm = r.flight?.cruiseSteady ? r.flight.cruiseRpm ?? NaN : NaN;
    const ref = (pct / 100) * 180 * HP;
    devs.push(p / ref - 1);
    rpmDevs.push(rpm / rpmRef - 1);
    diverge(`крейсер ${ft} ft, ${kt} KTAS: ${pct} % мощности (POH, рис. 5-8)`, p, ref, 0.08,
      `модели нужно меньше мощности, чем настоящему самолёту: вредное сопротивление (0,36 м²) — оценка, а КПД винта модели (${(r.flight?.cruisePropEfficiency ?? NaN).toFixed(2)}) `
      + 'выше настоящего — нет потерь от капота и струи на фюзеляже', ' Вт');
    diverge(`крейсер ${ft} ft, ${kt} KTAS: ${rpmRef} об/мин (POH, рис. 5-8)`, rpm, rpmRef, 0.02,
      'две ошибки модели здесь отчасти гасят друг друга: винт «лёгкий» (обороты выше), а планеру нужно меньше мощности (обороты ниже)', ' об/мин');
  }
  const fin = (x: number[]) => x.filter(Number.isFinite);
  const pct = (x: number) => (100 * x).toFixed(1);
  info(`крейсерская таблица: мощность модели в среднем ${pct(mean(fin(devs)))} % от POH (от ${pct(Math.min(...fin(devs)))} до ${pct(Math.max(...fin(devs)))} %), `
    + `обороты ${pct(mean(fin(rpmDevs)))} % (от ${pct(Math.min(...fin(rpmDevs)))} до ${pct(Math.max(...fin(rpmDevs)))} %); не установилось строк: ${devs.length - fin(devs).length}`);

  // Наибольшая скороподъёмность (POH, рис. 5-7, полный газ, стандартная температура): у земли 730 fpm на 74 KIAS,
  // на 8000 ft 410 fpm на 72 KIAS. Истинная скорость: 74 KIAS ≈ 73 KCAS у земли; 72 KIAS ≈ 71 KCAS → 80 KTAS на 8000 ft.
  // Бюджет 10 %: таблица округлена до 5 fpm; скороподъёмность — малая разность двух больших мощностей, и неточность
  // скорости набора на 1–2 узла её почти не меняет (максимум пологий). Обороты в наборе в POH не приведены.
  for (const [ft, kts, fpm] of [[0, 73, 730], [8000, 80, 410]]) {
    const r = run(RAPIER, spec(), 'flight', { altitude: ft * FT, climbSpeed: kts * KT });
    const rpm = r.flight?.climbRpm ?? NaN, eta = r.flight?.climbPropEfficiency ?? NaN;
    diverge(`скороподъёмность на ${ft} ft: ${fpm} fpm (POH, рис. 5-7)`, r.flight?.climbRate ?? NaN, fpm * FPM, 0.1,
      `избыток мощности модели больше настоящего. Винт «лёгкий»: в наборе ${rpm.toFixed(0)} об/мин, а у настоящего, судя по статическим 2300–2400, меньше — `
      + `и мотор отдаёт меньше мощности. КПД винта модели в наборе ${eta.toFixed(2)} против около 0,6–0,65 у настоящего (оценка по POH): нет торможения потока `
      + 'капотом и роста сопротивления фюзеляжа в струе винта. Планеру модели нужно меньше мощности (см. крейсер)', ' м/с');
    info(`набор на ${ft} ft: обороты модели ${rpm.toFixed(0)} об/мин, КПД винта ${eta.toFixed(2)}, ${((r.flight?.climbRate ?? NaN) / FPM).toFixed(0)} fpm`);
  }

  // Моменты инерции — в разделе «Cessna 172S во всех степенях свободы» (справочно: измерений нет).
}

// ---------- 4. Винт на висении против измерений на стендах ----------
// Винт собирается по геометрии из отчёта, крутится в неподвижном воздухе на закреплённом корпусе (без земли);
// снимаются тяга и мощность на валу. c_d0 профиля берётся из того же опыта по мощности при наименьшей тяге
// (одна точка опыта — профильная мощность); остальные точки — проверка индуктивной части, концевых потерь
// (по умолчанию — поток по кольцам, BEMT, без поправки κ). Сравнивается C_Q модели с измеренным C_Q при той же C_T (интерполяция по опыту).
// hubZ — высота нижней втулки над землёй, м. Не задана — винт вдали от земли (влияние земли выключено): так для опытов,
// где высота стенда не известна или заведомо больше трёх радиусов.
interface Rig { R: number; root: number; cRoot: number; cTip: number; blades: number; twistDeg: number; rpm: number; af: Airfoil; coaxGap?: number; hubZ?: number;
  // плоская панель под винтом поперёк струи (NACA TN 3900): размах (по диаметру винта, по центру), хорда, глубина под диском, C_D
  panel?: { span: number; chord: number; depth: number; cd: number } }
function hoverRig(RAPIER: typeof RAPIER_NS, g: Rig, theta75: number, inducedFactor?: number) {
  const span = g.R - g.root;
  const twist = (g.twistDeg * span) / g.R; // крутка задана на радиус, в модели — на размах лопасти
  // Угол установки задаётся у корня лопасти; крутка линейная — так, чтобы на 0,75 R был theta75.
  const inc = theta75 - (twist * (0.75 * g.R - g.root)) / span;
  const y0 = g.hubZ ?? 2.5;
  const parts: Spec['parts'] = [{ id: 'body', kind: 'body', position: [0, y0 - 0.5, 0], shape: { type: 'box', size: [0.2, 0.2, 0.2] }, mass: 1000 }];
  const joints: Spec['joints'] = [];
  if (g.panel) {
    parts.push({ id: 'panel', kind: 'body', position: [0, y0 - g.panel.depth, 0], shape: { type: 'box', size: [g.panel.chord, 0.02, g.panel.span] }, mass: 10,
      dragArea: 0, crossflowCd: g.panel.cd, collides: false });
    joints.push({ id: 'fp', type: 'fixed', parent: 'body', child: 'panel' });
  }
  const actuators: Spec['actuators'] = [];
  const rotors = g.coaxGap ? [{ y: y0, dir: 1 as const }, { y: y0 + g.coaxGap, dir: -1 as const }] : [{ y: y0, dir: 1 as const }];
  rotors.forEach((ro, i) => {
    const hub = `hub${i}`;
    parts.push({ id: hub, kind: 'hub', position: [0, ro.y, 0], shape: { type: 'cylinder', size: [0.1, 0.05, 0.1] }, mass: 2 });
    joints.push({ id: `m${i}`, type: 'revolute', parent: 'body', child: hub, axis: [0, 1, 0] });
    actuators.push({ id: `rot${i}`, type: 'spinner', joint: `m${i}`, rpm: g.rpm, direction: ro.dir, rampTime: 1, ...(inducedFactor ? { inducedFactor } : {}) });
    for (let b = 0; b < g.blades; b++) {
      const ang = (360 * b) / g.blades;
      const a = ang * deg;
      // Как в пресете квадрокоптера: у винта, вращающегося по часовой стрелке, лопасть зеркальная (side = −1) и повёрнута на 180°;
      // корень у обоих — на одном и том же месте, лопасть идёт наружу. (До шестой проверки корень зеркальной лопасти ставился
      // по другую сторону оси, и она шла через ось: верхний винт соосного стенда давал в 4,5 раза меньше тяги.)
      const pos: [number, number, number] = [g.root * Math.sin(a), ro.y, g.root * Math.cos(a)];
      parts.push({ id: `b${i}${b}`, kind: 'blade', position: pos, rotation: [0, ro.dir === 1 ? ang : ang + 180, 0], mass: 1,
        aero: { side: ro.dir === 1 ? 1 : -1, span, rootChord: g.cRoot, tipChord: g.cTip, incidenceDeg: inc, twistDeg: twist, airfoil: g.af, sections: 16 } });
      joints.push({ id: `f${i}${b}`, type: 'fixed', parent: hub, child: `b${i}${b}` });
    }
  });
  const spec: Spec = {
    schema: 1, meta: { name: 'стенд висения', class: 'rotor', source: 'preset' },
    environment: { name: 'Земля', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
    parts, joints, actuators, powerplant: { power: 1e7 }, crew: { part: 'body', seats: [[0, 0, 0]], unmanned: true }, assumptions: [],
  };
  const sim = new Sim(RAPIER, spec, { gravity: false, breakable: false, groundEffect: g.hubZ !== undefined });
  sim.lockRoot('fixed');
  sim.advance(2.5);
  let T = 0, P = 0, n = 0, D = 0;
  const masts = sim.joints.filter((j) => j.spec.id.startsWith('m'));
  const panel = sim.parts.find((x) => x.spec.id === 'panel');
  sim.advance(1, () => {
    T += sim.rotors.reduce((x, r) => x + r.thrust, 0);
    P += masts.reduce((x, j) => x + j.shaftPower, 0);
    D += panel ? -panel.aeroForce.y : 0;
    n++;
  });
  sim.free();
  T /= n;
  P /= n;
  const om = (g.rpm * 2 * Math.PI) / 60;
  const A = Math.PI * g.R * g.R;
  return { ct: T / (1.225 * A * (om * g.R) ** 2), cq: P / (1.225 * A * (om * g.R) ** 3), download: D / n / Math.max(T, 1e-9) };
}
/**
 * Сверка «опыт внутри полосы»: модель посчитана с гладкой (s) и шероховатой (r) поверхностью лопасти — шероховатость
 * настоящей лопасти в опыте не известна, и это не подбирается. Проходит, если опыт лежит между ними (с допуском tol);
 * иначе расхождение — от ближайшего края полосы.
 */
function bandCheck(diverge: Reporter['diverge'], info: Reporter['info'], name: string, s: number, r: number, meas: number, tol: number, why: string, unit = '') {
  const lo = Math.min(s, r), hi = Math.max(s, r);
  const near = Math.max(lo, Math.min(hi, meas));
  const pos = hi > lo ? ((meas - lo) / (hi - lo)) * 100 : NaN;
  diverge(`${name}: опыт ${meas.toPrecision(4)}${unit} между гладкой (${s.toPrecision(4)}) и шероховатой (${r.toPrecision(4)}) лопастью`, near, meas, tol, why, unit);
  if (Number.isFinite(pos)) info(`${name}: опыт на ${pos.toFixed(0)} % пути от ${s < r ? 'гладкой' : 'шероховатой'} к ${s < r ? 'шероховатой' : 'гладкой'}`);
}
/** Линейная интерполяция C_Q опыта по C_T (точки — пары [C_Q, C_T]). */
function cqAt(pts: [number, number][], ct: number) {
  const s = [...pts].sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < s.length; i++) {
    if (ct <= s[i][1]) {
      const x = (ct - s[i - 1][1]) / (s[i][1] - s[i - 1][1]);
      return s[i - 1][0] + x * (s[i][0] - s[i - 1][0]);
    }
  }
  return NaN;
}

function rotorRigs(RAPIER: typeof RAPIER_NS, { section, diverge, info }: Reporter) {
  // Knight & Hefner, NACA TN 626 (1937), таблицы I–IV: D = 5 ft, NACA 0015, хорда 2 in от r = 5 in до конца, без крутки,
  // около 960 об/мин (ΩR ≈ 76,6 м/с, Re на конце ≈ 2,4·10⁵). В отчёте C_T и C_Q вдвое больше нынешних — здесь поделены.
  // Точность по отчёту: тяга и момент ±1 %, малый момент ±2 %. Профиль: наклон 0,1 на градус и c_l,max 1,1 — для
  // симметричного профиля при Re ~2·10⁵ (оценка; на C_Q при данной C_T почти не влияет), k = 0,01 (значение модели по умолчанию).
  section('Винт на висении против стендовых замеров: Knight & Hefner, NACA TN 626 (модельные винты 5 ft)');
  const kh: Record<number, { sigma: number; rows: [number, number, number][] }> = {
    // лопастей: θ, C_T, C_Q (как в таблице TN 626, удвоенные)
    2: { sigma: 0.0424, rows: [[0, 0, 0.000108], [2, 0.000873, 0.000125], [4, 0.00248, 0.000191], [6, 0.00442, 0.000316], [8, 0.0065, 0.000494], [10, 0.00847, 0.000691], [12, 0.0099, 0.000878]] },
    4: { sigma: 0.0849, rows: [[0, 0, 0.000268], [2, 0.001042, 0.0003], [4, 0.00338, 0.00041], [6, 0.00645, 0.00062], [8, 0.00981, 0.00092], [10, 0.01382, 0.001395], [12, 0.01745, 0.00191]] },
  };
  for (const b of [2, 4]) {
    const d = kh[b];
    const meas = d.rows.map(([, ct, cq]) => [cq / 2, ct / 2] as [number, number]);
    const cd0 = (8 * meas[0][0]) / d.sigma; // профильная мощность при нулевой тяге: C_Q0 = σ·c_d0/8
    // Поляра — табличная NACA 0015 по числу Рейнольдса сечения (SAND80-2114), а не c_d0, снятый с этого же опыта:
    // так сверка независима. c_d0 по моменту при нулевой тяге печатается справочно.
    const g: Rig = { R: 0.762, root: 0.127, cRoot: 0.0508, cTip: 0.0508, blades: b, twistDeg: 0, rpm: 960,
      af: { name: 'NACA 0015', cl0: 0, clAlpha: 0.1 / deg, clMax: 1.1, cd0, k: 0.01, thickness: 0.15, polar: NACA0015 } };
    info(`${b} лопасти: c_d0 = ${cd0.toFixed(4)} по моменту при нулевой тяге (C_Q0 = ${meas[0][0].toExponential(2)})`);
    for (const th of [4, 8, 12]) {
      const m = hoverRig(RAPIER, g, th);
      const ref = d.rows.find((x) => x[0] === th)!;
      // Бюджет 5 %: момент ±1–2 % (отчёт); c_d0 перенесён с нулевой тяги на рабочую (рост сопротивления с C_L — по k модели, около ±3 %).
      diverge(`${b} лопасти, θ = ${th}°: C_Q при C_T модели ${m.ct.toExponential(3)}`, m.cq, cqAt(meas, m.ct), 0.05,
        'индуктивная мощность в модели — поток по кольцам (BEMT) с концевыми потерями Прандтля; поляра NACA 0015 при малых Re — расчётная (Эпплер, SAND80-2114), а не измеренная: у настоящего профиля при Re 1–2·10⁵ ламинарный пузырь даёт больше сопротивления Прандтля; у винта без крутки поток неравномернее, чем учитывает κ', '');
      info(`${b} лопасти, θ = ${th}°: C_T модели ${m.ct.toExponential(3)} против ${(ref[1] / 2).toExponential(3)} в опыте (${((m.ct / (ref[1] / 2) - 1) * 100).toFixed(1)} %; зависит от наклона c_l — оценки)`);
    }
  }

  // Carpenter, NACA TN 4357 (1958): полноразмерный винт на вышке (втулка на 1,57 R над землёй), R = 8,169 м, 2 лопасти,
  // хорда 0,417 м от 0,15 R до конца, NACA 0012, крутка −8° на радиус, σ = 0,0325. Рис. 6, огибающая при M_t 0,28–0,36
  // (чтение ±1·10⁻⁵ по C_Q). Профиль: наклон 0,105 на градус и c_l,max 1,4 — NACA 0012 при Re 2·10⁶ (Ladson, TM-4074).
  section('Винт на висении против замеров: полноразмерный винт на вышке (Carpenter, NACA TN 4357)');
  {
    const meas: [number, number][] = ([[3.2, 1.8], [3.9, 6.6], [6.3, 11.0], [7.9, 15.4], [9.1, 17.8], [11.3, 22.0], [14.7, 27.5], [16.9, 30.4], [18.9, 33.3],
      [21.9, 36.6], [24.1, 39.8], [27.6, 44.1], [30.9, 47.6], [35.4, 52.1], [38.9, 55.7], [43.4, 59.8]] as [number, number][]).map(([q, t]) => [q * 1e-5, t * 1e-4]);
    const sigma = 0.0325;
    // c_d0 — из первой точки опыта: C_Q за вычетом индуктивной части κ·C_T^1,5/√2 (при C_T = 1,8·10⁻⁴ она 6 % от C_Q).
    const cd0 = (8 * (meas[0][0] - (1.15 * meas[0][1] ** 1.5) / Math.SQRT2)) / sigma;
    info(`Carpenter: c_d0 = ${cd0.toFixed(4)} по наименьшей тяге опыта (у гладкого NACA 0012 при Re 2·10⁶ — 0,0062, Ladson)`);
    // Втулка на вышке — 1,57 R над землёй (TN 4357): винт в опыте немного под влиянием земли, и модель считает так же.
    const g: Rig = { R: 8.169, root: 0.15 * 8.169, cRoot: 0.417, cTip: 0.417, blades: 2, twistDeg: -8, rpm: (0.3 * 340.3 * 60) / (2 * Math.PI * 8.169), hubZ: 1.57 * 8.169,
      af: { name: 'NACA 0012', cl0: 0, clAlpha: 0.105 / deg, clMax: 1.4, cd0, k: 0.006, thickness: 0.12, polar: NACA0012 } };
    for (const th of [4, 7, 10]) {
      // Поляра — табличная NACA 0012 (Ladson: гладкий и с шероховатостью), поверхность лопастей в опыте не известна:
      // проверяется, что опыт лежит между гладкой и шероховатой лопастью. Отношение C_Q модели к C_Q опыта при той же C_T.
      const ms = hoverRig(RAPIER, { ...g, af: { ...g.af, surface: 0 } }, th);
      const mr = hoverRig(RAPIER, { ...g, af: { ...g.af, surface: 1 } }, th);
      bandCheck(diverge, info, `θ₀,₇₅ = ${th}°: C_Q модели / C_Q опыта при той же C_T`, ms.cq / cqAt(meas, ms.ct), mr.cq / cqAt(meas, mr.ct), 1, 0.06,
        'профиль и поверхность учтены по продувкам; недостающая мощность — вне профиля: у винта на вышке это втулка и комли лопастей, '
        + 'вихри у корня, закрутка следа', '');
      const m = hoverRig(RAPIER, g, th);
      // Бюджет 6 %: точность опыта ±3 % (отчёт), чтение графика ±1·10⁻⁵ (3–5 % на этих C_Q).
      diverge(`θ₀,₇₅ = ${th}°: C_Q при C_T = ${m.ct.toExponential(3)} (поверхность 0,5 — по умолчанию)`, m.cq, cqAt(meas, m.ct), 0.06,
        'индуктивная мощность — поток по кольцам (BEMT), поверхность лопасти 0,5 (между гладкой и шероховатой — по продувкам Ladson)', '');
    }

    // Сжимаемость на конце лопасти: тот же винт при M_t до 0,70 (TN 4357, рис. 8 и текст стр. 11). Наибольшая FM:
    // 0,75 при M_t 0,28 и 0,67 при 0,70 — числа из текста; 0,70 при 0,62 и 0,68 при 0,66 — с графика рис. 8 (±0,01).
    // Сравнивается отношение FM_max(M_t)/FM_max(0,28): от κ и c_d0 модели оно почти не зависит. FM ищется перебором
    // общего шага (6…12°, через 1°) с параболой через три лучшие точки.
    // Бюджет 4 %: чтение и округление FM ±0,01 у обеих (2 %); число Рейнольдса на конце растёт с 2,5 до 6,2·10⁶,
    // у настоящей лопасти c_d0 от этого падает примерно на 8 % (≈ +2,5 % к FM при M_t 0,70), а в модели c_d0 постоянный.
    const fmMax = (mt: number) => {
      const rig = { ...g, rpm: (mt * 340.3 * 60) / (2 * Math.PI * g.R) };
      const pts = [6, 7, 8, 9, 10, 11, 12].map((th) => { const m = hoverRig(RAPIER, rig, th); return { cl: (6 * m.ct) / sigma, fm: (Math.SQRT1_2 * m.ct ** 1.5) / m.cq }; });
      let i = pts.reduce((b, p, k) => (p.fm > pts[b].fm ? k : b), 0);
      i = Math.min(Math.max(i, 1), pts.length - 2);
      const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
      const den = a.fm - 2 * b.fm + c.fm;
      const x = den < 0 ? Math.max(-1, Math.min(1, (0.5 * (a.fm - c.fm)) / den)) : 0;
      return { fm: b.fm - 0.25 * (a.fm - c.fm) * x, cl: b.cl + 0.5 * x * (c.cl - a.cl) };
    };
    const base = fmMax(0.28);
    info(`Carpenter, M_t 0,28: FM_max модели ${base.fm.toFixed(3)} при c̄_l ${base.cl.toFixed(2)} (опыт 0,75 при c̄_l ≈ 0,8)`);
    for (const [mt, fmMeas] of [[0.62, 0.7], [0.66, 0.68], [0.7, 0.67]]) {
      const r = fmMax(mt);
      diverge(`M_t = ${mt}: FM_max / FM_max при M_t 0,28 (опыт ${(fmMeas / 0.75).toFixed(3)}; модель FM_max ${r.fm.toFixed(3)} при c̄_l ${r.cl.toFixed(2)})`, r.fm / base.fm, fmMeas / 0.75, 0.04,
        'рост сопротивления от сжимаемости в модели — формула Лока с M_dd по двумерному профилю (см. раздел о сжимаемости); у конца настоящей лопасти рост положе (трёхмерное обтекание конца), а c_d0 модели не уменьшается с ростом числа Рейнольдса', '');
    }
  }

  // Shivers & Carpenter, NACA TN 3850 (1956): винт с профилем NACA 63₂-015 — профиль лопасти R22 — на той же вышке.
  // 2 лопасти, R = 18,41 ft (5,611 м), хорда 13 in (0,330 м) постоянная, крутка −6,5° от оси до конца, σ = 0,0374;
  // c_d0 гладкой серийной лопасти 0,0086 (текст стр. 5). Вырез у корня в тексте не назван — взят 0,15 R (оценка;
  // на отношение мощностей почти не влияет). Профиль — тот же, что у лопасти R22 в модели, кроме c_d0.
  // Опыт (текст стр. 8): при M_t 0,71 и C_T ≈ 0,0037 (c̄_l ≈ 0,6) мощность от сжимаемости выросла всего на 4,4 %.
  // Сравнивается C_Q при C_T = 0,0037 и M_t 0,71 с C_Q при той же C_T и M_t 0,31 (без сжимаемости).
  // Бюджет 4 %: «about 4.4 percent» — округление (около 1 %); точность опыта ±3 % частью сокращается в отношении (около 2 %);
  // Re на конце растёт с 2,2 до 5,0·10⁶, у настоящей лопасти c_d0 от этого падает (около 2 %), в модели — нет.
  section('Винт с профилем R22 (NACA 63₂-015) при больших M_t: Shivers & Carpenter, NACA TN 3850');
  {
    const R = 5.611, sigma = 0.0374;
    const af = { ...r22.parts.find((p) => p.kind === 'blade')!.aero!.airfoil, cd0: 0.0086 };
    const g: Rig = { R, root: 0.15 * R, cRoot: 0.33, cTip: 0.33, blades: 2, twistDeg: -6.5, rpm: 0, af };
    const cqAtCt = (mt: number, ct: number) => {
      const rig = { ...g, rpm: (mt * 340.3 * 60) / (2 * Math.PI * R) };
      const pts = [9, 10, 11, 12].map((th) => { const m = hoverRig(RAPIER, rig, th); return [m.cq, m.ct] as [number, number]; });
      return cqAt(pts, ct);
    };
    const ct = 0.0037;
    {
      const cqS = (() => { const gg = { ...g, af: { ...g.af, surface: 0 } }; const rig = { ...gg, rpm: (0.31 * 340.3 * 60) / (2 * Math.PI * R) };
        return cqAt([9, 10, 11, 12].map((th) => { const m = hoverRig(RAPIER, rig, th); return [m.cq, m.ct] as [number, number]; }), ct); })();
      const cqR = (() => { const gg = { ...g, af: { ...g.af, surface: 1 } }; const rig = { ...gg, rpm: (0.31 * 340.3 * 60) / (2 * Math.PI * R) };
        return cqAt([9, 10, 11, 12].map((th) => { const m = hoverRig(RAPIER, rig, th); return [m.cq, m.ct] as [number, number]; }), ct); })();
      bandCheck(diverge, info, `M_t 0,31, C_T = ${ct}: C_Q`, cqS, cqR, 2.25e-4, 0.06,
        'поляра 63₂-015 — Report 824 (гладкий и со стандартной шероховатостью при 6·10⁶); у серийной лопасти TN 3850 c_d0 0,0086 — ближе к гладкой');
    }
    const lo = cqAtCt(0.31, ct), hi = cqAtCt(0.71, ct);
    // Сама мощность при малом M_t: рис. 2 TN 3850 (рендер 300 dpi с сеткой), при C_T = 0,0037 точки всех M_t ложатся
    // на C_Q ≈ 2,25·10⁻⁴ (±0,05·10⁻⁴), FM ≈ 0,71. Бюджет 6 %: чтение 2 %, точность опыта ±3 %, вырез у корня — оценка (около 1 %).
    diverge(`M_t 0,31, C_T = ${ct} (c̄_l = ${((6 * ct) / sigma).toFixed(2)}): C_Q (опыт 2,25·10⁻⁴, FM ≈ 0,71)`, lo, 2.25e-4, 0.06,
      'индуктивная мощность — поток по кольцам (BEMT); поляра 63₂-015 — Report 824, поверхность 0,5, чем учитывает κ (как у винта Carpenter)', '');
    diverge(`M_t 0,71 против 0,31 при C_T = ${ct}: рост мощности от сжимаемости (опыт +4,4 %)`, hi / lo, 1.044, 0.04,
      'M_dd модели — по двумерному NACA 0012 с поправкой −t/c на толщину: профиль 63₂-015 толщиной 15 % модель считает хуже 0012, '
      + 'а по опыту он не хуже (у 6-й серии разрежение у носка меньше, TN 4357 стр. 12: расходимость при M_t 0,70 на c̄_l 0,50 против 0,46 у 0012); '
      + 'на конце лопасти рост ещё положе из-за трёхмерного обтекания', '');
  }

  // Harrington, NACA TN 2318 (1951): ротор 1, D = 25 ft, 2 лопасти на винт, без крутки, хорда линейно от 0,315 м (на оси)
  // до 0,109 м (на конце), σ одиночного 0,027; соосный — два таких винта на 0,71 м друг над другом, вращаются навстречу.
  // ΩR = 500 ft/s. Рис. 4 (чтение ±0,3·10⁻⁵ по C_Q, ±0,3·10⁻⁴ по C_T). Для соосного C_T и C_Q — суммарные на площадь одного диска.
  // Вырез у корня в отчёте не прочитан — взят 0,2 R (оценка). Профиль: NACA 00xx, Re 0,8–1,3·10⁶, толщина от 30 % у корня
  // до 9 % на конце: наклон 0,1 на градус, c_l,max 1,2 (оценки), c_d0 — по моменту соосного винта при нулевой тяге.
  section('Соосный винт против замеров: Harrington, NACA TN 2318 (ротор 1)');
  {
    const sc = (pts: [number, number][]) => pts.map(([q, t]) => [q * 1e-5, t * 1e-4] as [number, number]);
    const single = sc([[3.3, 0.3], [3.4, 1.2], [4.0, 3.7], [4.1, 4.4], [5.2, 7.6], [6.0, 10.0], [6.7, 10.8], [7.0, 12.6], [7.8, 14.4], [8.9, 15.5],
      [10.3, 18.6], [11.6, 20.8], [13.0, 22.2], [13.4, 23.4], [15.7, 26.5], [17.3, 28.4], [19.0, 29.6], [19.3, 31.2], [23.5, 34.8]]);
    const coax = sc([[7.4, 0.3], [8.0, 2.5], [8.9, 6.8], [10.2, 10.4], [12.2, 15.3], [14.7, 20.3], [17.6, 25.0], [18.4, 25.9], [20.7, 30.3], [22.7, 31.2],
      [23.9, 32.9], [27.5, 37.6], [30.8, 42.2], [35.4, 45.9], [39.1, 49.3], [42.2, 52.0], [46.3, 55.6]]);
    const R = 3.81, root = 0.2 * R;
    const ch = (r: number) => 0.315 - ((0.315 - 0.109) * r) / R;
    const sigma = 0.027;
    const cd0 = (8 * 0.0000777) / 2 / sigma; // соосный при нулевой тяге: C_Q0 = 7,77·10⁻⁵ (текст) на два винта
    info(`Harrington: c_d0 = ${cd0.toFixed(4)} по моменту соосного винта при нулевой тяге (текст TN 2318)`);
    const g: Rig = { R, root, cRoot: ch(root), cTip: ch(R), blades: 2, twistDeg: 0, rpm: (152.4 * 60) / (2 * Math.PI * R),
      af: { name: 'NACA 00xx (как 0015)', cl0: 0, clAlpha: 0.1 / deg, clMax: 1.2, cd0, k: 0.006, thickness: 0.15, polar: NACA0015 } };
    const kint = String(KINT).replace('.', ',');
    // Бюджет 5 %: чтение графика по C_Q 0,3·10⁻⁵ и по C_T 0,3·10⁻⁴ (вместе 2–4 %), c_d0 по одной точке (около 1 %).
    for (const th of [6, 9, 12]) {
      const s1 = hoverRig(RAPIER, g, th);
      diverge(`одиночный, θ = ${th}°: C_Q при C_T = ${s1.ct.toExponential(3)}`, s1.cq, cqAt(single, s1.ct), 0.05,
        'поток по кольцам (BEMT); профиль NACA 00xx с толщиной от 30 % у корня — в модели табличная 0015 (оценка); винт без крутки и с сильным сужением', '');
    }
    // Шаг соосного меньше: пара даёт почти вдвое большую C_T (на площадь одного диска), замеры кончаются на 0,00556.
    for (const th of [4, 6, 8]) {
      const c1 = hoverRig(RAPIER, { ...g, coaxGap: 0.71 }, th, 1.15 * KINT);
      diverge(`соосный (κ_int = ${kint}), θ = ${th}°: C_Q при C_T = ${c1.ct.toExponential(3)}`, c1.cq, cqAt(coax, c1.ct), 0.05,
        'κ_int модели одинаков при любой тяге, а по опыту отношение мощности пары к двум отдельным винтам растёт с тягой (1,22 → 1,37 у ротора 1, 1,09 → 1,28 у ротора 2): '
        + 'при малой тяге модель завышает мощность, при большой занижает; профильное сопротивление толстых лопастей (до 30 % у корня) растёт с c_l быстрее параболы с k = 0,006', '');
      const old = hoverRig(RAPIER, { ...g, coaxGap: 0.71 }, th, 1.15 * 1.16);
      info(`то же с прежним κ_int = 1,16: C_Q ${((old.cq / cqAt(coax, old.ct) - 1) * 100).toFixed(1)} % от опыта при C_T = ${old.ct.toExponential(3)}`);
    }
    for (const ct of [0.003, 0.005]) {
      const pair = cqAt(coax, ct), two = 2 * cqAt(single, ct / 2);
      info(`опыт Харрингтона, ротор 1: при C_T = ${ct} мощность соосной пары / двух отдельных винтов с половинной тягой = ${(pair / two).toFixed(3)}`);
    }
  }

  // Harrington, NACA TN 2318, ротор 2 — независимая проверка κ_int: другой винт (металлические прямоугольные лопасти, хорда
  // 18 in = 0,457 м, без крутки, t/c линейно от 31 % на оси до 15 % на конце, σ одиночного 0,076), разнос 2,0 ft = 0,61 м.
  // Начало лопасти — около 34 in (0,23 R) по рис. 1(b) (сплошная линия t/c и фотография; ±2 in). Рис. 8, оцифровка
  // по рендеру (±1·10⁻⁵ по C_Q, ±1·10⁻⁴ по C_T) сверена с перерисовкой тех же точек у Syal (дисс. UMD 2008, рис. 4.2b).
  // Одиночный (нижний) винт снят в основном при ΩR = 262 ft/s, соосный — при 392 и 327 ft/s (точки ложатся на одну линию).
  // c_d0 — по наименьшей тяге одиночного винта (C_Q = 12,2·10⁻⁵ при C_T = 8,2·10⁻⁴) за вычетом индуктивной части κ·C_T^1,5/√2.
  section('Соосный винт против замеров: Harrington, NACA TN 2318 (ротор 2) — независимая проверка κ_int');
  {
    const sc = (pts: [number, number][]) => pts.map(([q, t]) => [q * 1e-5, t * 1e-4] as [number, number]);
    const single = sc([[12.2, 8.2], [12.8, 10.0], [13.6, 12.0], [17.2, 17.7], [17.2, 18.7], [18.6, 21.2], [20.0, 23.6], [23.0, 27.1], [24.6, 29.9], [28.0, 32.4],
      [35.2, 42.2], [38.2, 45.2], [43.2, 49.9], [52.6, 58.2]]);
    const coax = sc([[26.0, 20.4], [25.8, 22.0], [39.2, 38.7], [39.2, 40.3], [41.2, 42.0], [48.8, 50.1], [53.8, 54.2], [57.4, 57.6], [62.6, 62.5], [63.6, 64.2],
      [70.0, 68.2], [76.0, 74.5], [79.2, 74.7], [94.6, 87.2], [96.6, 88.0]]);
    const R = 3.81, sigma = 0.076;
    const cd0 = (8 * (single[0][0] - (1.15 * single[0][1] ** 1.5) / Math.SQRT2)) / sigma;
    info(`Harrington, ротор 2: c_d0 = ${cd0.toFixed(4)} по наименьшей тяге одиночного винта (Leishman & Syal для обоих роторов берут 0,011)`);
    const rpm = (fts: number) => (fts * FT * 60) / (2 * Math.PI * R);
    // Профиль: толщина на 0,75 R ≈ 19 %; наклон 0,1 на градус и c_l,max 1,2 — оценки (Re 1,9–2,8·10⁶ по Lim 2009).
    const g: Rig = { R, root: 0.23 * R, cRoot: 0.457, cTip: 0.457, blades: 2, twistDeg: 0, rpm: rpm(262),
      af: { name: 'NACA 00xx, t/c ≈ 0,19', cl0: 0, clAlpha: 0.1 / deg, clMax: 1.2, cd0, k: 0.006, thickness: 0.19 } };
    const kint = String(KINT).replace('.', ',');
    // Бюджет 7 %: чтение графика ±1·10⁻⁵ и ±1·10⁻⁴ (3–5 % на этих C_Q), c_d0 по одной точке и при другой ΩR, чем у соосного (около 2 %),
    // начало лопасти ±2 in (около 1 %). Шаг одиночного меньше: его замеры кончаются на C_T = 0,0058.
    for (const th of [4, 6, 8]) {
      const s1 = hoverRig(RAPIER, g, th);
      diverge(`одиночный, θ = ${th}°: C_Q при C_T = ${s1.ct.toExponential(3)}`, s1.cq, cqAt(single, s1.ct), 0.07,
        'поток по кольцам (BEMT); лопасть без крутки, широкая (σ = 0,076) и толстая', '');
    }
    for (const th of [4, 6, 8]) {
      const c1 = hoverRig(RAPIER, { ...g, rpm: rpm(392), coaxGap: 0.61 }, th, 1.15 * KINT);
      diverge(`соосный (κ_int = ${kint}), θ = ${th}°: C_Q при C_T = ${c1.ct.toExponential(3)}`, c1.cq, cqAt(coax, c1.ct), 0.07,
        'κ_int модели одинаков при любой тяге, а по опыту отношение мощности пары к двум отдельным винтам растёт с тягой (1,09 → 1,28)', '');
      const old = hoverRig(RAPIER, { ...g, rpm: rpm(392), coaxGap: 0.61 }, th, 1.15 * 1.16);
      info(`то же с прежним κ_int = 1,16: C_Q ${((old.cq / cqAt(coax, old.ct) - 1) * 100).toFixed(1)} % от опыта при C_T = ${old.ct.toExponential(3)}`);
    }
    for (const ct of [0.004, 0.006, 0.008]) {
      const pair = cqAt(coax, ct), two = 2 * cqAt(single, ct / 2);
      info(`опыт Харрингтона, ротор 2: при C_T = ${ct} мощность соосной пары / двух отдельных винтов с половинной тягой = ${(pair / two).toFixed(3)}`);
    }
    info('Cameron, Karpatne, Sirohi (J. Aircraft 53(3), 2016), винт 2,03 м, разнос 13,8 % R: индуктивная мощность верхнего винта +18 %, нижнего +49 % к отдельному — в среднем κ_int ≈ 1,33');
  }
}

// ---------- 5. R22 Beta II против графика потолка висения вне влияния земли (POH, стр. 5-10) ----------
// «Out of ground effect, zero wind, takeoff power or full throttle, 104 % RPM». У каждой линии температуры два участка:
// пологий — полный газ выше критической высоты (мощность падает с плотностью, данных мотора нет) и крутой у наибольшей
// массы — ниже критической высоты, где мощность ограничена взлётным наддувом, т. е. постоянна: 131 BHP = 97,7 кВт
// (толкование излома как критической высоты — оценка). Берутся точки крутого участка: излом и конец линии при 1370 lb.
// Чтение ±150 ft, ±3 lb. Плотность — по барометрической высоте МСА и температуре наружного воздуха.
/**
 * Висение без земли и без движения корпуса: корпус закреплён, общий шаг подбирается (метод секущих) так, чтобы тяга
 * несущего винта была равна весу; мощность — на валу с потерями трансмиссии и хвостового винта (как в программе висения).
 * Программа «Взлёт и висение» для этой сверки не годится: на малой плотности её регулятор высоты раскачивается (±3 м
 * у R22 при ρ = 1,05), и средняя мощность смещена.
 */
function trimHover(RAPIER: typeof RAPIER_NS, spec: Spec) {
  // Вне влияния земли: график POH — OGE, замер NASA Ames — изолированный ротор.
  const sim = new Sim(RAPIER, spec, { gravity: false, breakable: false, groundEffect: false });
  sim.lockRoot('fixed');
  const W = sim.totalMass * sim.g;
  const ch = spec.controls!.find((c) => c.role === 'lift')!;
  const ramp = Math.max(...spec.actuators.map((a) => (a.type === 'spinner' ? a.rampTime ?? 0 : 0)));
  const meas = (u: number) => {
    sim.channels[ch.channel] = u;
    sim.advance(3);
    let T = 0, P = 0, n = 0;
    let Ps = 0;
    sim.advance(2, () => { T += sim.rotors.reduce((x, r) => x + r.thrust, 0); P += sim.sample.power; Ps += sim.sample.shaftPower; n++; });
    return { T: T / n, P: P / n, Ps: Ps / n };
  };
  sim.channels[ch.channel] = ch.initial ?? 0;
  sim.advance(ramp + 1);
  let u0 = ch.initial ?? 0, m0 = meas(u0);
  let u1 = u0 + 0.05 * (ch.max - ch.min), m1 = meas(u1);
  for (let i = 0; i < 8 && Math.abs(m1.T / W - 1) > 5e-4; i++) {
    const u2 = u1 + ((W - m1.T) * (u1 - u0)) / (m1.T - m0.T);
    u0 = u1; m0 = m1; u1 = u2; m1 = meas(u1);
  }
  sim.free();
  const ok = Math.abs(m1.T / W - 1) < 5e-3;
  const x = (W - m1.T) / (m1.T - m0.T);
  return { power: ok ? m1.P + x * (m1.P - m0.P) : NaN, shaftPower: ok ? m1.Ps + x * (m1.Ps - m0.Ps) : NaN, control: u1, weight: W };
}

function r22Poh(RAPIER: typeof RAPIER_NS, { section, diverge, flag, info }: Reporter) {
  section('R22 Beta II против графика потолка висения вне влияния земли (POH, стр. 5-10)');
  const LB = 0.45359237;
  const pts: [number, number, number][] = [
    // OAT °C, масса lb, Hp ft
    [-20, 1370, 7550], [0, 1370, 5500], [20, 1370, 3700], [40, 1370, 2200],
    [-20, 1363, 8000], [40, 1327, 5450],
  ];
  const fixed = r22.parts.filter((p) => p.id !== 'fuselage').reduce((s, p) => s + (p.mass ?? 0), 0);
  const ratios: number[] = [];
  for (const [oat, lb, ft] of pts) {
    const h = ft * FT;
    const p = 101325 * (1 - 2.25577e-5 * h) ** 5.25588; // давление МСА
    const T = oat + 273.15;
    const rho = p / (287.053 * T);
    const spec = applyAssumptions(r22, { 'parts[fuselage].mass': lb * LB - fixed });
    spec.environment = { ...spec.environment, rho, soundSpeed: 20.0468 * Math.sqrt(T) };
    const P = trimHover(RAPIER, spec).power;
    ratios.push(P / (131 * HP));
    const withSurface = (sf: number) => {
      const s2 = structuredClone(spec);
      for (const pp of s2.parts) if (pp.kind === 'blade' && pp.aero) pp.aero.airfoil = { ...pp.aero.airfoil, surface: sf, polar: pp.aero.airfoil.polar };
      return trimHover(RAPIER, s2).power;
    };
    bandCheck(diverge, info, `${lb} lb, ${oat > 0 ? '+' : ''}${oat} °C, ${ft} ft: мощность висения против взлётной 131 BHP`, withSurface(0), withSurface(1), 131 * HP, 0.05,
      'даже с шероховатыми лопастями модель висит на меньшей мощности, чем настоящий R22; поляры и поверхность лопастей — по продувкам, '
      + 'хвостовой винт — по его размерам; не учтены: вентилятор охлаждения мотора, втулка и комли лопастей, генератор; толкование '
      + 'крутого участка графика POH как взлётной мощности — оценка', ' Вт');
    // Бюджет 5 %: толкование мощности на крутом участке как взлётной (оценка, около 3 %); доля хвостового винта
    // и трансмиссии 0,15 в модели — оценка (0,10–0,17, около 3 %); чтение графика — меньше 1 %.
    diverge(`${lb} lb, ${oat > 0 ? '+' : ''}${oat} °C, ${ft} ft (ρ = ${rho.toFixed(3)} кг/м³): мощность висения = взлётной 131 BHP`, P, 131 * HP, 0.05,
      'модель висит на меньшей мощности, чем настоящий R22: нет нагрузки «вниз» от струи винта на кабине (обычно 2–5 % тяги), '
      + 'доля хвостового винта и трансмиссии — постоянные 15 % (оценка); толкование крутого участка графика как взлётной мощности 131 BHP — оценка. '
      + 'Сам несущий винт, по-видимому, не причина: винт того же профиля 63₂-015 (TN 3850, сверка выше) модель считает на 5 % дороже опыта, '
      + 'а рост сопротивления от сжимаемости при M_t 0,62–0,67 по тому же опыту мал (+4,4 % только при M_t 0,71) и в модели добавляет около 1 %', ' Вт');
  }
  // Форма кривой: при постоянной мощности тяжёлый аппарат в плотном воздухе и лёгкий в разреженном должны требовать
  // одного и того же. Постоянный сдвиг (кабина, доля хвостового винта) на отношение не влияет: сравнивается излом
  // при 1327 lb (ρ 0,922) со средним по концам линий при 1370 lb (ρ 1,04–1,055).
  // Допуск 2 %: чтение ±150 ft и ±5 lb на изломе — около 1 %, толкование излома (оценка) — около 1 %.
  const ends = ratios.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  diverge('R22: мощность у излома линии +40 °C (1327 lb, ρ 0,922) / у концов линий при 1370 lb — по POH обе взлётные', ratios[5] / ends, 1, 0.02,
    'в модели мощность с падением плотности растёт быстрее, чем у настоящего R22: в разреженном воздухе лопасти работают на большем c_l, а сопротивление профиля в модели растёт с c_l по параболе с k = 0,006 (оценка)', '');
  void flag;
}


// ---------- 6. Малый винт: квадрокоптер и винт APC против стендовых замеров ----------
function props(RAPIER: typeof RAPIER_NS, { section, diverge, info }: Reporter) {
  // NASA Ames, Russell et al., AHS Forum 72 (2016), рис. 40: изолированный ротор DJI Phantom 3 (9450, D = 9,4 in) на стенде,
  // мотор и регулятор — от 3DR Iris+. Мощность на валу — по измеренному моменту; чтение графика ±1,5 Вт, плотность не указана.
  // Тяга на ротор — по C_T рис. 39 при ρ = 1,20 (пересчёт). Phantom 4 стоит на винтах 9450S того же размера.
  section('Квадрокоптер: ротор на висении против замера NASA Ames на роторе DJI 9450');
  const nasa: [number, number, number, number][] = [
    // RPM, тяга на ротор Н (пересчёт), P_вал Вт, КПД мотор+регулятор
    [4500, 2.64, 20.1, 0.725], [5000, 3.25, 27.5, 0.73], [5300, 3.54, 31.5, 0.73], [5500, 3.84, 36.1, 0.745], [6000, 4.69, 47.5, 0.748],
  ];
  const at = (T: number, k: 2 | 3) => {
    for (let i = 1; i < nasa.length; i++) if (T <= nasa[i][1]) {
      const x = (T - nasa[i - 1][1]) / (nasa[i][1] - nasa[i - 1][1]);
      return nasa[i - 1][k] + x * (nasa[i][k] - nasa[i - 1][k]);
    }
    return NaN;
  };
  const spec = applyAssumptions(quadcopter);
  const h = trimHover(RAPIER, spec);
  const nRot = spec.actuators.filter((a) => a.type === 'spinner').length;
  const T = h.weight / nRot;
  // Бюджет 8 %: чтение графика ±1,5 Вт (5 %), неизвестная плотность в опыте (около 1 %), 9450 против 9450S (оценка, около 5 %).
  diverge(`мощность на валу одного ротора при тяге ${T.toFixed(2)} Н (вес Phantom 4 на четыре ротора)`, h.shaftPower / nRot, at(T, 2), 0.08,
    'геометрия лопасти в модели (хорда, крутка, угол установки) и профиль малых чисел Рейнольдса — оценки, а не замер настоящего винта 9450', ' Вт');
  // КПД мотора с регулятором: в модели 1/(1 + 0,33) = 0,75; в опыте — у мотора Iris+, а не DJI 2312: допуск 5 %.
  diverge('КПД мотора с регулятором на висении: модель 1/(1 + потери) против замера NASA на том же режиме', 1 / (1 + (spec.powerplant.losses ?? 0)), at(T, 3), 0.05,
    'в опыте мотор и регулятор от другого аппарата (3DR Iris+); КПД мотора DJI 2312 не опубликован', '');
  info(`квадрокоптер: электрическая мощность висения модели ${(h.power).toFixed(0)} Вт; по паспорту DJI 81,3 Вт·ч за 28 мин — около 174 Вт в среднем за полёт (не висение, верхняя граница)`);

  // UIUC Propeller Data Site, том 1: APC 9x4.7 SF, геометрия (apcsf_9x4.7_geom.txt) и статические испытания
  // (apcsf_9x4.7_static_kt1032.txt). В модели у лопасти хорда и крутка линейны: обе приближены по геометрии UIUC
  // методом наименьших квадратов с весом r² (так распределена тяга). Профиль — тот же, что у квадрокоптера в модели
  // (тонкий профиль малых Re: c_l0 0,3, наклон 5,0, c_d0 0,02 — оценки); проверка заодно проверяет эти оценки.
  section('Винт APC 9x4.7 SF, собранный по измеренной геометрии, против статических испытаний UIUC');
  const geom: [number, number, number][] = [
    [0.15, 0.127, 27.54], [0.2, 0.135, 25.28], [0.25, 0.158, 26.08], [0.3, 0.178, 25.47], [0.35, 0.195, 24.07], [0.4, 0.209, 22.18], [0.45, 0.219, 20.0],
    [0.5, 0.225, 18.18], [0.55, 0.227, 16.38], [0.6, 0.226, 14.83], [0.65, 0.221, 13.63], [0.7, 0.212, 12.56], [0.75, 0.199, 11.56], [0.8, 0.182, 10.65],
    [0.85, 0.161, 9.68], [0.9, 0.135, 8.51], [0.95, 0.097, 6.72], [1.0, 0.058, 4.89],
  ];
  const fit = (k: 1 | 2) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const g of geom) { const w = g[0] ** 2; sw += w; sx += w * g[0]; sy += w * g[k]; sxx += w * g[0] ** 2; sxy += w * g[0] * g[k]; }
    const b = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
    return { at: (r: number) => (sy - b * sx) / sw + b * r };
  };
  const c = fit(1), beta = fit(2);
  const Rp = 0.1143;
  const af = quadcopter.parts.find((p) => p.kind === 'blade')!.aero!.airfoil;
  // Угол установки модели отсчитывается от хорды; β UIUC — тоже от хорды. Крутка — по прямой β(r), на радиус.
  const rig: Rig = { R: Rp, root: 0.15 * Rp, cRoot: c.at(0.15) * Rp, cTip: c.at(1) * Rp, blades: 2, twistDeg: (beta.at(1) - beta.at(0)), rpm: 5000, af };
  const m = hoverRig(RAPIER, rig, beta.at(0.75));
  const n = 5000 / 60, D = 2 * Rp;
  const om = 2 * Math.PI * n;
  const A = Math.PI * Rp * Rp;
  const CT = (m.ct * 1.225 * A * (om * Rp) ** 2) / (1.225 * n * n * D ** 4);
  const CP = (m.cq * 1.225 * A * (om * Rp) ** 3) / (1.225 * n ** 3 * D ** 5);
  const fm = (ct: number, cp: number) => ct ** 1.5 / (cp * Math.sqrt(Math.PI / 2));
  const ref = { ct: 0.1175, cp: 0.0481 }; // 4942 об/мин
  // Бюджет 5 %: точность стенда UIUC по C_T и C_P около 2–3 % (FM ∝ C_T^1,5/C_P), чтение геометрии «approximately».
  diverge(`FM = C_T^1,5/(C_P·√(π/2)) при 5000 об/мин: модель (C_T ${CT.toFixed(4)}, C_P ${CP.toFixed(4)}) против опыта (C_T ${ref.ct}, C_P ${ref.cp})`, fm(CT, CP), fm(ref.ct, ref.cp), 0.05,
    'профиль лопасти — оценка для малых чисел Рейнольдса (Re ≈ 7·10⁴), а хорда и крутка в модели линейны; у настоящего APC хорда наибольшая на середине лопасти', '');
  info(`APC 9x4.7 SF: C_T модели ${CT.toFixed(4)} против ${ref.ct} (${((CT / ref.ct - 1) * 100).toFixed(1)} %), C_P ${CP.toFixed(4)} против ${ref.cp} (${((CP / ref.cp - 1) * 100).toFixed(1)} %) — зависят от наклона и c_l0 профиля, оценок`);
}


// ---------- 7. Махолёты против опубликованных измерений ----------
function flappers(RAPIER: typeof RAPIER_NS, { section, diverge, info }: Reporter) {
  // Festo SmartBird: Send et al., ICAS 2012, paper 053. Свободный горизонтальный полёт 4,7 м/с — 18 Вт электрической
  // мощности, из них сервоприводы около 5 Вт [измерение]. КПД электропривода по тормозу Прони в привязанном полёте ≈ 0,34
  // (рис. 5, ±0,02), в брошюре Festo — «около 45 %». Мощность на валу настоящего аппарата: 13 Вт × (0,34…0,45) = 4,4–5,9 Вт.
  // С этим сравнивается мощность на валах модели — от оценки потерь привода она не зависит.
  section('Festo SmartBird против статьи Send et al. (ICAS 2012)');
  {
    const spec = applyAssumptions(smartbird);
    const r = run(RAPIER, spec, 'tunnel', { windSpeed: 4.7 });
    const t = r.tunnel!;
    const shaft = t.power / (1 + (spec.powerplant.losses ?? 0));
    // Допуск 14 %: середина диапазона 4,4–5,9 Вт и его половина — расхождение двух значений КПД привода в одной статье.
    diverge('мощность на валах в горизонтальном полёте 4,7 м/с против 13 Вт × КПД привода 0,34–0,45', shaft, 13 * (0.34 + 0.45) / 2, (0.45 - 0.34) / (0.34 + 0.45),
      'размах взмаха (±25°) и закручивание крыла SmartBird не опубликованы — в модели это оценки', ' Вт');
    info(`SmartBird: электрическая мощность модели ${t.power.toFixed(1)} Вт (КПД привода 0,34) против 13 Вт без сервоприводов; запас тяги ${(t.netThrustMaxToWeight * 100).toFixed(1)} % веса — сопротивление подобрано под L/D ≈ 7 из той же статьи, поэтому не проверка`);
  }

  // UTIAS Snowbird: Reichert, PhD thesis, U of Toronto, 2011, гл. 12; досье рекорда для FAI (2010).
  // Кинематика модели — из диссертации: 0,65 Гц, ход законцовки ±1,0 м, закрутка ±7°, машут панели от 6 м.
  // Полёт: ρ = 1,185 кг/м³, 7,1 м/с, 114,3 кг.
  section('UTIAS Snowbird против диссертации Reichert (2011) и данных рекордного полёта');
  const env = { ...snowbird.environment, rho: 1.185 };
  {
    // Сопротивление в планировании: 54,0 Н при 7,1 м/с — по планированию и буксировке с динамометром (табл. 12.1).
    // Модель: крылья не машут, корпус закреплён в потоке, угол установки — подъёмная сила равна весу.
    const spec = applyAssumptions(snowbird);
    spec.environment = env;
    for (const a of spec.actuators) if (a.type === 'oscillator') a.amplitudeDeg = 0;
    const sim = new Sim(RAPIER, spec, { wind: v3(-7.1, 0, 0), breakable: false });
    sim.lockRoot('fixed');
    sim.channels.feather = 0; // без закручивания: крыло неподвижно
    const W = sim.totalMass * sim.g;
    const meas = (u: number) => {
      sim.channels.pitch = u;
      sim.advance(3);
      let L = 0, D = 0, n = 0;
      sim.advance(1, () => { L += sim.sample.aeroForce.y; D -= sim.sample.aeroForce.x; n++; });
      return { L: L / n, D: D / n };
    };
    let u0 = 3, m0 = meas(u0), u1 = 5, m1 = meas(u1);
    for (let i = 0; i < 6 && Math.abs(m1.L / W - 1) > 1e-3; i++) {
      const u2 = u1 + ((W - m1.L) * (u1 - u0)) / (m1.L - m0.L);
      u0 = u1; m0 = m1; u1 = u2; m1 = meas(u1);
    }
    sim.free();
    info(`Snowbird в планировании: подъёмная сила ${(m1.L / W).toFixed(3)} веса при угле установки ${u1.toFixed(2)}°`);
    // Допуск 10 %: точность «динамометра и планирования» в диссертации не приведена; высота испытаний (влияние земли) не указана.
    diverge('Snowbird: сопротивление в планировании при 7,1 м/с, крылья неподвижны: 54,0 Н (Reichert 2011, табл. 12.1, измерение)',
      Math.abs(m1.L / W - 1) < 5e-3 ? m1.D : NaN, 54, 0.1,
      'вредное сопротивление корпуса 0,12 м² и c_d0 профиля 0,012 — оценки; по разбивке авторов на корпус, тросы и оперение приходится около 20 Н (C_D·S ≈ 0,69 м²), а профильное сопротивление крыла около 0,022', ' Н');
  }
  {
    // Рекордный полёт 2 августа 2010: 19,3 с, полная энергия (высота + скорость) почти постоянна — в начале 4,87 м и 7,43 м/с,
    // в конце 4,90 м и 7,52 м/с (досье FAI; по графику диссертации — медленный спад 8,6 → 8,2 кДж). Значит, тяга равнялась
    // сопротивлению с точностью около 5 % от D·V. Полёт шёл на 2,2–3,7 м над землёй при размахе 32 м: влияние земли
    // снижает индуктивное сопротивление примерно на треть (13,9 Н из 54 по разбивке авторов) — около 8,5 % сопротивления.
    // Модель без земли: наибольшая тяга минус сопротивление должна быть около −0,085·54 = −4,6 Н, т. е. «тяга/сопротивление» ≈ 0,915.
    const spec = applyAssumptions(snowbird);
    spec.environment = env;
    const r = run(RAPIER, spec, 'tunnel', { windSpeed: 7.1 });
    const t = r.tunnel!;
    const ratio = t.trimmed ? 1 + t.netThrustMax / 54 : NaN;
    // Допуск 6 %: энергия по GPS и видео ±0,2 кДж за 19,3 с (около 3 % сопротивления), оценка влияния земли (около 3 %).
    diverge('Snowbird: (сопротивление + наибольший избыток тяги) / сопротивление 54 Н — в настоящем полёте ≈ 0,915 (без влияния земли)', ratio, 0.915, 0.06,
      'с опубликованной кинематикой (закрутка законцовки не больше ±7°) законцовка ходит при кинематическом угле атаки около ±23° и в модели почти всё время в срыве. '
      + 'Вихрь динамического срыва в модели есть (Беддоуз — Лейшман с опубликованными постоянными NACA 0012), но по сверке с измеренными петлями NACA 0012 '
      + '(раздел «Динамический срыв» выше) модель при Re 0,5–1·10⁶ занижает наибольший C_L на 25–35 %, а среднюю за цикл нормальную силу на 9–28 % (больше всего при качании от 0 до 20°, как у законцовки): статический срыв '
      + 'при малых Re ранний, а при качании обтекание держится до 18–20°. У законцовки Snowbird Re ≈ 3·10⁵, k ≈ 0,19 — тот же режим. Расчёт авторов даёт C_L до 1,9–2,3. '
      + 'Прежде Snowbird «летал на пределе», потому что закрутка была ±45°, а размах взмаха подобран под оценку мощности пилота', '');
    {
      // Справочно: то же без вихря — сколько дал вихрь.
      const saved = DYNAMIC_STALL.vortex;
      DYNAMIC_STALL.vortex = false;
      const s0 = applyAssumptions(snowbird);
      s0.environment = env;
      const t0 = run(RAPIER, s0, 'tunnel', { windSpeed: 7.1 }).tunnel!;
      DYNAMIC_STALL.vortex = saved;
      info(`Snowbird без вихря динамического срыва: (сопротивление + избыток тяги) / сопротивление ${t0.trimmed ? (1 + t0.netThrustMax / 54).toFixed(3) : 'нет балансировки'} (с вихрем ${ratio.toFixed(3)})`);
    }
    info(`Snowbird в трубе с опубликованной кинематикой: подъёмная сила ${(t.liftToWeight * 100).toFixed(0)} % веса, избыток тяги ${t.netThrustMax.toFixed(1)} Н, мощность без возврата ${t.power.toFixed(0)} Вт, с возвратом ${(t.powerRecovered ?? 0).toFixed(0)} Вт (расчёт авторов — 620–680 Вт, оценка пилота — 600–700 Вт на рабочем ходе; измерений нет)`);
  }
}
