// Проверка ядра (ТЗ, раздел 12). Запуск: npm run check
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, SpecError } from '../core/sim.ts';
import { type Spec, applyAssumptions } from '../core/spec.ts';
import { ornithopter } from '../presets/ornithopter.ts';
import { cessna172 } from '../presets/cessna172.ts';
import { r22 } from '../presets/r22.ts';
import { quadcopter } from '../presets/quadcopter.ts';
import { REFERENCE } from '../presets/reference.ts';
import { ProgramRun, type ProgramId, type ProgramOptions } from '../core/programs.ts';
import { analyze } from '../core/analyze.ts';
import { MATERIALS } from '../core/materials.ts';
import { dot, v3, deg } from '../core/vec.ts';
import { checkDesign, normalizeDesign, COAXIAL_INTERFERENCE, type Design } from '../core/design.ts';
import { sectionAt } from '../core/section.ts';
import { stationStress } from '../core/strength.ts';
import { DESIGNS } from '../presets/designs.ts';
import { generate } from '../server/generate.ts';
import { smartbird, snowbird } from '../presets/flappers.ts';
import { Replay } from '../web/recorder.ts';
import { solveInverse } from '../core/inverse.ts';
import { bemtHover } from '../core/tailrotor.ts';
import { buildReport, numbersIn, resultDigest } from '../core/report.ts';
import { buildVehicle, decodeState, encodeState, programOptions, type TestState } from '../core/vehicle.ts';
import { sensitivity } from '../core/sensitivity.ts';
import { readFileSync } from 'node:fs';
import { checkImage } from '../server/image.ts';
import { IMAGE_CASES, scoreCase } from '../tools/image-cases.ts';
import { setLang, td } from '../core/i18n.ts';
import { physicsChecks, makeReporter } from './physics.ts';
import { validationChecks } from './validation.ts';
import { PRESETS } from '../presets/index.ts';
import { createServer } from 'node:http';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { wireState } from '../core/vehicle.ts';
import { Series } from '../web/recorder.ts';
import { makeSnapshot } from '../web/snapshot.ts';

const WOOD = MATERIALS.spruce ? 'spruce' : 'al7075';

await RAPIER.init();

const { rep, n: count, summary } = makeReporter();
const { report, flag, section, diverge, info } = rep;

// ---------- Уровень 1: инерция машущего крыла (сверки этапа 0 на новом ядре) ----------
section('Машущее крыло на привязном стенде, без воздуха');
for (const freq of [20, 5]) {
  const spec: Spec = applyAssumptions(ornithopter);
  const osc = spec.actuators[0] as Extract<Spec['actuators'][number], { type: 'oscillator' }>;
  osc.freqHz = freq;
  osc.rampTime = 0;
  const sim = new Sim(RAPIER, spec, { aero: false, breakable: false });
  sim.lockRoot('fixed');
  const w = sim.partById.get('R1')!;
  const j = w.joint!;
  const A = osc.amplitudeDeg * deg;
  const om = 2 * Math.PI * freq;
  // Момент инерции крыла относительно шарнира по тем же элементам, что и в модели.
  const Ih = w.elements.reduce((s, e) => s + e.mass * (e.r.z * e.r.z + e.r.y * e.r.y), 0);
  const firstMoment = w.elements.reduce((s, e) => s + e.mass * Math.abs(e.r.z), 0);
  let mPeak = 0;
  let nPeak = 0;
  const period = 1 / freq;
  sim.advance(3 * period, () => {
    if (sim.t < period) return;
    mPeak = Math.max(mPeak, Math.abs(dot(j.moment, v3(1, 0, 0))));
    nPeak = Math.max(nPeak, w.stations[0].sigmaTension > 0 ? -dot(j.force, v3(0, 0, 1)) : 0);
  });
  report(`${freq} Гц: момент в шарнире I·A·ω²`, mPeak, Ih * A * om * om, 0.02, ' Н·м');
  report(`${freq} Гц: центробежная сила Σm·r·(A·ω)²`, nPeak, firstMoment * (A * om) ** 2, 0.02, ' Н');
  sim.free();
}

// ---------- Уровень 1: аэродинамика против формул ----------
const airfoil0 = { cl0: 0, clAlpha: 2 * Math.PI * 0.9, clMax: 1.5, cd0: 0.01, k: 0, thickness: 0.12 };
const base = (parts: Spec['parts'], joints: Spec['joints'], actuators: Spec['actuators'] = []): Spec => ({
  schema: 1,
  meta: { name: 'тест', class: 'fixed-wing', source: 'preset' },
  environment: { name: 'Земля', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
  parts: [{ id: 'body', kind: 'body', position: [0, 2, 0], shape: { type: 'box', size: [1, 1, 1] }, mass: 100 }, ...parts],
  joints,
  actuators,
  powerplant: { power: 1e6 },
  crew: { part: 'body', seats: [[0, 0, 0]] },
  assumptions: [],
});

section('Прямое крыло в трубе: теория несущей линии');
for (const aDeg of [2, 6]) {
  const spec = base(
    [{ id: 'w', kind: 'wing', position: [0, 2, 0.5], mass: 10,
       aero: { side: 1, span: 5, rootChord: 1, tipChord: 1, incidenceDeg: aDeg, airfoil: airfoil0, induced: 'wing', sections: 12 } }],
    [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }],
  );
  const V = 30;
  // Теория несущей линии — для крыла вдали от земли (крыло здесь на 2 м при размахе 10 м — у земли).
  const sim = new Sim(RAPIER, spec, { wind: v3(-V, 0, 0), gravity: false, groundEffect: false });
  sim.lockRoot('fixed');
  sim.advance(0.5);
  const w = sim.partById.get('w')!;
  const a0 = airfoil0.clAlpha;
  const AR = 10;
  const CL = (a0 * aDeg * deg) / (1 + a0 / (Math.PI * 0.9 * AR));
  const q = 0.5 * 1.225 * V * V;
  const S = 5;
  report(`α = ${aDeg}°: подъёмная сила`, w.aeroForce.y, q * S * CL, 0.02, ' Н');
  report(`α = ${aDeg}°: сопротивление`, -w.aeroForce.x, q * S * (airfoil0.cd0 + (CL * CL) / (Math.PI * 0.9 * AR)), 0.02, ' Н');
  sim.free();
}

section('Винт на висении: импульсная теория + профильная мощность');
{
  const R0 = 0.3;
  const span = 3;
  const c = 0.2;
  const blade = (id: string, z: number, rot: number) => ({
    id, kind: 'blade' as const, position: [0, 2, z] as [number, number, number], rotation: [0, rot, 0] as [number, number, number], mass: 8,
    aero: { side: 1 as const, span, rootChord: c, tipChord: c, incidenceDeg: 8, airfoil: { ...airfoil0, clAlpha: 5.7, clMax: 1.4 }, sections: 16 },
  });
  const spec = base(
    [
      { id: 'hub', kind: 'hub', position: [0, 2, 0], shape: { type: 'cylinder', size: [0.3, 0.2, 0.3] }, mass: 5 },
      blade('b1', R0, 0),
      blade('b2', -R0, 180),
    ],
    [
      { id: 'mast', type: 'revolute', parent: 'body', child: 'hub', axis: [0, 1, 0] },
      { id: 'f1', type: 'fixed', parent: 'hub', child: 'b1' },
      { id: 'f2', type: 'fixed', parent: 'hub', child: 'b2' },
    ],
    [{ id: 'rotor', type: 'spinner', joint: 'mast', rpm: 400, direction: 1, rampTime: 1 }],
  );
  spec.meta.class = 'rotor';
  // Эта проверка — для прежней модели потока (равномерный по диску × κ); модель по кольцам сверяется ниже.
  const sim = new Sim(RAPIER, spec, { gravity: false, groundEffect: false, rotorInflow: 'uniform' });
  sim.lockRoot('fixed');
  sim.advance(2);
  let T = 0;
  let P = 0;
  let n = 0;
  const mast = sim.joints.find((j) => j.spec.id === 'mast')!;
  sim.advance(1, () => {
    T += sim.rotors[0].thrust;
    P += mast.shaftPower;
    n++;
  });
  T /= n;
  P /= n;
  const Rt = R0 + span;
  const A = Math.PI * Rt * Rt;
  const Om = (400 * 2 * Math.PI) / 60;
  const Pi = 1.15 * T * Math.sqrt(T / (2 * 1.225 * A)); // κ = 1,15
  const P0 = 2 * 0.5 * 1.225 * airfoil0.cd0 * c * Om ** 3 * (Rt ** 4 - R0 ** 4) / 4;
  console.log(`  тяга ${T.toFixed(0)} Н, индуктивная скорость ${sim.rotors[0].inflow.toFixed(2)} м/с, концевые потери B = ${sim.rotors[0].tipLoss.toFixed(3)}`);
  report('мощность на валу = κ·T·vᵢ + профильная', P, Pi + P0, 0.02, ' Вт');
  sim.free();
  // Поток по кольцам (BEMT) в расчёте на телах Rapier против независимой стационарной реализации BEMT (tailrotor.ts):
  // тот же винт, тот же шаг; две разные программы должны дать одно и то же.
  const sb = new Sim(RAPIER, spec, { gravity: false, groundEffect: false });
  sb.lockRoot('fixed');
  sb.advance(3);
  let Tb = 0, Pb = 0, nb = 0;
  const mastB = sb.joints.find((j) => j.spec.id === 'mast')!;
  sb.advance(1, () => { Tb += sb.rotors[0].thrust; Pb += mastB.shaftPower; nb++; });
  sb.free();
  const ref = bemtHover({ radius: Rt, blades: 2, chord: c, rpm: 400, arm: 1, rootFrac: R0 / Rt, airfoil: { ...airfoil0, clAlpha: 5.7, clMax: 1.4 } }, 8, 1.225, 340.3);
  report('поток по кольцам (BEMT): тяга в расчёте против стационарной BEMT', Tb / nb, ref.T, 0.03, ' Н');
  report('поток по кольцам (BEMT): мощность в расчёте против стационарной BEMT', Pb / nb, ref.P, 0.03, ' Вт');
}

// ---------- Уровень 2: эталонные аппараты ----------
const runProgram = (spec: Spec, id: ProgramId, o: ProgramOptions = {}) => {
  const run = new ProgramRun(RAPIER, spec, id, o);
  const r = run.runToEnd();
  run.free();
  return { r, v: analyze(r) };
};

section('Cessna 172S');
{
  // Сваливание, наибольшая скорость и крейсерская мощность сверяются с таблицами POH в разделе «Сверка
  // с реальными измерениями» (src/cli/validation.ts), с допусками по погрешности эталона. Прежние сверки здесь
  // шли с допуском ТЗ 20 %, а сваливание — с V_A/√3,8 вместо таблицы сваливания POH (53 KCAS).
  const { v } = runProgram(applyAssumptions(cessna172), 'flight');
  flag('вердикт у земли — «Летает»', v.kind === 'flies', v.title);
  const mx = runProgram(applyAssumptions(cessna172), 'max');
  // Зависимая проверка: сечение лонжерона подобрано так, чтобы запас при 1 g был около 5,7 (разрушающая
  // перегрузка нормальной категории). Запас 1,5 при 3,8 g из этого следует; с реальным крылом не сверено.
  flag('манёвр с расчётной перегрузкой: запас не меньше 1,5 (зависимая: сечение лонжерона подобрано под этот запас)', mx.r.minMargin >= 1.5,
    `перегрузка ${mx.r.flight?.loadFactor?.toFixed(2)}, запас ${mx.r.minMargin.toFixed(2)}`);
}

section('Robinson R22');
{
  const { r, v } = runProgram(applyAssumptions(r22), 'hover');
  flag('висение у земли удержано', !!r.hover?.achieved, `общий шаг ${r.hover?.channel.toFixed(1)}°, мощность ${((r.hover?.power ?? 0) / 1e3).toFixed(1)} кВт`);
  flag('вердикт у земли — «Летает»', v.kind === 'flies', v.title);
  // Прежняя сверка «мощность на потолке HOGE 5000 ft против 131 л. с.» шла через программу висения с допуском ТЗ 20 %.
  // На этой высоте регулятор высоты программы раскачивался (±3 м), висение не засчитывалось, а средняя мощность была смещена;
  // регулятор исправлен (programs.ts). Сверка с графиком потолка висения POH (шесть точек, корпус закреплён, тяга = вес) —
  // в src/cli/validation.ts.
  const ceil = runProgram(applyAssumptions(r22), 'hover', { altitude: REFERENCE.r22Hover.altitude });
  flag('R22: программа висения на 1524 м удерживает высоту (регулятор не раскачивается)', !!ceil.r.hover?.achieved, `средняя мощность ${((ceil.r.hover?.power ?? 0) / 1e3).toFixed(1)} кВт`);
}

section('Квадрокоптер 1,4 кг');
{
  const { r } = runProgram(applyAssumptions(quadcopter), 'hover');
  flag('висение удержано', !!r.hover?.achieved);
  // 174 Вт — средняя мощность за полёт по паспорту (81,3 Вт·ч за 28 мин), а не мощность висения: в полёте вперёд мощность
  // меньше, а полный заряд до нуля не расходуется. Как эталон висения не годится — оставлено справочно. Сверка ротора
  // с замером NASA Ames на винте DJI 9450 — в src/cli/validation.ts.
  info(`квадрокоптер: электрическая мощность висения ${(r.hover?.power ?? 0).toFixed(0)} Вт; по паспорту DJI около 174 Вт в среднем за полёт`);
}

// ---------- Уровень 3: заведомо нелетающее ----------
section('Отрицательные примеры');
{
  const { v } = runProgram(applyAssumptions(ornithopter), 'hover');
  flag('орнитоптер в масштабе фильма — «Разрушается»', v.kind === 'breaks', v.reasons[0]);
}
{
  // Удвоенная масса: к пилоту и пассажиру впереди прибавлено 1130 кг (полётная масса 1157 → 2287 кг).
  const heavy = applyAssumptions(cessna172, { 'parts[occFront].mass': 340 * 0.45359237 + 1130 });
  const { v } = runProgram(heavy, 'flight');
  flag('Cessna с удвоенной массой — «Не взлетает»', v.kind === 'no-lift', v.reasons[0]);
}
{
  const weak = applyAssumptions(r22);
  for (const b of weak.parts.filter((p) => p.kind === 'blade')) {
    b.structure = { ...b.structure!, material: WOOD, wall: b.structure!.wall / 2, widthFrac: (b.structure!.widthFrac ?? 0.25) / 2, heightFrac: (b.structure!.heightFrac ?? 1) / 2 };
  }
  const { v } = runProgram(weak, 'hover');
  flag(`R22 с лопастями из древесины вдвое меньшего сечения — «Разрушается»`, v.kind === 'breaks', v.reasons[0]);
}

// ---------- Проверка спецификации ----------
section('Некорректная спецификация');
{
  const bad = structuredClone(applyAssumptions(cessna172)) as Spec;
  bad.parts[0].mass = -5;
  bad.joints.push({ id: 'loose', type: 'fixed', parent: 'нет-такой', child: 'wingR' });
  bad.parts[1].structure!.material = 'адамантий';
  bad.environment.g = 0;
  try {
    const s = new Sim(RAPIER, bad);
    s.free();
    flag('отклонена с перечнем нарушений', false, 'не отклонена');
  } catch (e) {
    const n = e instanceof SpecError ? e.errors.length : 0;
    flag('отклонена с перечнем нарушений', e instanceof SpecError && n >= 4, `нарушений: ${n}`);
    if (e instanceof SpecError) for (const x of e.errors) console.log(`    • ${x}`);
  }
}

// ---------- Этап 3: балка, упругость, махолёты, обратная задача ----------
section('Консольная балка под собственным весом');
{
  const L = 4;
  const spec = base(
    [{ id: 'w', kind: 'wing', position: [0, 2, 0.5],
       aero: { side: 1, span: L, rootChord: 0.5, tipChord: 0.5, incidenceDeg: 0, airfoil: airfoil0, induced: 'none', sections: 16 },
       structure: { section: 'box', material: 'al7075', widthFrac: 0.3, heightFrac: 1, wall: 0.004, skinArealMass: 0 } }],
    [{ id: 'j', type: 'fixed', parent: 'body', child: 'w' }],
  );
  const sim = new Sim(RAPIER, spec, { aero: false, breakable: false });
  sim.lockRoot('fixed');
  sim.advance(1);
  const w = sim.partById.get('w')!;
  const sec = w.elements[0].section!;
  const M = (w.mass * 9.81 * L) / 2; // равномерная нагрузка: момент в заделке m·g·L/2
  report('напряжение в заделке M·(h/2)/I', w.stations[0].sigmaTension, (M * (sec.h / 2)) / sec.iFlap, 0.02, ' Па');
  const mid = w.elements[8].section!;
  const f1 = ((1.875 ** 2) / (2 * Math.PI)) * Math.sqrt((MATERIALS.al7075.E * mid.iFlap) / ((w.mass / L) * L ** 4));
  report('первая собственная частота консоли', w.elastic!.f1, f1, 0.02, ' Гц');
  sim.free();
}

section('Махолёты в трубе (ТЗ, раздел 12, уровень 2)');
{
  // SmartBird: потребная мощность в полёте, допуск 40 %.
  const ref = REFERENCE.smartbird;
  const { r, v } = runProgram(applyAssumptions(smartbird), 'tunnel', { windSpeed: ref.speed });
  const t = r.tunnel!;
  flag('Festo SmartBird держит вес и скорость в потоке 4,7 м/с', t.trimmed && t.netThrustMax >= 0 && (v.kind === 'flies' || v.kind === 'marginal'),
    `«${v.title}»: подъёмная сила ${(t.liftToWeight * 100).toFixed(0)} % веса, запас тяги ${(t.netThrustMaxToWeight * 100).toFixed(1)} % веса, найдено за ${t.cycles} циклов`);
  // Мощность сверяется в src/cli/validation.ts на валах (13 Вт × измеренный КПД привода 0,34–0,45). Прежняя сверка
  // электрической мощности с допуском ТЗ 40 % проходила с КПД привода 0,6 — оценкой; по статье он 0,34.
  info(`Festo SmartBird: электрическая мощность на взмах в горизонтальном полёте ${t.power.toFixed(1)} Вт против ${ref.power} Вт по статье (без сервоприводов)`);
  console.log(`  с полным возвратом энергии торможения крыла — ${(t.powerRecovered ?? 0).toFixed(1)} Вт; по статье: ${ref.powerWithServos} Вт с сервоприводами, ${ref.powerDesign} Вт на расчётном режиме 5 м/с`);
}
{
  // Snowbird: вердикт «летает на пределе»; работа привода — против оценки пилота.
  const ref = REFERENCE.snowbird;
  const { r, v } = runProgram(applyAssumptions(snowbird), 'tunnel');
  const t = r.tunnel!;
  // До пятой проверки здесь стояло: вердикт «Летает на пределе» и мощность на рабочем ходе в пределах 40 % от оценки
  // пилота. Обе были зависимыми: размах взмаха подбирался под оценку пилота, закрутка (±45°) — «с запасом над углом потока».
  // Теперь кинематика взята из диссертации Reichert (0,65 Гц, ±1,0 м на законцовке, закрутка ±7°, машут панели от 6 м),
  // и модель такой аппарат в воздухе не держит — расхождение с настоящим полётом показывает src/cli/validation.ts.
  info(`UTIAS Snowbird в трубе (кинематика из диссертации): «${v.title}»: ${v.reasons[0] ?? ''}`);
  // Силовой набор у Snowbird не задан — отчёт обязан сказать об этом при любом вердикте, а не только при «Летает».
  flag('UTIAS Snowbird: вердикт предупреждает, что прочность не проверялась', !r.strengthChecked && v.warnings.some((w) => w.includes('Прочность не проверялась')), v.warnings.find((w) => w.includes('Прочность')) ?? 'предупреждения нет');
  info(`UTIAS Snowbird: мощность на рабочем ходе (вдвое больше средней с возвратом) ${(2 * (t.powerRecovered ?? 0)).toFixed(0)} Вт; оценка пилота ${ref.strokePower[0]}–${ref.strokePower[1]} Вт, измерений нет`);
}
{
  // Махолёт для полёта вперёд в программах висения: «Не висит» с отсылкой к свободному полёту, а не «Не взлетает».
  const h = runProgram(applyAssumptions(smartbird), 'hover');
  flag('Festo SmartBird в программе висения: «Не висит» и отсылка к свободному полёту',
    h.v.kind === 'no-lift' && h.v.title === 'Не висит' && h.v.reasons.some((x) => x.includes('Свободный полёт махолёта')), `«${h.v.title}»: ${h.v.reasons.join(' ')}`);
  const fl = runProgram(applyAssumptions(smartbird), 'flight');
  flag('Festo SmartBird в программе для самолётов: «Не применимо» и отсылка к свободному полёту', fl.v.kind === 'n/a' && (fl.v.reasons[0] ?? '').includes('Свободный полёт махолёта'), fl.v.reasons[0] ?? '');
  // Показ найденного режима по кругу: в записи кадров должен оставаться целый последний цикл привода.
  const rp = new Replay();
  const hz = 0.83;
  for (let i = 0; i <= 240 * 20; i++) rp.push(i / 240, hz, () => new Float32Array([i / 240]));
  const T = 1 / hz;
  const a = rp.loopAt(0), b = rp.loopAt(0.25 * T), c = rp.loopAt(1.25 * T);
  flag('Запись кадров хранит целый последний цикл привода (0,83 Гц) и показывает его по кругу',
    rp.loopReady && !!a && !!b && !!c && Math.abs(a.t - (rp.end - T)) < 0.01 && Math.abs(b.t - (rp.end - 0.75 * T)) < 0.01 && Math.abs(c.t - b.t) < 0.01,
    `начало цикла ${a?.t.toFixed(3)} с при конце записи ${rp.end.toFixed(3)} с и периоде ${T.toFixed(3)} с; кадров ${rp.frames.length}`);
}

section('Свободный полёт махолёта');
{
  // 1. Переход «труба → земля» не должен менять обтекание. Один и тот же режим: корпус закреплён
  // во встречном потоке — и корпус движется с той же постоянной скоростью в неподвижном воздухе
  // (перемещения корпуса заперты, поэтому силы его скорость не меняют: он идёт равномерно).
  const spec = applyAssumptions(smartbird);
  const T = 0.5; // период взмаха SmartBird, с
  const cycleMeans = (boostAt: number | null) => {
    const sim = new Sim(RAPIER, spec, { wind: v3(-5, 0, 0), breakable: false });
    sim.lockRoot('fixed');
    sim.channels.pitch = 5.3;
    sim.channels.feather = 0.8;
    const n = Math.round(T / sim.dt);
    const out: { lift: number; power: number }[] = [];
    let jerk = 0;
    for (let c = 0; c < 9; c++) {
      let lift = 0, power = 0;
      for (let k = 0; k < n; k++) {
        if (boostAt !== null && c === boostAt && k === 0) {
          sim.boost(v3(5, 0, 0));
        }
        sim.step();
        lift += sim.sample.liftToWeight / n;
        power += sim.sample.power / n;
        // Перегрузка в точке кресла сразу после перехода: ложный рывок дал бы 5 м/с за шаг — больше 100 g.
        if (boostAt !== null && c === boostAt && k < 3) jerk = Math.max(jerk, Math.abs(sim.sample.crewAccel - 1));
      }
      out.push({ lift, power });
    }
    const v = sim.root.b.rb.linvel().x;
    const x = sim.root.b.rb.translation().x;
    sim.free();
    return { out, jerk, v, x };
  };
  const pinned = cycleMeans(null);
  const moved = cycleMeans(6);
  report('подъёмная сила за взмах: корпус в потоке 5 м/с и корпус, летящий 5 м/с в неподвижном воздухе', moved.out[8].lift, pinned.out[8].lift, 0.01, ' веса');
  report('мощность за взмах в тех же двух случаях', moved.out[8].power, pinned.out[8].power, 0.01, ' Вт');
  flag('при переходе из трубы в полёт нет ложного рывка: перегрузка в первые шаги отличается от 1 g меньше чем на 0,2',
    moved.jerk < 0.2 && Math.abs(moved.v - 5) < 1e-3 && Math.abs(moved.x - 7.5) < 0.05, `отклонение ${moved.jerk.toFixed(3)} g; через три взмаха скорость корпуса ${moved.v.toFixed(3)} м/с, путь ${moved.x.toFixed(2)} м`);
}
{
  // 2. Закон Ньютона в свободном полёте: изменение скорости корпуса от взмаха к взмаху равно импульсу
  // внешних сил (аэродинамика и вес). Корпус берётся в одной фазе взмаха — движение крыльев относительно
  // корпуса тогда одно и то же.
  const spec = applyAssumptions(smartbird);
  const run = new ProgramRun(RAPIER, spec, 'free', {});
  const sim = run.sim;
  const rb = sim.root.b.rb;
  const g = sim.g;
  const W = sim.totalMass * g;
  let free = false;
  let last = -1;
  let mark: { vx: number; vy: number } | null = null;
  let imp = { x: 0, y: 0 };
  let worst = 0;
  let cycles = 0;
  let scale = 0;
  run.advance(1e9, () => {
    if (run.fastForward) return;
    if (!free) {
      free = true;
      last = Math.floor(sim.actuatorPhase('flap') / (2 * Math.PI));
      mark = { vx: rb.linvel().x, vy: rb.linvel().y };
      imp = { x: 0, y: 0 };
      return;
    }
    imp.x += (sim.sample.aeroForce.x / W) * g * sim.dt;
    imp.y += (sim.sample.aeroForce.y / W - 1) * g * sim.dt;
    const k = Math.floor(sim.actuatorPhase('flap') / (2 * Math.PI));
    if (k === last) return;
    last = k;
    const now = { vx: rb.linvel().x, vy: rb.linvel().y };
    if (mark) {
      worst = Math.max(worst, Math.abs(now.vx - mark.vx - imp.x), Math.abs(now.vy - mark.vy - imp.y));
      scale = Math.max(scale, Math.abs(imp.x), Math.abs(imp.y));
      cycles++;
    }
    mark = now;
    imp = { x: 0, y: 0 };
  });
  const r = run.r;
  const v = analyze(r);
  run.free();
  flag('закон Ньютона в свободном полёте: скорость корпуса за взмах меняется на импульс внешних сил (расхождение меньше 0,01 м/с)',
    cycles >= 15 && worst < 0.01, `взмахов ${cycles}, наибольшее расхождение ${worst.toExponential(2)} м/с при импульсах до ${scale.toFixed(3)} м/с`);
  // 3. Эталоны.
  const fr = r.free!;
  flag('Festo SmartBird в свободном полёте — «Летает»', v.kind === 'flies', `«${v.title}»: ${v.reasons.join(' ')}`);
  flag('Festo SmartBird: высота держится в пределах 0,1 м, скорость — в пределах 5 % на всём пути',
    !fr.grounded && fr.altitudeMax - fr.altitudeStart < 0.1 && fr.altitudeStart - fr.altitudeMin < 0.1 && fr.speedMin > 0.95 * fr.speed && Math.abs(fr.speedEnd - fr.speed) < 0.05 * fr.speed,
    `высота от ${(fr.altitudeMin - fr.altitudeStart).toFixed(3)} до ${(fr.altitudeMax - fr.altitudeStart).toFixed(3)} м; скорость в конце ${fr.speedEnd.toFixed(2)} м/с, наименьшая ${fr.speedMin.toFixed(2)} м/с при заданных ${fr.speed}; ${fr.cycles} взмахов, ${fr.distance.toFixed(1)} м`);
  flag('Festo SmartBird: мощность в свободном полёте близка к мощности в трубе (в пределах 15 %)',
    Math.abs(fr.power / r.tunnel!.power - 1) < 0.15, `в полёте ${fr.power.toFixed(2)} Вт, в трубе ${r.tunnel!.power.toFixed(2)} Вт`);
  // 5. Удержание наклона корпуса больше не молчит: момент фиксатора измерен и назван в вердикте.
  const ph = fr.pitchHold;
  flag('Festo SmartBird: момент, которым держали наклон корпуса, измерен и назван в вердикте; по крену и курсу он у симметричного аппарата около нуля',
    !!ph && ph.amp > 0 && ph.rollYaw < 1e-2 * ph.amp && v.warnings.some((w) => w.includes('удерживались идеально')),
    ph ? `средний ${ph.mean.toFixed(3)} Н·м (C_m = ${ph.cm.toFixed(3)}), ±${ph.amp.toFixed(3)} Н·м за взмах; без удержания корпус качался бы на ±${ph.swingDeg.toFixed(1)}°; крен и курс — до ${ph.rollYaw.toExponential(1)} Н·м` : 'не измерен');
}
{
  const ref = REFERENCE.snowbird;
  const { r, v } = runProgram(applyAssumptions(snowbird), 'free');
  const fr = r.free;
  // Прежние проверки: «Летает на пределе», «16 взмахов за 19,3 с, как рекордный полёт» (тавтология: частота была задана
  // как 16/19,3), мощность против оценки пилота (зависимая). С кинематикой из диссертации аппарат в модели не летит.
  info(`UTIAS Snowbird в свободном полёте: «${v.title}»: ${v.reasons[0] ?? ''}` + (fr ? `; ${fr.duration.toFixed(1)} с, ${fr.cycles} взмахов` : ''));
  void ref;
}
{
  // 4. Проверка должна уметь и не пройти: с вчетверо большим сопротивлением корпуса запаса тяги не хватает.
  const spec = applyAssumptions(smartbird);
  spec.parts.find((p) => p.id === 'body')!.dragArea = 0.04;
  const { r, v } = runProgram(spec, 'free');
  const fr = r.free;
  flag('Festo SmartBird с вчетверо большим сопротивлением корпуса в свободном полёте не «Летает»',
    v.kind !== 'flies' && (!fr || fr.grounded || fr.netForce < 0),
    `«${v.title}»: ${v.reasons[0] ?? ''}`);
}

section('Орнитоптер «Дюны» и обратная задача');
{
  const spec = applyAssumptions(ornithopter);
  const x = solveInverse(RAPIER, spec, 'tethered');
  flag('вердикт — «Разрушается»', x.base.verdict.kind === 'breaks', x.base.verdict.reasons[0]);
  flag('обратная задача завершается за 60 с', x.ms <= 60000, `${(x.ms / 1000).toFixed(1)} с`);
  flag('проверочный прогон с найденным материалом выходит на запас ≈1,5', (x.verified?.margin ?? 0) >= 1.4, `запас ${x.verified?.margin.toFixed(2)}, материал ×${x.strengthFactor.toFixed(0)}`);
  flag('названо, что не исправить материалом (сверхзвук, резонанс)', x.blockers.some((b) => /звука/.test(b)) && x.blockers.some((b) => /частоты крыла/.test(b)));
  const o = runProgram(spec, 'tethered').r;
  flag('предупреждение о резонансе: привод быстрее собственной частоты крыла', (o.resonance?.ratio ?? 0) > 1, `f₁ = ${o.resonance?.f1.toFixed(2)} Гц, привод ${o.resonance?.fe} Гц`);
}

// ---------- Этап 2: сборка из проекта и цикл исправления (без обращения к ИИ) ----------
section('Сборка аппарата из проекта, который заполняет ИИ');
{
  const c = checkDesign(DESIGNS.cessna);
  if (!c.spec) flag('проект Cessna собирается', false, c.errors.join('; '));
  else {
    const { r, v } = runProgram(c.spec, 'flight');
    // Тот же бюджет, что у эталона (validation.ts): таблица POH 53 KCAS, допуск 5 %.
    diverge('проект Cessna: скорость сваливания против POH (53 KCAS)', r.flight?.vStall ?? NaN, 53 * 0.514444, 0.05,
      'сборщик по проекту ставит крыло и оперение по своим правилам (src/core/design.ts), а не как в эталонном пресете', ' м/с');
    flag('проект Cessna — «Летает»', v.kind === 'flies', v.title);
  }
  const h = checkDesign(DESIGNS.r22);
  if (!h.spec) flag('проект R22 собирается', false, h.errors.join('; '));
  else {
    const { r, v } = runProgram(h.spec, 'hover');
    flag('проект R22 висит и «Летает»', !!r.hover?.achieved && v.kind === 'flies', `${v.title}, ${((r.hover?.power ?? 0) / 1e3).toFixed(1)} кВт`);
  }
  const o = checkDesign(DESIGNS.ornithopter);
  if (!o.spec) flag('проект орнитоптера собирается', false, o.errors.join('; '));
  else flag('проект орнитоптера — «Разрушается»', runProgram(o.spec, 'tethered').v.kind === 'breaks');
  // Соосный вертолёт: два винта на общей оси один над другим, вращаются навстречу, управляются общим шагом.
  const ka = checkDesign(DESIGNS.ka26);
  if (!ka.spec) flag('проект соосного вертолёта собирается', false, ka.errors.join('; '));
  else {
    const hubs = ka.spec.parts.filter((p) => p.kind === 'hub');
    const spin = ka.spec.actuators.flatMap((a) => (a.type === 'spinner' ? [a] : []));
    const blades = ka.spec.parts.filter((p) => p.kind === 'blade').length;
    flag('проект соосного вертолёта: две втулки на одной оси одна над другой, винты вращаются навстречу, шесть лопастей, общий шаг',
      hubs.length === 2 && hubs[0].position[0] === hubs[1].position[0] && hubs[0].position[2] === hubs[1].position[2]
        && Math.abs(Math.abs(hubs[1].position[1] - hubs[0].position[1]) - 1.3) < 1e-9
        && spin.length === 2 && spin[0].direction === -spin[1].direction && blades === 6 && ka.spec.controls?.[0]?.channel === 'collective',
      `втулок ${hubs.length}, по высоте разнесены на ${Math.abs((hubs[1]?.position[1] ?? 0) - (hubs[0]?.position[1] ?? 0)).toFixed(2)} м, лопастей ${blades}, управление «${ka.spec.controls?.[0]?.channel}»`);
    const { r, v } = runProgram(ka.spec, 'hover');
    const p = r.hover?.power ?? NaN;
    // Вердикт по прочности зависимый: стенка лонжерона (9 мм) подобрана так, чтобы запас был около 1,9.
    flag('проект соосного вертолёта висит и «Летает» (по прочности зависимая: стенка лонжерона подобрана под запас)', !!r.hover?.achieved && v.kind === 'flies', `${v.title}, ${(p / 1e3).toFixed(0)} кВт из ${(r.powerAvailable / 1e3).toFixed(0)} кВт, запас прочности ${r.minMargin.toFixed(2)}`);
    // Первая частота взмаха лопасти — около 1,1 оборота, но воздух гасит взмах (ζ ≈ γ/16ν ≈ 0,45):
    // усиление у резонанса невелико, и ложного предупреждения «близко к резонансу» нет.
    flag('проект соосного вертолёта: воздух гасит взмах лопасти, предупреждения о резонансе нет',
      !!r.resonance && r.resonance.ratio > 0.8 && (r.resonance.zetaAir ?? 0) > 0.2 && r.resonance.daf < 1.5 && !v.warnings.some((w) => w.includes('резонанс')),
      `f₁ = ${r.resonance?.f1.toFixed(2)} Гц при ${r.resonance?.fe.toFixed(2)} об/с, демпфирование воздухом ${r.resonance?.zetaAir?.toFixed(2)}, усиление ×${r.resonance?.daf.toFixed(2)}`);
    // Ручная оценка: индуктивная мощность двух винтов по отдельности × κ × κ_int, профильная, потери трансмиссии.
    const ro = DESIGNS.ka26.rotor!;
    const W = r.totalMass * 9.81;
    const A = Math.PI * ro.radius ** 2;
    const ind = (2 * (W / 2) ** 1.5) / Math.sqrt(2 * 1.225 * A);
    const sigma = (ro.bladeCount * ro.chord) / (Math.PI * ro.radius);
    const prof = 2 * ((sigma * ro.airfoil.cd0) / 8) * 1.225 * A * (((ro.rpm * 2 * Math.PI) / 60) * ro.radius) ** 3;
    // Верификация, не сверка с реальностью: ручная оценка по тем же формулам и тем же κ, κ_int, что в модели.
    report(`соосный вертолёт: мощность висения против ручной оценки по тем же формулам (импульсная теория × 1,15 × ${String(COAXIAL_INTERFERENCE).replace('.', ',')}, профильная, потери 5 %) — верификация`, p, (ind * 1.15 * COAXIAL_INTERFERENCE + prof) * 1.05, 0.1, ' Вт');
    const iso = structuredClone(ka.spec);
    for (const a of iso.actuators) if (a.type === 'spinner') a.inducedFactor = 1.15;
    const p0 = runProgram(iso, 'hover').r.hover?.power ?? NaN;
    // Индуктивная часть — 50–80 % мощности висения, поэтому прибавка от κ_int — от 0,5 до 0,8 его превышения над 1.
    const ki = COAXIAL_INTERFERENCE - 1;
    flag(`взаимное влияние соосных винтов добавляет к мощности висения ${Math.round(50 * ki)}–${Math.round(80 * ki)} % (верификация: κ_int = ${String(COAXIAL_INTERFERENCE).replace('.', ',')} на индуктивную часть)`, p / p0 > 1 + 0.5 * ki && p / p0 < 1 + 0.8 * ki,
      `${(p / 1e3).toFixed(0)} кВт против ${(p0 / 1e3).toFixed(0)} кВт у тех же винтов без влияния: ×${(p / p0).toFixed(3)}`);
  }
  {
    // Соосная схема — ровно два винта с нулевым плечом. Три винта на одной оси и два перекрывающихся винта
    // с ненулевым плечом отклоняются с подсказкой, что указать.
    const three = structuredClone(DESIGNS.ka26);
    three.rotor!.rotorCount = 3;
    const overlap = structuredClone(DESIGNS.ka26);
    overlap.rotor!.armLength = 3;
    flag('три винта на одной оси и два перекрывающихся винта отклоняются с подсказкой про соосную схему',
      checkDesign(three).errors.some((x) => x.includes('rotorCount = 2')) && checkDesign(overlap).errors.some((x) => x.includes('armLength = 0')),
      [...checkDesign(three).errors, ...checkDesign(overlap).errors].join(' | '));
    // Исправленная ошибка сборщика: у винта, вращающегося по часовой стрелке, угол третьей лопасти выходил за 360°.
    const tri = structuredClone(DESIGNS.quad);
    tri.rotor!.bladeCount = 3;
    flag('мультикоптер с трёхлопастными винтами собирается', checkDesign(tri).errors.length === 0, checkDesign(tri).errors.join('; '));
    // Зависание страницы: ползунок числа винтов был дробным и позволял выставить дюжину винтов с перекрывающимися дисками.
    const many = structuredClone(DESIGNS.quad);
    many.assumptions = [...many.assumptions, { field: 'rotor.rotorCount', value: 4, unit: '', label: 'Число винтов', confidence: 'medium', origin: 'estimated', reason: 'проверка' }];
    const slider = checkDesign(many).spec?.assumptions.find((x) => x.path === 'design.rotor.rotorCount');
    flag('ползунок числа винтов — целый: шаг 1, целые пределы', !!slider && slider.step === 1 && Number.isInteger(slider.min) && Number.isInteger(slider.max) && (slider.min ?? 0) >= 1,
      slider ? `от ${slider.min} до ${slider.max}, шаг ${slider.step}` : 'ползунка нет');
    // У соосного вертолёта плечо винтов — 0, и ползунок «в 3 раза больше или меньше» был пустым (от 0 до 0).
    const coaxArm = structuredClone(DESIGNS.ka26);
    coaxArm.assumptions = [...coaxArm.assumptions, { field: 'rotor.armLength', value: 0, unit: 'м', label: 'Плечо', confidence: 'high', origin: 'source', reason: 'проверка' }];
    const arm = checkDesign(coaxArm).spec?.assumptions.find((x) => x.path === 'design.rotor.armLength');
    flag('ползунок нулевого допущения (плечо соосного вертолёта) не пустой: от 0 до трёх радиусов винта',
      !!arm && arm.min === 0 && Math.abs((arm.max ?? 0) - 3 * DESIGNS.ka26.rotor!.radius) < 1e-9 && (arm.step ?? 0) > 0, arm ? `от ${arm.min} до ${arm.max} м, шаг ${arm.step}` : 'ползунка нет');
    const frac = structuredClone(DESIGNS.quad);
    frac.rotor!.rotorCount = 4.5;
    const dozen = structuredClone(DESIGNS.quad);
    dozen.rotor!.rotorCount = 12;
    flag('дробное число винтов и винты с перекрывающимися дисками отклоняются с объяснением',
      checkDesign(frac).errors.some((x) => x.includes('целое')) && checkDesign(dozen).errors.some((x) => x.includes('не помещаются')) && checkDesign(DESIGNS.quad).errors.length === 0,
      [...checkDesign(frac).errors, ...checkDesign(dozen).errors].join(' | ').slice(0, 260));
  }
  // Махолёт, летающий вперёд («птица»): в проекте задана скорость полёта — аппарат собирается с органом
  // балансировки и закручиванием крыла и летит в свободном полёте.
  const gl = checkDesign(DESIGNS.gull);
  if (!gl.spec) flag('проект робота-чайки собирается', false, gl.errors.join('; '));
  else {
    const roles = (gl.spec.controls ?? []).map((x) => x.role).sort().join(',');
    flag('проект робота-чайки: есть балансировка и закручивание, задана скорость полёта, людей на борту нет',
      roles === 'lift,pitch' && gl.spec.limits?.cruiseSpeed === 5 && gl.spec.crew.unmanned === true, `органы управления: ${roles}; скорость ${gl.spec.limits?.cruiseSpeed} м/с`);
    const { r, v } = runProgram(gl.spec, 'free');
    flag('проект робота-чайки в свободном полёте — «Летает»', v.kind === 'flies' && !!r.free && !r.free.grounded,
      `«${v.title}»: ${v.reasons[v.reasons.length - 1] ?? ''}`);
  }
  // Старые ссылки: поля скорости в проекте нет — аппарат должен собраться так же, как с нулём («стрекоза»).
  const old = structuredClone(DESIGNS.ornithopter);
  delete (old.flapping as { cruiseSpeed?: number }).cruiseSpeed;
  (old.flapping as { wingMass: number | null }).wingMass = null; // раньше «посчитать по материалу» записывалось как null
  const oc = checkDesign(old);
  flag('проект махолёта из старой ссылки (без скорости полёта) собирается так же, как раньше',
    !!oc.spec && !!o.spec && JSON.stringify(oc.spec) === JSON.stringify(o.spec) && !o.spec.limits?.cruiseSpeed, oc.errors.join('; '));
}

section('Проекты, которые собрал настоящий ИИ (записаны 2026-11-11, data/gen-live)');
{
  // Три описания, отправленные настоящему ИИ через страницу. На них нашлись четыре ошибки стенда;
  // проекты сохранены, чтобы эти ошибки не вернулись. К ИИ проверка не обращается.
  const live = (name: string) => JSON.parse(readFileSync(new URL(`../../data/gen-live/${name}.json`, import.meta.url), 'utf8')) as Design;

  // «Робот-чайка: машет двумя крыльями и летит вперёд, как птица…» — ИИ задал скорость 10 м/с.
  const gull = checkDesign(live('gull'));
  if (!gull.spec) flag('проект ИИ «робот-чайка» собирается', false, gull.errors.join('; '));
  else {
    const { r, v } = runProgram(gull.spec, 'free');
    // Автопилот трубы раньше не мог уравнять подъёмную силу с весом: у этого аппарата она меняется на 0,49 веса
    // на градус, а наклон был зажат пределом 0,25. Подбор раскачивался, выбирался режим со срывом, крыло «ломалось».
    flag('проект ИИ «робот-чайка»: автопилот трубы уравнивает подъёмную силу с весом (в пределах 1,5 %)',
      !!r.tunnel?.trimmed && Math.abs((r.tunnel?.liftToWeight ?? 0) - 1) < 0.015, `подъёмная сила ${((r.tunnel?.liftToWeight ?? 0) * 100).toFixed(1)} % веса, угол установки ${r.tunnel?.pitchDeg.toFixed(2)}°, циклов на поиск ${r.tunnel?.cycles}`);
    flag('проект ИИ «робот-чайка» в свободном полёте — «Летает»', v.kind === 'flies' && !!r.free && !r.free.grounded, `«${v.title}»: ${v.reasons[v.reasons.length - 1] ?? ''}`);
    // Обломки: с вдвое более тонкой стенкой крыло ломается. Раньше после этого расчёт расходился —
    // число Маха обломков доходило до 10¹⁹.
    const weak = structuredClone(live('gull'));
    weak.sparWall = 0.0002;
    const w = runProgram(checkDesign(weak).spec!, 'free');
    flag('после поломки крыла расчёт не расходится: число Маха и перегрузка остаются конечными и правдоподобными',
      w.v.kind === 'breaks' && Number.isFinite(w.r.maxMach) && w.r.maxMach < 0.7 && Number.isFinite(w.r.crewPeakG) && w.r.crewPeakG < 1000,
      `«${w.v.title}»; число Маха до ${w.r.maxMach.toFixed(3)}, пиковая перегрузка ${w.r.crewPeakG.toFixed(1)} g`);
  }

  // «Орнитоптер из „Дюны“, 8 крыльев, экипаж 6 человек» — ИИ задал скорость 0: аппарат висит.
  const dune = checkDesign(live('dune'));
  if (!dune.spec) flag('проект ИИ «орнитоптер „Дюны“» собирается', false, dune.errors.join('; '));
  else flag('проект ИИ «орнитоптер „Дюны“»: висящий аппарат («стрекоза»), в висении — «Разрушается»',
    !dune.spec.limits?.cruiseSpeed && (dune.spec.controls ?? []).length === 1 && runProgram(dune.spec, 'hover').v.kind === 'breaks',
    `органы управления: ${(dune.spec.controls ?? []).map((x) => x.channel).join(', ')}`);

  // «Вертолёт Ка-32» — ИИ сам указал два винта с нулевым плечом: соосная схема.
  const ka32 = checkDesign(live('ka32'));
  if (!ka32.spec) flag('проект ИИ «Ка-32» собирается', false, ka32.errors.join('; '));
  else {
    const hubs = ka32.spec.parts.filter((p) => p.kind === 'hub');
    flag('проект ИИ «Ка-32» собирается как соосный: две втулки на общей оси, шесть лопастей',
      hubs.length === 2 && hubs[0].position[0] === hubs[1].position[0] && hubs[0].position[2] === hubs[1].position[2] && ka32.spec.parts.filter((p) => p.kind === 'blade').length === 6,
      `втулок ${hubs.length}, лопастей ${ka32.spec.parts.filter((p) => p.kind === 'blade').length}`);
    // Раньше лопасть «ломалась» на 0,017 с — на земле, под собственным весом: её считали пустотелой
    // тонкостенной коробкой. У лопастей винтов есть заполнитель, стенки не выпучиваются.
    const { r, v } = runProgram(ka32.spec, 'hover');
    flag('проект ИИ «Ка-32»: лопасти не ломаются на земле под собственным весом (первая секунда — без разрушений)',
      !r.breaks.some((b) => b.t < 1), r.breaks.length ? `первое разрушение на ${r.breaks[0].t.toFixed(2)} с: ${r.breaks[0].mode}` : 'разрушений нет');
    // Ложное «Разрушается» (срез стенки на 3,17 с) давала раскладка нагрузок по осям детали, а не по оси лопасти
    // с конусностью: центробежная сила (297 кН) не разгружала срез от тяги, и стенка «держала» всю тягу лопасти.
    flag('проект ИИ «Ка-32» — «Летает»: срез стенки лопасти больше не ломает её (нагрузки — по оси лопасти с конусностью)',
      v.kind === 'flies' && r.minMarginMode !== 'shear', `«${v.title}»: ${v.reasons[0] ?? ''}`);
    const nb = runProgram(ka32.spec, 'hover', { breakable: false });
    flag('проект ИИ «Ка-32»: без учёта прочности висит, мощности хватает',
      !!nb.r.hover?.achieved && (nb.r.hover?.power ?? Infinity) < nb.r.powerAvailable,
      `${((nb.r.hover?.power ?? 0) / 1e3).toFixed(0)} кВт из ${(nb.r.powerAvailable / 1e3).toFixed(0)} кВт; вердикт с учётом прочности — «${v.title}»: ${v.reasons[0] ?? ''}`);
  }
}
{
  // Сечение с заполнителем: стенки подкреплены, местная потеря устойчивости не проверяется, остальное — как обычно.
  const st = { section: 'box' as const, material: 'gfrp', widthFrac: 0.4, heightFrac: 0.9, wall: 0.006, skinArealMass: 0 };
  const load = { tension: 0, mFlap: 3000, mLag: 0, torsion: 0, vNormal: 0, vChord: 0 };
  const hollow = stationStress(sectionAt(st, 0.52, 0.11), MATERIALS.gfrp, load);
  const filled = stationStress(sectionAt({ ...st, filled: true }, 0.52, 0.11), MATERIALS.gfrp, load);
  flag('сечение с заполнителем: потеря устойчивости стенки не проверяется, запас — по прочности на сжатие',
    hollow.mode === 'buckling' && filled.mode !== 'buckling' && filled.margin > hollow.margin && Math.abs(filled.margin - MATERIALS.gfrp.ultCompression / filled.sigmaCompression) < 1e-9,
    `пустотелое: запас ${hollow.margin.toFixed(2)} (${hollow.mode}); с заполнителем: ${filled.margin.toFixed(2)} (${filled.mode})`);
}

section('Генерация: цикл исправления с подставным ИИ');
{
  const bad = structuredClone(DESIGNS.cessna);
  bad.fixedWing!.tailArm = 40; // оперение в 40 м от крыла при фюзеляже 8,3 м
  bad.rotor = structuredClone(DESIGNS.r22.rotor); // лишний блок
  const answers = [
    { inScope: true, reason: '', vehicleClass: 'fixed-wing', recognizedAs: 'Cessna 172S', components: ['фюзеляж', 'крыло', 'оперение'], givenByUser: [], knownFacts: [] },
    bad,
    DESIGNS.cessna,
  ];
  const seen: unknown[] = [];
  const stub = {
    beta: {
      messages: {
        parse: async (params: any) => {
          seen.push(params);
          const out = answers[seen.length - 1];
          return { model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, parsed_output: out,
            content: [{ type: 'text', text: JSON.stringify(out) }],
            usage: { input_tokens: 3000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    },
  };
  const g = await generate(stub as any, 'Cessna 172');
  flag('ошибка проверки возвращена ИИ и исправлена со второй попытки', g.ok && g.attempts === 2 && g.fixes[0].length >= 2, `попыток ${g.attempts}, нарушений в первой ${g.fixes[0]?.length}`);
  const fixMsg = JSON.stringify((seen[2] as any).messages.at(-1));
  flag('в запросе на исправление есть перечень нарушений', fixMsg.includes('tailArm') && fixMsg.includes('rotor'));
  flag('стоимость и токены посчитаны', g.usage.output === 4500 && Math.abs(g.costUsd - (9000 * 4 + 4500 * 20) / 1e6) < 1e-9, `$${g.costUsd.toFixed(4)}`);
  const off = { beta: { messages: { parse: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, content: [],
    parsed_output: { inScope: false, reason: 'это рецепт борща', vehicleClass: null, recognizedAs: '', components: [], givenByUser: [], knownFacts: [] },
    usage: { input_tokens: 100, output_tokens: 50 } }) } } };
  const n = await generate(off as any, 'рецепт борща');
  flag('описание не про летательный аппарат — отклонено с объяснением', !n.ok && /рецепт/.test(n.error ?? ''), n.error);
}

// ---------- Этап 4: отчёт ----------
section('Отчёт: каждое число в тексте вердикта есть в телеметрии');
{
  const cases: [string, ProgramId, Partial<TestState>?][] = [
    ['ornithopter', 'tethered'], ['ornithopter', 'tethered', { breakable: false }], ['cessna172', 'flight'], ['cessna172', 'max'],
    ['r22', 'hover'], ['r22', 'hover', { material: WOOD }], ['quadcopter', 'tethered'], ['snowbird', 'tunnel'], ['smartbird', 'tunnel'], ['smartbird', 'free'], ['snowbird', 'free'],
  ];
  for (const [preset, program, extra] of cases) {
    const st: TestState = { vehicle: { preset }, overrides: {}, program, ...extra };
    const { spec } = buildVehicle(st);
    const run = new ProgramRun(RAPIER, spec, program, programOptions(st));
    const rep = buildReport(run.runToEnd(), spec);
    run.free();
    const tele = new Set(rep.telemetry.flatMap((r) => numbersIn(`${r.label} ${r.value} ${r.note ?? ''}`)));
    const text = [...rep.verdict.reasons, ...rep.verdict.warnings, rep.event].join(' ');
    const nums = numbersIn(text);
    const miss = nums.filter((x) => !tele.has(x));
    flag(`${preset} / ${program}${extra ? ' ' + JSON.stringify(extra) : ''} — «${rep.verdict.title}»`, miss.length === 0 && nums.length > 0,
      miss.length ? `нет в телеметрии: ${miss.join(', ')}` : `${nums.length} чисел найдено`);
  }
}

section('Ссылка на испытание и воспроизводимость');
{
  const st: TestState = { vehicle: { preset: 'r22' }, overrides: { 'powerplant.power': 90000 }, program: 'hover', material: 'al7075', altitude: 500, breakable: true };
  const back = decodeState(encodeState(st)).state;
  flag('состояние из ссылки совпадает с исходным', JSON.stringify(back) === JSON.stringify(st));
  const des: TestState = { vehicle: { design: DESIGNS.cessna }, overrides: {}, program: 'flight', breakable: true };
  flag('аппарат, собранный ИИ, переносится ссылкой целиком', JSON.stringify(decodeState(encodeState(des)).state?.vehicle) === JSON.stringify(des.vehicle));
  const bad = structuredClone(DESIGNS.cessna);
  bad.fixedWing!.tailArm = 40;
  const rej = decodeState(encodeState({ ...des, vehicle: { design: bad } }));
  flag('подделанный проект в ссылке отклоняется проверкой', !rej.state && /проверку/.test(rej.error ?? ''), rej.error);
  flag('повреждённая ссылка отклоняется', !decodeState('%%%').state);
  const digest = (s: TestState) => {
    const { spec } = buildVehicle(s);
    const run = new ProgramRun(RAPIER, spec, s.program, programOptions(s));
    const r = run.runToEnd();
    run.free();
    return resultDigest(r);
  };
  const ornith: TestState = { vehicle: { preset: 'ornithopter' }, overrides: {}, program: 'tethered', breakable: true };
  const d1 = digest(ornith);
  flag('один и тот же прогон дважды даёт одинаковую телеметрию', d1 === digest(ornith), `отпечаток ${d1}`);
  console.log(`  отпечатки для сверки с браузером (__stand.repro()): ornithopter/tethered ${d1}, r22/hover ${digest({ vehicle: { preset: 'r22' }, overrides: {}, program: 'hover' })}`);
}

section('Какие допущения сильнее всего влияют на исход');
{
  const s = sensitivity(RAPIER, { vehicle: { preset: 'ornithopter' }, overrides: {}, program: 'tethered' });
  const top = s.items.slice(0, 3).map((x) => x.label);
  flag('расчёт влияния укладывается в 60 с', s.ms <= 60000, `${(s.ms / 1000).toFixed(1)} с, прогонов ${s.items.length + 1}`);
  flag('у орнитоптера в тройке — частота взмахов и длина крыла', top.includes('Частота взмахов') && top.includes('Длина крыла'), top.join(', '));
  const pw = s.items.find((x) => x.label === 'Мощность силовой установки');
  flag('мощность установки +10 % снижает долю нужной мощности на ~9 % (1/1,1)', !!pw && Math.abs((pw.change.power ?? 0) + 1 / 11) < 0.002, `${((pw?.change.power ?? 0) * 100).toFixed(2)} %`);
}

// ---------- Этап 5: генерация по картинке (без обращения к ИИ) ----------
section('Картинка: проверка файла');
{
  const files = IMAGE_CASES.map((c) => ({ id: c.id, b: readFileSync(`data/image-cases/${c.id}.png`) }));
  const okAll = files.every((f) => { const c = checkImage(f.b, 'image/png'); return c.ok && c.width === 1400 && c.height === 900; });
  flag('15 изображений набора — PNG 1400×900, приняты', files.length === 15 && okAll);
  // Минимальные заголовки JPEG и WebP — размеры читаются из них.
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x03, 0x20, 0x04, 0xb0, 3, ...new Array(12).fill(0)]);
  const j = checkImage(jpeg);
  flag('JPEG: размеры из маркера SOF', j.ok && j.width === 1200 && j.height === 800, `${j.width}×${j.height}`);
  const webp = new Uint8Array(30);
  webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  webp.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8);
  webp.set([0x3f, 0x06, 0x00, 0x83, 0x03, 0x00], 24); // 1600 × 900
  const w = checkImage(webp);
  flag('WebP: размеры из заголовка VP8X', w.ok && w.width === 1600 && w.height === 900, `${w.width}×${w.height}`);
  const png = files[0].b;
  flag('заявленный тип не совпадает с содержимым — отказ', !checkImage(png, 'image/jpeg').ok);
  flag('не изображение — отказ', !checkImage(new TextEncoder().encode('<script>alert(1)</script> не картинка')).ok);
  const tiny = Uint8Array.from(png.subarray(0, 64));
  tiny.set([0, 0, 0, 20, 0, 0, 0, 20], 16);
  flag('картинка 20×20 — отказ', /маленькое/.test(checkImage(tiny).error ?? ''));
  const big = new Uint8Array(6 * 1024 * 1024);
  big.set(png.subarray(0, 64));
  flag('больше 5 МБ после уменьшения — отказ', /больше 5 МБ/.test(checkImage(big).error ?? ''));
}

section('Картинка: запросы к ИИ (подставной ИИ)');
{
  const img = { type: 'image/png' as const, data: readFileSync('data/image-cases/r22-top.png').toString('base64') };
  const imageAnalysis = {
    showsAircraft: true, kind: 'drawing', view: 'top', scaleReference: { kind: 'dimension-line', what: 'размерная линия «7,67 м» по диаметру винта', sizeM: 7.67 },
    counts: { wings: null, rotors: 1, bladesPerRotor: 2, propellers: null },
    measured: [{ what: 'радиус несущего винта', field: 'rotor.radius', valueM: 3.835, how: 'половина размерной линии' }], notVisible: ['масса', 'обороты'],
  };
  const answers: unknown[] = [
    { inScope: true, reason: '', vehicleClass: 'rotor', recognizedAs: 'лёгкий вертолёт на чертеже', components: ['кабина', 'несущий винт, 2 лопасти'], givenByUser: [], knownFacts: [], image: imageAnalysis },
    DESIGNS.r22,
  ];
  const seen: any[] = [];
  const stub = { beta: { messages: { parse: async (p: any) => {
    seen.push(p);
    const out = answers[seen.length - 1];
    return { model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, parsed_output: out, content: [{ type: 'text', text: JSON.stringify(out) }],
      usage: { input_tokens: 4000, output_tokens: 1000 } };
  } } } };
  const g = await generate(stub as any, '', img);
  const first = seen[0]?.messages[0].content;
  const second = seen[1]?.messages[0].content;
  flag('картинка — первым блоком в запросе разбора, base64 и тип переданы', Array.isArray(first) && first[0].type === 'image' && first[0].source.data === img.data && first[0].source.media_type === 'image/png');
  flag('картинка есть и в запросе проекта', Array.isArray(second) && second[0].type === 'image');
  flag('без текста пользователя запрос помечен «только изображение»', JSON.stringify(first).includes('только изображение'));
  flag('по картинке собран вертолёт', g.ok && g.design?.vehicleClass === 'rotor' && !!g.analysis?.image);
  const noPlane = { beta: { messages: { parse: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, content: [],
    parsed_output: { inScope: false, reason: 'на рисунке стул: сиденье, спинка и четыре ножки', vehicleClass: null, recognizedAs: 'стул', components: [], givenByUser: [], knownFacts: [],
      image: { ...imageAnalysis, showsAircraft: false, counts: { wings: null, rotors: null, bladesPerRotor: null, propellers: null }, measured: [] } },
    usage: { input_tokens: 100, output_tokens: 50 } }) } } };
  const n = await generate(noPlane as any, '', img);
  flag('картинка без аппарата отклоняется с объяснением', !n.ok && /нет летательного аппарата: на рисунке стул/.test(n.error ?? ''), n.error);
}

section('Проект: допущения о нечисловых полях не гоняют ИИ на исправление');
{
  const d = structuredClone(DESIGNS.cessna);
  d.assumptions.push(
    { field: 'material', value: 0, unit: '', label: 'Материал', confidence: 'medium', origin: 'estimated', reason: 'алюминиевый лёгкий самолёт' },
    { field: 'fixedWing.highWing', value: 1, unit: '', label: 'Высокоплан', confidence: 'high', origin: 'image', reason: 'крыло над кабиной' },
  );
  flag('без нормализации такой проект не проходит проверку', !checkDesign(d).spec);
  const n = normalizeDesign(d);
  flag('нормализация убирает только нечисловые записи, проект проходит', n.dropped.join(',') === 'material,fixedWing.highWing' && n.design.assumptions.length === DESIGNS.cessna.assumptions.length && !!checkDesign(n.design).spec);
}

section('Картинка: оценка ответа по разметке');
{
  const byId = Object.fromEntries(IMAGE_CASES.map((c) => [c.id, c]));
  const s = scoreCase(byId['r22-top'], DESIGNS.r22);
  flag('точный проект R22 по чертежу сверху: опознан, пропорции и радиус точные', s.identified && s.ratios.every((x) => x.ok && (x.dev ?? 1) < 1e-9) && s.sizes.every((x) => x.ok));
  const wrong = structuredClone(DESIGNS.r22);
  wrong.rotor!.bladeCount = 3;
  wrong.rotor!.radius = 5.5;
  const sw = scoreCase(byId['r22-top'], wrong);
  flag('лишняя лопасть и радиус +43 % — не опознан, пропорции вне 25 %', !sw.identified && sw.ratios.every((x) => !x.ok), sw.problems.join('; '));
  flag('стул отклонён с объяснением — засчитан', scoreCase(byId.chair, null, 'На изображении нет летательного аппарата: на рисунке стул').identified);
  flag('стул принят за аппарат — не засчитан', !scoreCase(byId.chair, DESIGNS.quad).identified);
  flag('в наборе 15 изображений: 13 аппаратов и 2 без транспорта', IMAGE_CASES.length === 15 && IMAGE_CASES.filter((c) => !c.expect.inScope).length === 2);
}

// ---------- Этап 6: сервис (без обращения к ИИ) ----------
section('Сервис: отчёты по постоянным ссылкам, лимиты, мониторинг');
{
  const store = new Store(':memory:');
  let gens = 0;
  const costs = [3, 3, 5]; // $ за генерацию: две — $6, третья доводит до $11 при бюджете $10
  const fakeGenerate = (async () => {
    const costUsd = costs[gens++] ?? 1;
    return { ok: true, design: DESIGNS.quad, attempts: 1, fixes: [], steps: [], ms: 10, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd, model: 'claude-opus-5-5' };
  }) as unknown as typeof generate;
  const handler = createApp({ store, client: {} as any, generate: fakeGenerate, adminToken: 'secret', limits: { perUserHour: 2, perUserDay: 40, perIpHour: 30, budgetUsdPerDay: 10, reportsPerIpHour: 60 } });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  // Снимок настоящего испытания.
  const st: TestState = { vehicle: { preset: 'quadcopter' }, overrides: {}, program: 'tethered' };
  const { spec } = buildVehicle(st);
  const run = new ProgramRun(RAPIER, spec, st.program, programOptions(st));
  const series = new Series();
  run.runToEnd(() => series.push(run.sim.sample, run.sim.mainCycle()?.hz ?? 0));
  const snapshot = makeSnapshot(run.r, spec, series, 'ru');
  run.free();
  const saved = await post('/api/reports', { state: wireState(st), snapshot });
  const sb = await saved.json();
  flag('отчёт сохраняется, выдаётся короткий номер', saved.status === 201 && /^[A-Za-z0-9]{10}$/.test(sb.id) && sb.path === `/r/${sb.id}`, sb.path);
  const got = await (await fetch(`${base}/api/reports/${sb.id}`)).json();
  flag('по номеру возвращаются то же испытание и тот же снимок', got.ok && got.state.vehicle.preset === 'quadcopter' && got.state.program === 'tethered' && JSON.stringify(got.snapshot) === JSON.stringify(snapshot));
  flag('снимок занимает немного: графики прорежены', JSON.stringify(snapshot).length < 60_000, `${(JSON.stringify(snapshot).length / 1024).toFixed(0)} КБ`);
  const forged = await post('/api/reports', { state: wireState(st), snapshot: { ...snapshot, report: { ...snapshot.report, verdict: { ...snapshot.report.verdict, kind: 'flies-for-sure' } } } });
  flag('снимок не по схеме — отказ', forged.status === 400);
  const badState = await post('/api/reports', { state: { v: 1, vehicle: { preset: 'nope' }, program: 'hover' }, snapshot });
  flag('состояние с несуществующим аппаратом — отказ', badState.status === 400);
  flag('неизвестный номер — 404 с объяснением', (await fetch(`${base}/api/reports/zzzzzzzzzz`, { headers: { 'Accept-Language': 'ru' } }).then(async (r) => r.status === 404 && /не найден/.test((await r.json()).error))));

  // Лимиты. Один и тот же браузер (cookie uid).
  const h = { Cookie: 'uid=testUser0001', 'Accept-Language': 'ru-RU,ru' };
  const r1 = await post('/api/generate', { text: 'квадрокоптер' }, h);
  const r2 = await post('/api/generate', { text: 'квадрокоптер' }, h);
  const r3 = await post('/api/generate', { text: 'квадрокоптер' }, h);
  const e3 = await r3.json();
  flag('третья генерация за час от одного браузера — 429 с понятным сообщением', r1.status === 200 && r2.status === 200 && r3.status === 429 && /Лимит исчерпан: не больше 2 генераций/.test(e3.error) && /бесплатны/.test(e3.error), e3.error);
  const r4 = await post('/api/generate', { text: 'quadcopter' }, { Cookie: 'uid=testUser0002' });
  const r5 = await post('/api/generate', { text: 'quadcopter', lang: 'en' }, { Cookie: 'uid=testUser0003' });
  const e5 = await r5.json();
  flag('дневной бюджет $10 исчерпан ($11 потрачено) — 429 и по-английски для английского интерфейса', r4.status === 200 && r5.status === 429 && e5.limit === 'budget' && /budget/.test(e5.error), e5.error);
  flag('отклонённые по лимиту запросы до ИИ не доходят', gens === 3, `вызовов ИИ: ${gens}`);
  const fresh = await fetch(`${base}/api/health`);
  flag('новому браузеру выдаётся анонимный номер (cookie), без регистрации', /uid=[A-Za-z0-9]{16}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/.test(fresh.headers.get('set-cookie') ?? ''));

  // Мониторинг.
  flag('мониторинг без пароля закрыт', (await fetch(`${base}/api/admin/metrics`)).status === 401);
  const m = await (await fetch(`${base}/api/admin/metrics`, { headers: { Authorization: 'Bearer secret' } })).json();
  flag('мониторинг показывает затраты на ИИ и генерации', m.ok && Math.abs(m.costToday - 11) < 1e-9 && m.total.n === 3 && m.reports.n === 1, `сегодня ${m.costToday}, генераций ${m.total.n}, отчётов ${m.reports.n}`);
  const cols = (store.db.prepare('PRAGMA table_info(generations)').all() as { name: string }[]).map((c) => c.name);
  flag('в журнале нет текста описаний и открытых адресов', !cols.some((c) => /text|ip$|prompt/.test(c)) && cols.includes('ip_hash'), cols.join(', '));
  server.close();
}

section('Два языка: английский отчёт и данные без кириллицы');
{
  setLang('en');
  const cyr = /[а-яё]/i;
  const cases: [string, ProgramId, Partial<TestState>?][] = [['ornithopter', 'tethered'], ['cessna172', 'flight'], ['r22', 'hover', { material: WOOD }], ['quadcopter', 'tethered'], ['snowbird', 'tunnel'], ['smartbird', 'free']];
  for (const [preset, program, extra] of cases) {
    const st: TestState = { vehicle: { preset }, overrides: {}, program, ...extra };
    const { spec } = buildVehicle(st);
    const run = new ProgramRun(RAPIER, spec, program, programOptions(st));
    const rep = buildReport(run.runToEnd(), spec);
    run.free();
    const left = (JSON.stringify(rep).match(/[^"]*[а-яё][^"]*/gi) ?? []).slice(0, 2);
    flag(`${preset} / ${program}: отчёт по-английски — «${rep.verdict.title}»`, !left.length, left.join(' | ') || rep.verdict.reasons[0]);
  }
  const strings = new Set<string>();
  const add = (x?: string) => x && cyr.test(x) && strings.add(x);
  for (const sp of Object.values(PRESETS)) {
    add(sp.meta.name);
    for (const p of sp.parts) add(p.name);
    for (const a of sp.assumptions) { add(a.label); add(a.reason); }
    for (const c of sp.controls ?? []) add(c.label);
  }
  for (const m of Object.values(MATERIALS)) { add(m.name); add(m.note); add(m.scale); m.estimates?.forEach(add); }
  const untranslated = [...strings].filter((x) => cyr.test(td(x)));
  flag('у названий аппаратов, деталей, допущений и материалов есть перевод', !untranslated.length, untranslated.length ? untranslated.slice(0, 3).join(' | ') : `${strings.size} строк`);
  setLang('ru');
}

// ---------- Общие законы физики: падение, маятник, импульс, энергия взмаха, шаг ----------
physicsChecks(RAPIER, rep);

// ---------- Сверка с реальными измерениями: продувки, руководства, лётные и стендовые испытания ----------
validationChecks(RAPIER, rep);

console.log(summary('проверок'));
process.exit(count.failed ? 1 : 0);
