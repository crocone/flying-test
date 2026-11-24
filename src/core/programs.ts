// Программы испытаний и автопилот (ТЗ, разделы 3 и 4).
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { tr } from './i18n.ts';
import { endurance } from './engine.ts';
import { n } from './analyze.ts';
import { Sim, type BreakEvent, type SimOptions } from './sim.ts';
import { surfaceArea, type Spec, type Control } from './spec.ts';
import type { FailureMode } from './strength.ts';
import { v3, clamp, len, unrotate, copy, add, sub as vsub, scale, dot, rotate } from './vec.ts';
import { CrewLoad, VibrationMeter, type CrewLoadResult } from './crew.ts';
import { HeliPilot } from './helipilot.ts';

export type ProgramId = 'tethered' | 'hover' | 'flight' | 'tunnel' | 'free' | 'max' | 'stress';

export const PROGRAMS: Record<ProgramId, { name: string; what: string }> = {
  // Названия — на языке интерфейса в момент обращения.
  tethered: { get name() { return tr('Привязной стенд', 'Tethered rig'); }, get what() { return tr('Корпус закреплён, приводы на рабочем режиме: тяга, нагрузки, мощность', 'Body fixed, drives at operating speed: thrust, loads, power'); } },
  hover: { get name() { return tr('Взлёт и висение 10 с', 'Take-off and 10 s hover'); }, get what() { return tr('Подъём на 5 м и удержание высоты: хватает ли тяги и мощности, тряска', 'Climb to 5 m and hold height: enough thrust and power, vibration'); } },
  flight: { get name() { return tr('Разбег и горизонтальный полёт', 'Take-off run and level flight'); }, get what() { return tr('Разбег, отрыв, набор, полёт, торможение до сваливания', 'Take-off run, lift-off, climb, flight, slowing down to the stall'); } },
  tunnel: { get name() { return tr('Полёт в аэродинамической трубе', 'Wind-tunnel flight'); }, get what() { return tr('Корпус закреплён в потоке крейсерской скорости; угол установки крыльев подбирается так, чтобы подъёмная сила равнялась весу; меряются тяга и мощность', 'Body fixed in a cruise-speed flow; wing incidence is trimmed so that lift equals weight; thrust and power are measured'); } },
  free: {
    get name() { return tr('Свободный полёт махолёта', 'Flapping-wing free flight'); },
    get what() {
      return tr('Автопилот подбирает режим в потоке, затем корпус отпускается и аппарат летит сам: высоту автопилот держит углом установки крыльев, скорость — закручиванием. Курс и наклон корпуса удерживаются',
        'The autopilot finds the regime in a flow, then the body is released and the vehicle flies by itself: the autopilot holds height with wing incidence and speed with wing twist. Heading and body attitude are held');
    },
  },
  stress: {
    get name() { return tr('Стресс-тесты (нормы FAR 23 / 27)', 'Stress tests (FAR 23 / 27)'); },
    get what() {
      return tr('Взлёт и серия испытаний по нормам лётной годности. Самолёт: перегрузки по диаграмме V–n, порывы, резкие рули, пикирование до VD, сваливания, штопор. Вертолёт: перегрузки ручкой, малая перегрузка, порывы, полная педаль, отказ двигателя с авторотацией, 1,1·VNE. По каждому — цель, замер и вывод',
        'Take-off and a series of airworthiness-standard tests. Aeroplane: V–n load factors, gusts, abrupt controls, dive to VD, stalls, spin. Helicopter: cyclic pull-ups, low G, gusts, full pedal, engine failure into autorotation, 1.1·VNE. Each with target, measurement and pass/fail');
    },
  },
  max: { get name() { return tr('Максимальный режим', 'Maximum mode'); }, get what() { return tr('Предельные обороты или манёвр с наибольшей перегрузкой: запас прочности и усталость', 'Maximum speed or the highest-load manoeuvre: safety margin and fatigue'); } },
};

export interface ProgramOptions extends SimOptions {
  cruiseSpeed?: number; // м/с, для программы полёта
  climbSpeed?: number; // м/с: вместо полёта по кругу — установившийся набор высоты на полном газе с этой скоростью (скороподъёмность)
  hoverHeight?: number;
  holdTime?: number;
  windSpeed?: number; // для привязного стенда самолёта
  stressOnly?: string[]; // стресс-тесты: только эти шаги (по id) — для отладки и сверок
}

export interface ProgramResult {
  program: ProgramId;
  name: string;
  applicable: boolean;
  notApplicable?: string;
  // Крейсерская скорость аппарата без неподвижного крыла, рассчитанного на полёт вперёд (махолёт).
  // Такой аппарат не обязан висеть: о полёте судит программа «труба».
  forwardSpeed?: number;
  simTime: number;
  finished: boolean;
  phase: string;
  totalMass: number;
  weight: number;
  // Сколько хватит топлива или батареи при нужной мощности этого испытания (висение, полёт, труба), с; NaN — запас не задан.
  endurance?: number;
  strengthChecked: boolean; // есть ли у аппарата силовой набор; без него запас прочности не считается
  unmanned: boolean; // людей на борту нет: перегрузки в отчёте — для сведения
  minMargin: number;
  minMarginPart: string;
  minMarginMode: FailureMode;
  minMarginSpan: number;
  minYieldMargin: number;
  breaks: BreakEvent[];
  crewPeakG: number;
  crewSustainedG: number;
  crewLoad?: CrewLoadResult; // перегрузки по осям и длительности, модель Брикли (crew.ts)
  vibrationRms: number; // м/с²
  maxMach: number;
  powerPeak: number;
  powerMean: number;
  powerRecoveredMean: number; // то же при полном возврате энергии торможения крыльев (среднее со знаком)
  powerAvailable: number;
  // У машущего привода энергия торможения крыла может возвращаться (упругое крыло, пружина):
  // тогда нужная мощность лежит между powerRecoveredMean и powerMean.
  powerRecoverable: boolean;
  liftToWeightMax: number;
  liftToWeightMean: number;
  fatigue: { hours: number; part: string; spanFrac: number; noData: string[] };
  hover?: { achieved: boolean; channel: number; saturated: boolean; power: number; liftToWeightAtMax: number };
  tunnel?: {
    speed: number;
    trimmed: boolean; // подъёмная сила уравнена с весом
    pitchDeg: number;
    twist?: number;
    liftToWeight: number;
    netThrust: number; // тяга минус сопротивление на режиме измерения, Н
    netThrustToWeight: number;
    netThrustMax: number; // наибольшая достижимая при уравненной подъёмной силе — запас тяги, Н
    netThrustMaxToWeight: number;
    power: number; // без возврата энергии торможения крыла
    powerRecovered?: number; // с полным возвратом
    powerPeak?: number; // наибольшая мгновенная за цикл
    cycles: number;
    reducedFrequency: number; // k = π·f·c / U
    dragEstimate: number; // сопротивление в планировании при L = W, Н (по поляре и несущей линии)
    unsteady: boolean; // запаздывание подъёмной силы учтено (функция Вагнера)
  };
  // Свободный полёт махолёта после подбора режима в трубе.
  free?: {
    speed: number; // заданная скорость, м/с
    duration: number; // с
    cycles: number; // взмахов в свободном полёте
    distance: number; // м
    altitudeStart: number; altitudeEnd: number; altitudeMin: number; altitudeMax: number; // средние за взмах, м
    speedEnd: number; speedMin: number; // средние за взмах, м/с
    // Тяга минус сопротивление по изменению полной энергии (высота + V²/2g) на пройденном пути, Н.
    // Отрицательная — аппарат теряет энергию.
    netForce: number;
    netForceToWeight: number;
    power: number; powerRecovered: number; powerPeak: number;
    pitchRange: [number, number]; // в каких пределах автопилот менял угол установки, °
    twistRange?: [number, number]; // и закручивание
    grounded: boolean; // снизился почти до земли или потерял скорость — полёт прерван
    // Наклон и курс корпуса удерживаются идеально (оперение не моделируется). Чем это оплачено: момент,
    // которым фиксатор держит корпус по тангажу, Н·м (+ — на кабрирование), за взмахи после переходных.
    pitchHold?: {
      mean: number; // средний — его должно давать оперение
      amp: number; // половина размаха колебаний за взмах
      cm: number; // средний в долях q·S·c̄ (коэффициент момента)
      rollYaw: number; // наибольший из средних по крену и курсу, Н·м (у симметричного аппарата около нуля)
      // Насколько качался бы корпус по тангажу с частотой взмахов, если бы его не держали: amp / (I·ω²), °.
      swingDeg: number;
    };
  };
  flight?: {
    vRotate?: number; takeoffDistance?: number; vMax?: number; vStall?: number;
    cruiseSpeed?: number; cruisePower?: number; cruiseThrottle?: number; cruiseSteady?: boolean; loadFactor?: number; airborne: boolean;
    climbSpeed?: number; climbRate?: number;
    // Обороты винта фиксированного шага (об/мин) и его КПД на тех же режимах; нет таких винтов — не заполняются.
    vMaxRpm?: number; cruiseRpm?: number; cruisePropEfficiency?: number; climbRpm?: number; climbPropEfficiency?: number;
    elevatorLimited?: boolean;
    levelReached?: boolean; // набрал высоту и перешёл в горизонтальный полёт
  };
  notes: string[];
  resonance: { part: string; f1: number; fe: number; ratio: number; daf: number; zeta?: number; zetaAir?: number } | null; // деталь, ближайшая к резонансу
  // Крыло с наименьшей скоростью флаттера или дивергенции (если у крыльев задан кессон), м/с, Гц.
  flutter?: { part: string; vFlutter: number; fFlutter: number; vDivergence: number; fBending: number; fTorsion: number } | null;
  airspeedMax: number; // наибольшая скорость корпуса относительно воздуха за испытание, м/с
  stress?: StressStep[];
  // Прочность в этом испытании — только справочно (причина): у модели известное ограничение, вердикт по запасу не выносится.
  strengthInfoOnly?: string; // стресс-тесты самолёта: по шагу — цель, замеры, вывод
}

/** Оценка скорости сваливания по основному крылу: V = √(2W / ρ S C_Lmax). */
export function estimateStallSpeed(spec: Spec, rho: number, totalMass: number): number {
  let S = 0;
  let cl = 0;
  for (const p of spec.parts) {
    const a = p.aero;
    if (!a || p.kind !== 'wing' || a.role === 'tail') continue;
    const area = surfaceArea(a);
    S += area;
    cl += area * a.airfoil.clMax;
  }
  if (S === 0) return NaN;
  return Math.sqrt((2 * totalMass * spec.environment.g) / (rho * S * (cl / S)));
}

class Window {
  private buf: number[] = [];
  private i = 0;
  private sum = 0;
  private sum2 = 0;
  private n: number;
  constructor(n: number) {
    this.n = n;
  }
  push(x: number) {
    if (this.buf.length < this.n) this.buf.push(x);
    else {
      const old = this.buf[this.i];
      this.sum -= old;
      this.sum2 -= old * old;
      this.buf[this.i] = x;
      this.i = (this.i + 1) % this.n;
    }
    this.sum += x;
    this.sum2 += x * x;
  }
  get mean() {
    return this.buf.length ? this.sum / this.buf.length : 0;
  }
  get std() {
    const m = this.mean;
    return this.buf.length ? Math.sqrt(Math.max(0, this.sum2 / this.buf.length - m * m)) : 0;
  }
  get full() {
    return this.buf.length >= this.n;
  }
}

/** Шаг стресс-теста: цель по нормам, замеры (подписи и значения), вывод (null — не применимо или не получилось). */
export interface StressStep {
  id: string;
  name: string;
  target: string;
  pass: boolean | null;
  values: [string, string][];
  note?: string;
}

/** Стресс-тесты в браузере: сколько секунд вывода после манёвра показывать в реальном времени, прежде чем ускорить. */
const STRESS_SHOW_RECOVERY = 4;

export class ProgramRun {
  readonly sim: Sim;
  readonly id: ProgramId;
  readonly spec: Spec;
  readonly opts: ProgramOptions;
  phase = 'старт';
  done = false;
  // Идёт часть испытания, на которую незачем смотреть в замедлении (автопилот трубы перебирает
  // десятки циклов взмаха): стенд считает её ускоренно. На расчёт не влияет — только на показ.
  fastForward = false;
  /** Стресс-тесты: какое испытание серии идёт сейчас и на каком этапе (для показа на стенде). */
  stressNow: { n: number; of: number; name: string; target: string; stage: 'trim' | 'step' | 'recover' } | null = null;
  // Вибрация (ISO 2631, с.к.з. за 2 с) — мера длительной тряски. В стресс-тестах порывы и резкие рули — разовые толчки:
  // их оценивают перегрузка по осям и модель удара, а вибрация на время манёвров и выводов из них не меряется.
  private vibPaused = false;
  readonly r: ProgramResult;
  readonly timeLimit: number;
  private ctl: () => void = () => {};
  private crewWin: Window;
  private crewLoad: CrewLoad;
  private liftWin: Window;
  private powerWin: Window;
  private recWin: Window;
  private rampEnd: number;
  private crewLp = NaN;
  private impactLp = NaN;
  private vib: VibrationMeter;

  constructor(RAPIER: typeof RAPIER_NS, spec: Spec, id: ProgramId, opts: ProgramOptions = {}) {
    this.spec = spec;
    this.id = id;
    this.opts = opts;
    const cls = spec.meta.class;
    const tunnelSpeed = opts.windSpeed ?? spec.limits?.cruiseSpeed ?? 10;
    const wind = id === 'tunnel' || id === 'free' ? v3(-tunnelSpeed, 0, 0) : id === 'tethered' && cls === 'fixed-wing' ? v3(-(opts.windSpeed ?? 0), 0, 0) : v3();
    this.sim = new Sim(RAPIER, spec, { ...opts, wind: opts.wind ?? wind });
    const sim = this.sim;
    const n1 = Math.round(1 / sim.dt);
    this.crewWin = new Window(n1);
    this.crewLoad = new CrewLoad(sim.dt, sim.g);
    this.vib = new VibrationMeter(sim.dt, 2);
    // Средняя мощность — по целому числу циклов главного привода (не меньше секунды):
    // за неполный цикл инерционная часть не обнуляется.
    const fMain = spec.actuators.reduce((m, a) => (a.type === 'oscillator' ? Math.max(m, a.freqHz) : m), 0);
    const nPow = fMain > 0 ? Math.max(1, Math.round(Math.ceil(fMain) / fMain / sim.dt)) : n1;
    this.powerWin = new Window(nPow);
    this.recWin = new Window(nPow);
    // Подъёмная сила — тоже по целым циклам взмаха (не меньше полусекунды): за полцикла среднее гуляет.
    this.liftWin = new Window(fMain > 0 ? Math.max(1, Math.round(Math.ceil(0.5 * fMain) / fMain / sim.dt)) : Math.round(0.5 / sim.dt));
    this.rampEnd = Math.max(0, ...spec.actuators.map((a) => (a.type === 'propeller' ? 0 : a.rampTime ?? 0)));
    this.r = {
      program: id, name: PROGRAMS[id].name, applicable: true, simTime: 0, finished: false, phase: this.phase,
      totalMass: sim.totalMass, weight: sim.totalMass * sim.g,
      strengthChecked: spec.parts.some((p) => !!p.structure),
      unmanned: !!spec.crew.unmanned,
      ...(cls !== 'fixed-wing' && spec.limits?.cruiseSpeed ? { forwardSpeed: spec.limits.cruiseSpeed } : {}),
      minMargin: Infinity, minMarginPart: '', minMarginMode: 'none', minMarginSpan: 0, minYieldMargin: Infinity, breaks: sim.events,
      crewPeakG: 0, crewSustainedG: 0, vibrationRms: 0, maxMach: 0, powerPeak: 0, powerMean: 0, powerRecoveredMean: 0,
      powerAvailable: sim.powerAvailable, powerRecoverable: spec.actuators.some((a) => a.type === 'oscillator'), liftToWeightMax: -Infinity, liftToWeightMean: 0,
      fatigue: { hours: Infinity, part: '', spanFrac: 0, noData: [] }, notes: [], resonance: null, flutter: null, airspeedMax: 0,
    };
    for (const p of sim.parts) {
      const f = sim.flutterInfo(p);
      if (f && (!this.r.flutter || Math.min(f.vFlutter, f.vDivergence) < Math.min(this.r.flutter.vFlutter, this.r.flutter.vDivergence)))
        this.r.flutter = { part: p.spec.id, ...f };
    }
    for (const c of spec.controls ?? []) sim.channels[c.channel] = c.initial;
    for (const p of sim.parts) {
      const el = p.elastic;
      if (el && el.fe > 0 && (!this.r.resonance || el.ratio > this.r.resonance.ratio)) this.r.resonance = { part: p.spec.id, ...el };
    }
    this.timeLimit = 30;

    if (id === 'tunnel' || id === 'free') this.setupTunnel(tunnelSpeed, id === 'free');
    else if (id === 'tethered' || (id === 'max' && cls !== 'fixed-wing')) this.setupTethered(id === 'max');
    else if (id === 'hover') {
      if (cls === 'fixed-wing') this.notApplicable(tr('самолёт не висит: используйте программу «Разбег и горизонтальный полёт»', 'an aeroplane does not hover: use the “Take-off run and level flight” programme'));
      else this.setupHover();
    } else {
      if (cls !== 'fixed-wing' && id === 'stress') this.setupHeliStress();
      else if (cls !== 'fixed-wing')
        this.notApplicable(spec.limits?.cruiseSpeed
          ? tr('программа для самолётов; машущему аппарату для полёта вперёд подходит «Свободный полёт махолёта»', 'this programme is for aeroplanes; for a forward-flying flapping vehicle use “Flapping-wing free flight”')
          : tr('программа для самолётов; для винтов и машущих крыльев — «Взлёт и висение»', 'this programme is for aeroplanes; for rotors and flapping wings use “Take-off and hover”'));
      else if (id === 'stress') this.setupStress();
      else this.setupFlight(id === 'max');
    }
  }

  private control(role: Control['role']): Control | undefined {
    return this.spec.controls?.find((c) => c.role === role);
  }

  private notApplicable(why: string) {
    this.r.applicable = false;
    this.r.notApplicable = why;
    this.done = true;
    this.r.finished = true;
  }

  // ---------- привязной стенд и максимальный режим винтов/крыльев ----------

  private setupTethered(max: boolean) {
    const sim = this.sim;
    sim.lockRoot('fixed');
    const lift = this.control('lift');
    const thr = this.control('throttle');
    if (lift) sim.channels[lift.channel] = max ? lift.max : lift.initial;
    if (thr) sim.channels[thr.channel] = 1;
    // Не меньше трёх циклов нагружения после разгона — для усталости.
    const cycle = this.spec.actuators.reduce((m, a) => {
      if (a.type === 'oscillator') return Math.max(m, 1 / a.freqHz);
      if (a.type === 'spinner') return Math.max(m, 60 / a.rpm);
      return m;
    }, 0);
    const end = this.rampEnd + Math.max(2, 4 * cycle) + (max ? 2 : 0);
    (this as { timeLimit: number }).timeLimit = end;
    this.phase = 'разгон';
    this.ctl = () => {
      if (sim.t > this.rampEnd) this.phase = max ? 'предельный режим' : 'рабочий режим';
      if (sim.t >= end) this.finish();
    };
  }

  // ---------- полёт в трубе ----------

  private setupTunnel(speed: number, release = false) {
    const sim = this.sim;
    const osc = this.spec.actuators.find((a) => a.type === 'oscillator');
    const pitchC = this.control('pitch');
    if (!osc) {
      this.notApplicable(tr('программа для машущих крыльев: у аппарата нет машущего привода', 'this programme is for flapping wings: the vehicle has no flapping drive'));
      return;
    }
    if (!pitchC) {
      this.notApplicable(tr('нужен орган управления углом установки крыльев (controls с role: "pitch")', 'a wing incidence control is required (controls with role: "pitch")'));
      return;
    }
    sim.lockRoot('fixed');
    this.fastForward = true;
    // Свободный полёт: число взмахов и запас высоты (при просадке законцовки не должны задеть землю).
    const freeCycles = Math.max(16, Math.ceil(8 * osc.freqHz));
    const clearance = Math.max(2, 0.15 * this.spec.parts.reduce((m, p) => Math.max(m, p.aero ? 2 * p.aero.span : 0), 0));
    if (release) sim.shift(v3(0, clearance, 0));
    const twistC = this.control('lift'); // закручивание крыла на взмахе
    if (twistC) sim.channels[twistC.channel] = twistC.initial;
    sim.channels[pitchC.channel] = pitchC.initial;
    const W = sim.totalMass * sim.g;
    const wing = this.spec.parts.find((p) => p.aero && p.kind === 'wing')?.aero;
    // Приведённая частота k = π·f·c / U: насколько воздух успевает за взмахом.
    const reducedFrequency = wing ? (Math.PI * osc.freqHz * (wing.rootChord + wing.tipChord)) / 2 / Math.max(speed, 1e-6) : 0;
    // Сопротивление в планировании при подъёмной силе, равной весу: профиль, индуктивное, корпус.
    // Нужно, чтобы оценить нехватку тяги в долях сопротивления.
    const q = 0.5 * sim.rho * speed * speed;
    const wings = this.spec.parts.filter((p) => p.aero && p.kind === 'wing').map((p) => p.aero!);
    const area = (a: (typeof wings)[number]) => surfaceArea(a);
    const S = wings.reduce((m, a) => m + area(a), 0);
    const CL = W / Math.max(1e-9, q * S);
    let dragEstimate = q * this.spec.parts.reduce((m, p) => m + (p.aero ? 0 : p.dragArea ?? 0), 0);
    for (const a of wings) {
      const AR = a.aspectRatio ?? (2 * a.span * a.span) / area(a);
      dragEstimate += q * area(a) * (a.airfoil.cd0 + (a.airfoil.k ?? 0.01) * CL * CL + (a.induced === 'wing' ? (CL * CL) / (Math.PI * 0.9 * AR) : 0));
    }
    const t = (this.r.tunnel = {
      speed, trimmed: false, pitchDeg: pitchC.initial, liftToWeight: 0, netThrust: 0, netThrustToWeight: 0,
      netThrustMax: 0, netThrustMaxToWeight: 0, power: 0, cycles: 0, reducedFrequency, dragEstimate, unsteady: !!wing?.unsteady,
    });
    (this as { timeLimit: number }).timeLimit = this.rampEnd + (260 + (release ? freeCycles + 4 : 0)) / osc.freqHz;
    this.phase = 'разгон';

    // Балансировка — поиск установившегося горизонтального полёта: подъёмная сила равна весу
    // (угол установки крыльев), тяга равна сопротивлению (закручивание крыла на взмахе).
    // Тяга от закручивания зависит немонотонно: слишком мало — крыло срывается, слишком много —
    // крыло идёт «флюгером» и не тянет. Поэтому закручивание перебирается по всему диапазону,
    // а не подстраивается «в одну сторону» (прежний регулятор застревал на одной ветви).
    // Каждая проба — один полный цикл взмаха при постоянных настройках.
    type M = { lw: number; tw: number; power: number; rec: number; peak: number };
    type Pt = { twist: number; pitch: number; m: M; ok: boolean };
    type Plan<R> = Generator<[number, number], R, M>;
    const TOL = 0.01;
    // Прирост L/W на градус угла установки. Ожидаемое значение — из теории несущей линии:
    // dL/dα = q·S·a / (1 + a / (π·e·λ)); делится на вес. У SmartBird на 5 м/с это 0,11 на градус,
    // у того же крыла на 10 м/с — вчетверо больше. Раньше наклон был зажат в пределах 0,04…0,25
    // (подобрано под эталоны), и у быстрого или легко нагруженного аппарата подбор угла раскачивался.
    const slopeTheory = (() => {
      let sum = 0;
      for (const a of wings) {
        const AR = a.aspectRatio ?? (2 * a.span * a.span) / area(a);
        const cla = a.airfoil.clAlpha ?? 5.7;
        sum += area(a) * (a.induced === 'wing' ? cla / (1 + cla / (Math.PI * 0.9 * AR)) : cla);
      }
      return Math.max(1e-3, ((q * sum) / W) * (Math.PI / 180));
    })();
    const slopeMin = 0.4 * slopeTheory;
    const slopeMax = 1.6 * slopeTheory;
    let slope = slopeTheory; // уточняется по пробам
    const self = this;
    // Что свободному полёту нужно знать о найденном режиме: наклоны «подъёмная сила — угол установки»
    // и «тяга — закручивание» и рабочий диапазон закручивания.
    const trimInfo = { slope: 0.1, thrustSlope: 0, twistMin: 0, twistMax: 0 };
    // Уравнять подъёмную силу с весом углом установки: шаги по наклону, а когда найдены углы
    // с подъёмной силой меньше и больше веса («вилка») — поиск внутри вилки. Он сходится всегда.
    function* trim(twist: number, p0: number): Plan<Pt> {
      slope = clamp(slope, slopeMin, slopeMax);
      let p = clamp(p0, pitchC!.min, pitchC!.max);
      let m: M = yield [p, twist];
      let best = { pitch: p, m };
      type Side = { pitch: number; lw: number } | null;
      const br: { lo: Side; hi: Side } = { lo: null, hi: null }; // lo — подъёмной силы не хватает, hi — с избытком
      const note = (pitch: number, lw: number) => {
        // Вилку держим только с «правильной» стороны срыва: угол с избытком больше угла с нехваткой.
        if (lw < 1 && (!br.lo || pitch > br.lo.pitch) && (!br.hi || pitch < br.hi.pitch)) br.lo = { pitch, lw };
        if (lw >= 1 && (!br.hi || pitch < br.hi.pitch) && (!br.lo || pitch > br.lo.pitch)) br.hi = { pitch, lw };
      };
      note(p, m.lw);
      for (let i = 0; i < 8 && Math.abs(m.lw - 1) > TOL; i++) {
        let next: number;
        const { lo, hi } = br;
        if (lo && hi) {
          // Внутри вилки — по хорде, но не ближе 15 % к её краям: у срыва зависимость изогнута.
          const fr = clamp((1 - lo.lw) / (hi.lw - lo.lw), 0.15, 0.85);
          next = lo.pitch + fr * (hi.pitch - lo.pitch);
        } else {
          // Шаг не больше 3°: за срывом подъёмная сила падает, и большой шаг уводит в срыв насовсем.
          next = clamp(p + clamp((1 - m.lw) / slope, -3, 3), pitchC!.min, pitchC!.max);
        }
        if (Math.abs(next - p) < 1e-3) break; // упёрлись в предел управления или вилка сомкнулась
        const m2: M = yield [next, twist];
        const sl = (m2.lw - m.lw) / (next - p);
        // Наклон уточняется только в разумных пределах: у срыва он падает и меняет знак.
        if (sl > slopeMin && sl < slopeMax) slope = sl;
        p = next;
        m = m2;
        note(p, m.lw);
        if (Math.abs(m.lw - 1) < Math.abs(best.m.lw - 1)) best = { pitch: p, m };
      }
      return { twist, ...best, ok: Math.abs(best.m.lw - 1) <= 1.5 * TOL };
    }
    // Чем больше, тем лучше: тяга при уравненной подъёмной силе; где вес не держится — хуже любого.
    const score = (p: Pt) => (p.ok ? p.m.tw : p.m.lw - 10);
    function* plan(): Plan<void> {
      const pts: Pt[] = [];
      let pitch = pitchC!.initial;
      function* at(twist: number): Plan<Pt> {
        const p = yield* trim(twist, pitch);
        if (p.ok) pitch = p.pitch;
        pts.push(p);
        return p;
      }
      let best: Pt;
      if (!twistC) best = yield* at(0);
      else {
        self.phase = 'поиск закручивания';
        const lo = twistC.min, hi = twistC.max;
        const N = 7;
        let step = (hi - lo) / (N - 1);
        best = yield* at(lo);
        for (let k = 1; k < N; k++) {
          const p = yield* at(lo + step * k);
          if (score(p) > score(best)) best = p;
        }
        for (let r = 0; r < 2; r++) {
          step /= 2;
          const c = best.twist;
          for (const x of [c - step, c + step]) {
            if (x <= lo || x >= hi) continue;
            const p = yield* at(x);
            if (score(p) > score(best)) best = p;
          }
        }
      }
      const top = best;
      if (twistC && best.ok && best.m.tw > 0) {
        // Тяги с запасом. Горизонтальный полёт — там, где тяга равна сопротивлению. Берём ветвь
        // с большим закручиванием: на ней обтекание без срыва.
        self.phase = 'балансировка';
        let a = best;
        // Ближайшая проба, где тяги уже не хватает: сначала со стороны большего закручивания,
        // а если до предела закручивания тяга так и не упала — со стороны меньшего.
        const neg = pts.filter((p) => p.ok && p.m.tw < 0);
        let b = neg.filter((p) => p.twist > a.twist).sort((x, y) => x.twist - y.twist)[0]
          ?? neg.filter((p) => p.twist < a.twist).sort((x, y) => y.twist - x.twist)[0];
        for (let i = 0; b && i < 6 && a.m.tw > 0.002; i++) {
          const frac = clamp(a.m.tw / (a.m.tw - b.m.tw), 0.05, 0.95); // секущая
          const mid = yield* at(a.twist + (b.twist - a.twist) * frac);
          if (!mid.ok) break;
          if (mid.m.tw >= 0) a = mid;
          else b = mid;
        }
        best = a;
      }
      trimInfo.slope = clamp(slope, slopeMin, slopeMax);
      if (twistC) {
        // Рабочая ветвь — от закручивания с наибольшей тягой до предела управления со стороны найденного
        // режима; наклон — по ближайшей пробе на этой ветви.
        const side = best.twist >= top.twist ? 1 : -1;
        const near = pts
          .filter((p) => p.ok && p !== best && Math.abs(p.twist - best.twist) > 1e-4 && (p.twist - top.twist) * side >= -1e-9)
          .sort((x, y) => Math.abs(x.twist - best.twist) - Math.abs(y.twist - best.twist))[0];
        // Наклон — по всей рабочей ветви (от наибольшей тяги до найденного режима): по двум близким пробам
        // он тонет в шуме. Если найденный режим и есть режим наибольшей тяги — по ближайшей пробе.
        if (best !== top && Math.abs(best.twist - top.twist) > 1e-4) trimInfo.thrustSlope = (best.m.tw - top.m.tw) / (best.twist - top.twist);
        else if (near) trimInfo.thrustSlope = (near.m.tw - best.m.tw) / (near.twist - best.twist);
        trimInfo.twistMin = side > 0 ? top.twist : twistC.min;
        trimInfo.twistMax = side > 0 ? twistC.max : top.twist;
      }
      // Измерение: три цикла на найденном режиме. Прочность и пики — только по нему:
      // на пробах поиска настройки заведомо негодные.
      self.phase = 'измерение';
      sim.opts.breakable = breakable;
      Object.assign(self.r, { minMargin: Infinity, minMarginPart: '', minMarginMode: 'none', minMarginSpan: 0, minYieldMargin: Infinity, powerPeak: 0, liftToWeightMax: -Infinity, maxMach: 0 });
      const acc = { lw: 0, tw: 0, power: 0, rec: 0, peak: 0 };
      for (let i = 0; i < 3; i++) {
        const m: M = yield [best.pitch, best.twist];
        acc.lw += m.lw / 3;
        acc.tw += m.tw / 3;
        acc.power += m.power / 3;
        acc.rec += m.rec / 3;
        acc.peak = Math.max(acc.peak, m.peak);
      }
      Object.assign(t, {
        trimmed: best.ok, pitchDeg: best.pitch, twist: twistC ? best.twist : undefined, liftToWeight: acc.lw,
        netThrust: acc.tw * W, netThrustToWeight: acc.tw,
        // Запас тяги — наибольшая тяга за вычетом сопротивления при уравненной подъёмной силе.
        netThrustMax: (top.ok ? top.m.tw : acc.tw) * W, netThrustMaxToWeight: top.ok ? top.m.tw : acc.tw,
        power: acc.power, powerRecovered: Math.max(0, acc.rec), powerPeak: acc.peak, cycles,
      });
      if (!best.ok)
        self.r.notes.push(tr(
          `подъёмную силу не удалось уравнять с весом ни при каком закручивании: ${n(acc.lw * 100, 2)} % веса при угле установки ${n(best.pitch, 2)}°`,
          `lift could not be matched to weight at any twist: ${n(acc.lw * 100, 2)} % of weight at ${n(best.pitch, 2)}° incidence`));
    }

    // На время поиска детали не ломаются: пробы с негодными настройками — не полёт.
    const breakable = sim.opts.breakable;
    sim.opts.breakable = false;
    const it = plan();
    let cyc = { lift: 0, thrust: 0, power: 0, rec: 0, peak: 0, n: 0 };
    let lastCycle = -1;
    let cycles = 0;
    let started = false;
    // При нестационарном обтекании поток «помнит» прошлое: подъёмная сила доходит до нового
    // значения за десятки полухорд пути — это доли цикла взмаха. Поэтому после смены настроек
    // один цикл пропускается (установление), а сами настройки перекладываются плавно, за
    // десятую часть цикла: мгновенный поворот крыла дал бы ложный всплеск.
    const memory = !!wing?.unsteady;
    let target: [number, number] = [pitchC.initial, twistC ? twistC.initial : 0];
    let rate: [number, number] = [0, 0];
    let settle = false;
    const slewSteps = Math.max(1, Math.round(0.1 / osc.freqHz / sim.dt));
    const apply = (x: [number, number]) => {
      const cur: [number, number] = [sim.channels[pitchC.channel], twistC ? sim.channels[twistC.channel] : 0];
      const changed = Math.abs(x[0] - target[0]) > 1e-9 || Math.abs(x[1] - target[1]) > 1e-9;
      target = x;
      t.pitchDeg = x[0];
      if (memory) {
        rate = [Math.abs(x[0] - cur[0]) / slewSteps, Math.abs(x[1] - cur[1]) / slewSteps];
        if (changed) settle = true;
      } else {
        sim.channels[pitchC.channel] = x[0];
        if (twistC) sim.channels[twistC.channel] = x[1];
      }
    };
    const slew = () => {
      if (!memory) return;
      const p = sim.channels[pitchC.channel];
      sim.channels[pitchC.channel] = p + clamp(target[0] - p, -rate[0], rate[0]);
      if (twistC) {
        const w = sim.channels[twistC.channel];
        sim.channels[twistC.channel] = w + clamp(target[1] - w, -rate[1], rate[1]);
      }
    };
    this.ctl = () => {
      const s = sim.sample;
      if (sim.t < this.rampEnd) return;
      slew();
      const k = Math.floor(sim.actuatorPhase(osc.id) / (2 * Math.PI));
      if (lastCycle < 0) lastCycle = k;
      if (started) {
        cyc.lift += s.aeroForce.y;
        cyc.thrust += s.aeroForce.x; // поток идёт против x: положительная сила — тяга больше сопротивления
        cyc.power += s.power;
        cyc.rec += s.powerRecovered;
        cyc.peak = Math.max(cyc.peak, s.power);
        cyc.n++;
      }
      if (k === lastCycle) return;
      lastCycle = k;
      if (settle) {
        // Цикл установления после смены настроек — в зачёт не идёт.
        settle = false;
        cycles++;
        cyc = { lift: 0, thrust: 0, power: 0, rec: 0, peak: 0, n: 0 };
        return;
      }
      // Граница цикла: итог прошедшего цикла — планировщику, от него — настройки на следующий.
      let next: IteratorResult<[number, number], void>;
      if (!started) {
        started = true;
        next = it.next();
      } else {
        cycles++;
        const nn = Math.max(1, cyc.n);
        next = it.next({ lw: cyc.lift / nn / W, tw: cyc.thrust / nn / W, power: cyc.power / nn, rec: cyc.rec / nn, peak: cyc.peak });
      }
      cyc = { lift: 0, thrust: 0, power: 0, rec: 0, peak: 0, n: 0 };
      if (next.done) {
        t.cycles = cycles;
        // Если на измерении что-то сломалось, отпускать нечего: вердикт — «Разрушается».
        if (release && t.trimmed && !sim.events.length) startFree();
        else this.finish();
      } else apply(next.value);
    };

    // ---------- свободный полёт ----------
    // Тот же режим, но корпус отпущен. Аппарат летит в неподвижном воздухе; движение вперёд и по высоте
    // свободно, курс и наклон корпуса удерживаются (хвостовое оперение не моделируется).
    // Автопилот раз в цикл взмаха поправляет угол установки крыльев (высота) и закручивание (скорость):
    // чаще нельзя — подъёмная сила за взмах меняется в разы, а поток «помнит» прошлое.
    const startFree = () => {
      this.fastForward = false;
      this.phase = 'свободный полёт';
      sim.boost(v3(speed, 0, 0)); // из трубы — на землю: встречный поток превращается в скорость аппарата
      sim.lockRoot('level');
      const rb = sim.root.b.rb;
      const g = sim.g;
      const T = 1 / osc.freqHz;
      const rad = Math.PI / 180;
      const tStart = sim.t;
      const pitch0 = target[0];
      const twist0 = target[1];
      // Состояние берётся на границах взмаха — в одной и той же фазе, поэтому покачивание корпуса
      // внутри взмаха в разности не входит.
      type Mark = { x: number; y: number; v: number };
      const mark = (): Mark => ({ x: rb.translation().x, y: rb.translation().y, v: rb.linvel().x });
      const marks: Mark[] = [mark()];
      sim.measureHold = true;
      const hold = { sum: 0, n: 0, lo: Infinity, hi: -Infinity, rx: 0, ry: 0 };
      const y0 = marks[0].y;
      const powers: { power: number; rec: number }[] = [];
      let cyc = { power: 0, rec: 0, n: 0 };
      let peak = 0;
      let last = Math.floor(sim.actuatorPhase(osc.id) / (2 * Math.PI));
      // Автопилот. У крыла просадка гасит сама себя (снижаясь, крыло встречает поток под большим углом),
      // поэтому за взмах устанавливается скорость снижения, пропорциональная отклонению угла установки
      // от балансировочного: vy = V·Δθ. Так же тяга: ускорение пропорционально отклонению закручивания.
      // Автопилот по каждому взмаху уточняет балансировочные значения (pitchTrim, twistTrim) и добавляет
      // поправку, которая за взмах убирает долю KH (KV) ошибки по высоте (скорости).
      const KH = 0.35, KV = 0.35, BETA = 0.5;
      const SKIP = 4; // первые взмахи после отпускания — переходные, в зачёт не идут
      let pitchTrim = pitch0;
      let twistTrim = twist0;
      let pitchNow = pitch0;
      let twistNow = twist0;
      let pRange: [number, number] = [pitch0, pitch0];
      let wRange: [number, number] = [twist0, twist0];
      const done = (grounded: boolean) => {
        t.pitchDeg = pitch0; // в отчёте о трубе — угол найденного режима, а не последняя поправка автопилота
        const a = marks[Math.min(SKIP, marks.length - 1)];
        const b = marks[marks.length - 1];
        const eh = (m: Mark) => m.y + (m.v * m.v) / (2 * g);
        const dist = b.x - a.x;
        const net = dist > 1e-6 ? (W * (eh(b) - eh(a))) / dist : 0;
        const used = powers.slice(Math.min(SKIP, Math.max(0, powers.length - 1)));
        const mean = (fn: (m: { power: number; rec: number }) => number) => (used.length ? used.reduce((sum, m) => sum + fn(m), 0) / used.length : 0);
        const ys = marks.map((m) => m.y);
        const vs = marks.map((m) => m.v);
        sim.measureHold = false;
        const holdMean = hold.n ? hold.sum / hold.n : 0;
        const qS = 0.5 * sim.rho * speed * speed * S;
        const cBar = wings.length ? wings.reduce((m, a) => m + area(a) * (a.rootChord + a.tipChord) / 2, 0) / Math.max(S, 1e-9) : 1;
        this.r.free = {
          speed, duration: sim.t - tStart, cycles: marks.length - 1, distance: b.x - marks[0].x,
          altitudeStart: y0, altitudeEnd: b.y, altitudeMin: Math.min(...ys), altitudeMax: Math.max(...ys),
          speedEnd: b.v, speedMin: Math.min(...vs),
          netForce: net, netForceToWeight: net / W,
          power: mean((m) => m.power), powerRecovered: Math.max(0, mean((m) => m.rec)), powerPeak: peak,
          pitchRange: pRange, ...(twistC ? { twistRange: wRange } : {}),
          grounded,
          ...(hold.n ? { pitchHold: {
            mean: holdMean, amp: (hold.hi - hold.lo) / 2, cm: qS > 0 ? holdMean / (qS * cBar) : 0,
            rollYaw: Math.max(Math.abs(hold.rx / hold.n), Math.abs(hold.ry / hold.n)),
            swingDeg: (hold.hi - hold.lo) / 2 / (sim.inertiaAbout(sim.systemCom(), v3(0, 0, 1)) * (2 * Math.PI * osc.freqHz) ** 2) / rad,
          } } : {}),
        };
        this.finish();
      };
      this.ctl = () => {
        const s = sim.sample;
        slew();
        cyc.power += s.power;
        cyc.rec += s.powerRecovered;
        cyc.n++;
        if (powers.length >= SKIP) {
          peak = Math.max(peak, s.power);
          const M = sim.holdTorque;
          hold.sum += M.z;
          hold.n++;
          hold.lo = Math.min(hold.lo, M.z);
          hold.hi = Math.max(hold.hi, M.z);
          hold.rx += M.x;
          hold.ry += M.y;
        }
        // Полёт прерывается, если что-то сломалось, просадка съела запас высоты (дальше законцовки
        // заденут землю) или скорость потеряна.
        if (sim.events.length || rb.translation().y < y0 - 0.8 * clearance || rb.linvel().x < 0.3 * speed) {
          marks.push(mark());
          return done(true);
        }
        const k = Math.floor(sim.actuatorPhase(osc.id) / (2 * Math.PI));
        if (k === last) return;
        last = k;
        const p = marks[marks.length - 1];
        const m = mark();
        marks.push(m);
        const nn = Math.max(1, cyc.n);
        powers.push({ power: cyc.power / nn, rec: cyc.rec / nn });
        cyc = { power: 0, rec: 0, n: 0 };
        if (marks.length - 1 >= freeCycles) return done(false);
        const V = Math.max(m.v, 0.5 * speed);
        const vy = (m.y - p.y) / T;
        const ax = (m.v - p.v) / T;
        pitchTrim = clamp(pitchTrim + BETA * (pitchNow - vy / (V * rad) - pitchTrim), pitchC.min, pitchC.max);
        const pitch = clamp(pitchTrim - clamp((KH * (m.y - y0)) / (V * T * rad), -3, 3), pitchC.min, pitchC.max);
        let twist = twistNow;
        if (twistC && trimInfo.thrustSlope !== 0) {
          const gain = g * trimInfo.thrustSlope; // ускорение на единицу закручивания
          twistTrim = clamp(twistTrim + BETA * (twistNow - ax / gain - twistTrim), trimInfo.twistMin, trimInfo.twistMax);
          twist = clamp(twistTrim - (KV * (m.v - speed)) / (T * gain), trimInfo.twistMin, trimInfo.twistMax);
        }
        pitchNow = pitch;
        twistNow = twist;
        pRange = [Math.min(pRange[0], pitch), Math.max(pRange[1], pitch)];
        wRange = [Math.min(wRange[0], twist), Math.max(wRange[1], twist)];
        apply([pitch, twist]);
      };
    };
  }

  // ---------- висение ----------

  private setupHover() {
    const sim = this.sim;
    const lift = this.control('lift');
    if (!lift) {
      this.notApplicable(tr('в спецификации нет органа управления подъёмной силой (controls с role: "lift")', 'the specification has no lift control (controls with role: "lift")'));
      return;
    }
    const thr = this.control('throttle');
    if (thr) sim.channels[thr.channel] = 1;
    sim.lockRoot('fixed'); // на время раскрутки держим на месте
    const h0 = this.spec.parts.find((p) => p.id === sim.root.spec.id)!.position[1];
    const target = h0 + (this.opts.hoverHeight ?? 5);
    const hold = this.opts.holdTime ?? 10;
    const g = sim.g;
    let u = lift.initial;
    let aMeas = 0;
    let holdStart = -1;
    let climbStart = -1;
    let satTime = 0;
    let maxDev = 0;
    let pSum = 0;
    let uSum = 0;
    let n = 0;
    let liftAtMax = new Window(Math.round(1 / sim.dt));
    const tau = 0.15;
    (this as { timeLimit: number }).timeLimit = this.rampEnd + 12 + hold;
    this.phase = 'раскрутка';
    this.ctl = () => {
      const s = sim.sample;
      const rb = sim.root.b.rb;
      if (sim.t < this.rampEnd) {
        sim.channels[lift.channel] = u;
        return;
      }
      if (climbStart < 0) {
        climbStart = sim.t;
        sim.lockRoot('vertical');
        this.phase = 'подъём';
      }
      const a = sim.root.b.acc.y;
      aMeas += (sim.dt / tau) * (a - aMeas);
      const h = rb.translation().y;
      // Мягче, чем было (1,0 и 1,8): на малой плотности внутренний контур (шаг → ускорение) медленнее, и с прежними
      // коэффициентами регулятор раскачивался — у R22 на 1524 м высота гуляла на ±3 м и висение не засчитывалось.
      const aCmd = clamp(0.4 * (target - h) - 1.2 * s.vz, -0.3 * g, 0.3 * g);
      u = clamp(u + (lift.gain ?? 0.5) * (aCmd - aMeas) * sim.dt, lift.min, lift.max);
      sim.channels[lift.channel] = u;
      const saturated = u >= lift.max - 1e-9 && aMeas < aCmd - 0.5;
      if (saturated) {
        satTime += sim.dt;
        liftAtMax.push(s.liftToWeight);
      }
      if (holdStart < 0 && ((Math.abs(h - target) < 0.5 && Math.abs(s.vz) < 0.3) || sim.t - climbStart > 10)) {
        holdStart = sim.t;
        this.phase = 'висение';
      }
      if (holdStart >= 0) {
        maxDev = Math.max(maxDev, Math.abs(h - target));
        pSum += s.power;
        uSum += u;
        n++;
      }
      // Тяги не хватает: на максимуме управления три секунды подряд — дальше смысла нет.
      if (satTime > 3 && h < target - 1) {
        this.r.hover = { achieved: false, channel: u, saturated: true, power: s.power, liftToWeightAtMax: liftAtMax.mean };
        this.r.notes.push(tr('на максимуме управления подъёмная сила меньше веса', 'at full control the lift is below the weight'));
        this.finish();
        return;
      }
      if (holdStart >= 0 && sim.t - holdStart >= hold) {
        const intact = sim.events.length === 0;
        this.r.hover = {
          achieved: intact && maxDev < 2, channel: uSum / n, saturated: satTime > 0.5, power: pSum / n,
          liftToWeightAtMax: liftAtMax.mean,
        };
        this.finish();
      }
    };
  }

  // ---------- полёт самолёта ----------

  private setupFlight(maxManoeuvre: boolean) {
    const sim = this.sim;
    const thrC = this.control('throttle');
    const pitchC = this.control('pitch');
    if (!thrC || !pitchC) {
      this.notApplicable(tr('нужны органы управления «газ» и «тангаж» (controls с role: "throttle" и "pitch")', 'throttle and pitch controls are required (controls with role: "throttle" and "pitch")'));
      return;
    }
    sim.lockRoot('planar');
    const rb = sim.root.b.rb;
    // Есть элероны — после отрыва аппарат летит со всеми шестью степенями свободы, крен и курс держит боковой автопилот.
    // Разбег — в плоскости (колёса на полосе не рулятся).
    const rollC = this.control('roll');
    const yawC = this.control('yaw');
    let free = false;
    let rollI = 0;
    let yawI = 0;
    let psi0 = NaN;
    const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
    const lateralHold = () => {
      const s = sim.sample;
      const wb = unrotate(rb.rotation(), copy(rb.angvel())); // угловая скорость в осях корпуса
      const pDeg = (wb.x * 180) / Math.PI; // + крен вправо
      const k = clamp((40 / Math.max(10, s.airspeed)) ** 2, 0.3, 4);
      if (Number.isNaN(psi0)) psi0 = s.headingDeg;
      // Курс держится креном (не больше 15°), крен — элеронами, скольжение убирается рулём направления.
      const phiCmd = clamp(0.8 * wrap180(psi0 - s.headingDeg), -15, 15);
      const e = phiCmd - s.rollDeg;
      rollI = clamp(rollI + 0.3 * e * sim.dt * k, rollC!.min, rollC!.max);
      sim.channels[rollC!.channel] = clamp(rollI + k * (0.8 * e - 0.3 * pDeg), rollC!.min, rollC!.max);
      if (yawC) {
        yawI = clamp(yawI + 0.5 * s.betaDeg * sim.dt * k, yawC.min, yawC.max);
        sim.channels[yawC.channel] = clamp(yawI + k * 1.5 * s.betaDeg, yawC.min, yawC.max);
      }
    };
    const h0 = rb.translation().y;
    const x0 = rb.translation().x;
    const vs = estimateStallSpeed(this.spec, sim.rho, sim.totalMass);
    const vr = 1.2 * vs;
    const hT = h0 + 40;
    const f = (this.r.flight = { airborne: false } as NonNullable<ProgramResult['flight']>);
    let thetaI = 0;
    let pitchI = 0;
    let thrI = 0.6;
    let vCmd = 0;
    let phaseStart = 0;
    let vMaxWin = new Window(Math.round(3 / sim.dt));
    const cruiseWin = new Window(Math.round(16 / sim.dt));
    const thrWin = new Window(Math.round(16 / sim.dt));
    const rpmWin = new Window(Math.round(3 / sim.dt));
    const cruiseRpm = new Window(Math.round(16 / sim.dt));
    const cruiseEta = new Window(Math.round(16 / sim.dt));
    const climbRpm = new Window(Math.round(8 / sim.dt));
    const climbEta = new Window(Math.round(8 / sim.dt));
    const hasRpm = () => sim.sample.propRpm > 0;
    let vMinHeld = Infinity;
    let peakN = 0;
    let vPrev3 = 0;
    let settled = false;
    const nLimit = this.spec.limits?.loadFactor ?? 3.8;
    let nLp = 1;
    let reachedAt = -1;
    (this as { timeLimit: number }).timeLimit = this.opts.cruiseSpeed || this.opts.climbSpeed ? 480 : 240;
    const spdWin = new Window(Math.round(8 / sim.dt));
    const vzWin = new Window(Math.round(8 / sim.dt));
    const cruiseSpd = new Window(Math.round(16 / sim.dt));
    const cruiseVz = new Window(Math.round(16 / sim.dt));
    const setPhase = (p: string) => {
      this.phase = p;
      phaseStart = sim.t;
    };
    setPhase('разбег');

    const pitchHold = (thetaCmd: number) => {
      const s = sim.sample;
      const q = (rb.angvel().z * 180) / Math.PI; // град/с, + нос вверх
      const e = thetaCmd - s.pitchDeg;
      const k = clamp((40 / Math.max(10, s.airspeed)) ** 2, 0.3, 4);
      pitchI = clamp(pitchI + 0.6 * e * sim.dt * k, pitchC.min, pitchC.max);
      sim.channels[pitchC.channel] = clamp(pitchI + k * (1.5 * e - 0.5 * q), pitchC.min, pitchC.max);
    };
    const altitudeHold = (h: number) => {
      const s = sim.sample;
      const vzCmd = clamp(0.3 * (h - rb.translation().y), -4, 4);
      thetaI = clamp(thetaI + 1.5 * (vzCmd - s.vz) * sim.dt, -10, 25);
      pitchHold(clamp(thetaI + 2.5 * (vzCmd - s.vz), -10, 25));
    };
    // Красная черта оборотов. У винта фиксированного шага обороты растут со скоростью, и на полном газе в горизонтальном
    // полёте у земли мотор раскрутился бы выше допустимых; пилот прибирает газ, чтобы держать не больше номинальных
    // (POH 172S, раздел 2: 2700 об/мин). Так же и здесь: газ ограничивается сверху, пока обороты выше ratedRpm.
    const rpmLimit = sim.spec.actuators.some((a) => a.type === 'propeller' && a.fixedPitch) ? sim.spec.powerplant.ratedRpm ?? Infinity : Infinity;
    let thrCap = 1;
    const setThrottle = (x: number) => {
      if (Number.isFinite(rpmLimit)) thrCap = clamp(thrCap + 20 * (1 - sim.sample.propRpm / rpmLimit) * sim.dt, 0.05, 1);
      sim.channels[thrC.channel] = Math.min(x, thrCap);
    };
    const elevatorSaturated = () => sim.channels[pitchC.channel] >= pitchC.max - 0.5;
    const speedHold = (v: number, kp = 0.08) => {
      const err = v - sim.sample.airspeed;
      thrI = clamp(thrI + 0.03 * err * sim.dt, 0, Math.min(1, thrCap));
      setThrottle(clamp(thrI + kp * err, 0, 1));
    };

    this.ctl = () => {
      const s = sim.sample;
      const h = rb.translation().y;
      const dt = sim.t - phaseStart;
      if (free) lateralHold();
      switch (this.phase) {
        case 'разбег':
          setThrottle(1);
          pitchHold(0);
          if (s.airspeed >= vr) {
            f.vRotate = s.airspeed;
            setPhase('отрыв');
          } else if (sim.t > 90) {
            this.r.notes.push(tr(`за 90 с разбега не набрана скорость отрыва ${n(vr)} м/с`, `lift-off speed ${n(vr)} m/s not reached in a 90 s run`));
            this.finish();
          }
          break;
        case 'отрыв':
          setThrottle(1);
          pitchHold(10);
          if (h > h0 + 0.5 && f.takeoffDistance === undefined) {
            f.takeoffDistance = rb.translation().x - x0;
            f.airborne = true;
          }
          if (h > h0 + 10) {
            thetaI = s.pitchDeg;
            if (rollC && !free) {
              sim.lockRoot('free');
              free = true;
            }
            setPhase('набор');
          } else if (dt > 20) {
            this.r.notes.push(tr('после отрыва аппарат не набирает высоту', 'after lift-off it does not climb'));
            this.finish();
          }
          break;
        case 'набор':
          setThrottle(1);
          altitudeHold(hT);
          if (h > hT - 2) {
            f.levelReached = true;
            if (this.opts.climbSpeed) {
              thetaI = s.pitchDeg;
              setPhase('набор на заданной скорости');
            } else setPhase('горизонтальный полёт');
          }
          else if (dt > 60) {
            this.r.notes.push(tr('не хватает тяги для набора высоты', 'not enough thrust to climb'));
            this.finish();
          }
          break;
        case 'горизонтальный полёт': {
          setThrottle(1);
          altitudeHold(hT);
          vMaxWin.push(s.airspeed);
          rpmWin.push(s.propRpm);
          // Максимальная скорость — когда разгон практически закончился.
          if (dt > 3 && sim.steps % Math.round(3 / sim.dt) === 0) {
            const accel = (s.airspeed - vPrev3) / 3;
            vPrev3 = s.airspeed;
            if (Math.abs(accel) < 0.03 && dt > 10) settled = true;
          }
          if (settled || dt > 90) {
            f.vMax = vMaxWin.mean;
            if (hasRpm()) f.vMaxRpm = rpmWin.mean;
            thrI = 1;
            if (maxManoeuvre) setPhase('манёвр');
            else if (this.opts.cruiseSpeed) {
              vCmd = this.opts.cruiseSpeed;
              setPhase('крейсерский режим');
            } else {
              vCmd = s.airspeed;
              setPhase('торможение');
            }
          }
          break;
        }
        case 'крейсерский режим': {
          altitudeHold(hT);
          // Регулятор скорости здесь задемпфирован сильнее (0,25 вместо 0,08 на м/с): со слабым газ и скорость
          // колебались с периодом около 40 с и затухали за минуты.
          speedHold(vCmd, 0.25);
          cruiseWin.push(s.propPower);
          thrWin.push(sim.channels[thrC.channel]);
          cruiseSpd.push(s.airspeed);
          cruiseVz.push(s.vz);
          cruiseRpm.push(s.propRpm);
          cruiseEta.push(s.propEfficiency);
          // Мощность снимается на установившемся режиме: последние 16 с скорость держится в пределах 0,2 м/с,
          // высота не меняется, газ не гуляет. Раньше она снималась на 22–30 с после выхода с наибольшей скорости,
          // когда регулятор ещё не успокоился: на 112 узлах на 8000 ft — 78 кВт при установившихся ~68.
          const steady = Math.abs(cruiseSpd.mean - vCmd) < 0.2 && Math.abs(cruiseVz.mean) < 0.05 && thrWin.std < 0.004;
          if (dt > 40 && sim.steps % Math.round(1 / sim.dt) === 0 && (steady || dt > 200)) {
            f.cruiseSpeed = vCmd;
            f.cruisePower = cruiseWin.mean;
            f.cruiseThrottle = thrWin.mean;
            f.cruiseSteady = steady;
            if (hasRpm()) {
              f.cruiseRpm = cruiseRpm.mean;
              f.cruisePropEfficiency = cruiseEta.mean;
            }
            if (!steady) this.r.notes.push(tr(`крейсерский режим не установился за 200 с: скорость ${n(cruiseSpd.mean)} м/с`, `the cruise did not settle in 200 s: speed ${n(cruiseSpd.mean)} m/s`));
            vCmd = s.airspeed;
            setPhase('торможение');
          }
          break;
        }
        case 'набор на заданной скорости': {
          // Установившийся набор на полном газе: скорость держится рулём высоты (нос выше — скорость меньше).
          setThrottle(1);
          const vC = this.opts.climbSpeed!;
          const e = s.airspeed - vC;
          thetaI = clamp(thetaI + 0.4 * e * sim.dt, -5, 25);
          pitchHold(clamp(thetaI + 1.5 * e, -5, 25));
          if (dt > 30) {
            spdWin.push(s.airspeed);
            vzWin.push(s.vz);
            climbRpm.push(s.propRpm);
            climbEta.push(s.propEfficiency);
          }
          if (dt > 30 + 8) {
            f.climbSpeed = spdWin.mean;
            f.climbRate = vzWin.mean;
            if (hasRpm()) {
              f.climbRpm = climbRpm.mean;
              f.climbPropEfficiency = climbEta.mean;
            }
            if (Math.abs(spdWin.mean - vC) > 0.5) this.r.notes.push(tr(`скорость набора не удержана: ${n(spdWin.mean)} м/с`, `the climb speed was not held: ${n(spdWin.mean)} m/s`));
            this.finish();
          }
          break;
        }
        case 'торможение':
          vCmd = Math.max(0, vCmd - 0.5 * sim.dt); // как при испытаниях: около 1 узла в секунду
          altitudeHold(hT);
          speedHold(vCmd);
          // Минимальная скорость установившегося полёта: высота держится, руль не на упоре.
          if (Math.abs(h - hT) < 3 && !elevatorSaturated()) vMinHeld = Math.min(vMinHeld, s.airspeed);
          if (elevatorSaturated() && !f.elevatorLimited && s.stalledFrac < 0.3) f.elevatorLimited = true;
          if (h < hT - 6 || dt > 150) {
            f.vStall = vMinHeld;
            if (f.elevatorLimited) this.r.notes.push(tr('минимальную скорость ограничил руль высоты, а не срыв на крыле', 'the minimum speed was limited by the elevator, not by wing stall'));
            this.finish();
          }
          break;
        case 'манёвр': {
          // Быстрый выход на расчётную перегрузку и удержание 0,5 с — симметричный манёвр (как при сертификации:
          // конструкция должна выдержать её с запасом 1,5).
          setThrottle(1);
          const nCmd = Math.min(nLimit, 1 + (nLimit - 1) * Math.min(1, dt / 1.2));
          nLp += (1 - Math.exp(-2 * Math.PI * 8 * sim.dt)) * (s.loadFactor - nLp);
          pitchI = clamp(pitchI + 12 * (nCmd - nLp) * sim.dt, pitchC.min, pitchC.max);
          sim.channels[pitchC.channel] = pitchI;
          peakN = Math.max(peakN, nLp);
          if (nLp >= nLimit * 0.95 && reachedAt < 0) reachedAt = sim.t;
          if ((reachedAt >= 0 && sim.t - reachedAt > 0.5) || dt > 4) {
            f.loadFactor = peakN;
            if (reachedAt < 0) this.r.notes.push(tr(`расчётная перегрузка ${n(nLimit)} не достигнута: не хватает руля или крыло срывается`, `the design load factor ${n(nLimit)} was not reached: not enough elevator or the wing stalls`));
            this.finish();
          }
          break;
        }
      }
    };
  }

// ---------- стресс-тесты самолёта (нормы FAR 23 / CS-23, data/stress-tests.md) ----------

  private setupStress() {
    const sim = this.sim;
    const thrC = this.control('throttle');
    const pitchC = this.control('pitch');
    const rollC = this.control('roll');
    const yawC = this.control('yaw');
    if (!thrC || !pitchC) {
      this.notApplicable(tr('нужны органы управления «газ» и «тангаж»', 'throttle and pitch controls are required'));
      return;
    }
    (this as { timeLimit: number }).timeLimit = 1500;
    const rb = sim.root.b.rb;
    const steps: StressStep[] = (this.r.stress = []);
    const k = Math.sqrt(sim.rho / 1.225); // истинная → приборная (эквивалентная) скорость: EAS = TAS·√σ
    const KT = 0.514444;
    const eas = () => sim.sample.airspeed * k;
    const W = sim.totalMass * sim.g;
    let S = 0, cS = 0, arS = 0;
    for (const p of this.spec.parts) {
      const a = p.aero;
      if (!a || p.kind !== 'wing' || a.role === 'tail') continue;
      const A = surfaceArea(a);
      S += A;
      cS += A * (A / a.span);
      arS += A * (a.aspectRatio ?? (2 * a.span * a.span) / A);
    }
    const chord = S > 0 ? cS / S : 1, AR = S > 0 ? arS / S : 6;
    // Скорости по нормам (§23.335, нормальная категория): VC ≥ 33·√(W/S) узлов (W/S в фунтах на кв. фут), VD ≥ 1,4·VC,
    // VA = VS·√n. VS — по c_l,max крыла (стенд сверил её с POH Cessna: 53 KCAS).
    const nLim = this.spec.limits?.loadFactor ?? 3.8;
    const nNeg = -0.4 * nLim; // §23.337(b)
    const wsPsf = W / S / 47.880259;
    const VS = estimateStallSpeed(this.spec, 1.225, sim.totalMass); // приборная
    const VA = VS * Math.sqrt(nLim);
    const VC = 33 * Math.sqrt(wsPsf) * KT;
    const VD = 1.4 * VC;
    const H0 = 1500; // исходная высота над землёй для манёвров, м
    const hMin = 900;
    let lifts = 0;

    // ---- регуляторы ----
    let pitchI = 0, thetaI = 0, thrI = 0.6, rollI = 0, yawI = 0, nLp = 1;
    const rates = () => {
      const w = unrotate(rb.rotation(), copy(rb.angvel()));
      return { p: (w.x * 180) / Math.PI, r: -(w.y * 180) / Math.PI, q: (w.z * 180) / Math.PI };
    };
    const gain = () => clamp((40 / Math.max(10, sim.sample.airspeed)) ** 2, 0.3, 4);
    const setPitch = (x: number) => (sim.channels[pitchC.channel] = clamp(x, pitchC.min, pitchC.max));
    // Тангаж: команда нарастает не быстрее 15°/с, а перегрузка ограничена (от 0,5 до 0,7 предельной) — как пилот,
    // который не дёргает ручку при выводе в горизонт. Манёвры с перегрузкой идут через nHold, без этих ограничений.
    let thS = 0, thT = -1;
    const pitchHold = (thetaCmd: number) => {
      const s = sim.sample, g = gain();
      if (sim.t - thT > 3 * sim.dt) thS = s.pitchDeg;
      thT = sim.t;
      thS += clamp(thetaCmd - thS, -15 * sim.dt, 15 * sim.dt);
      const nn = nLpUpd();
      if (nn > 0.7 * nLim && thS > s.pitchDeg) { nHold(0.7 * nLim); return; }
      if (nn < 0.5 && thS < s.pitchDeg) { nHold(0.5); return; }
      const e = thS - s.pitchDeg;
      pitchI = clamp(pitchI + 0.6 * e * sim.dt * g, pitchC.min, pitchC.max);
      setPitch(pitchI + g * (1.5 * e - 0.5 * rates().q));
    };
    const climbHold = (vzCmd: number) => {
      const s = sim.sample;
      thetaI = clamp(thetaI + 1.5 * (vzCmd - s.vz) * sim.dt, -30, 30);
      pitchHold(clamp(thetaI + 2.5 * (vzCmd - s.vz), -30, 30));
    };
    const altHold = (h: number) => climbHold(clamp(0.3 * (h - rb.translation().y), -6, 6));
    // Обороты винта фиксированного шага — не выше номинальных (как делает пилот).
    const rpmLimit = this.spec.actuators.some((a) => a.type === 'propeller' && a.fixedPitch) ? this.spec.powerplant.ratedRpm ?? Infinity : Infinity;
    let thrCap = 1;
    const setThrottle = (x: number) => {
      if (Number.isFinite(rpmLimit)) thrCap = clamp(thrCap + 20 * (1 - sim.sample.propRpm / rpmLimit) * sim.dt, 0.05, 1);
      sim.channels[thrC.channel] = clamp(Math.min(x, thrCap), 0, 1);
    };
    const speedHold = (vEas: number) => {
      const err = vEas - eas();
      thrI = clamp(thrI + 0.03 * err * sim.dt, 0, 1);
      setThrottle(thrI + 0.25 * err);
    };
    // Перегрузка — рулём высоты: интеграл ошибки по сглаженной перегрузке (как в манёвре программы «Максимальный режим»).
    let nLpT = -1;
    const nLpUpd = () => {
      if (nLpT !== sim.t) { nLp += (1 - Math.exp(-2 * Math.PI * 8 * sim.dt)) * (sim.sample.loadFactor - nLp); nLpT = sim.t; }
      return nLp;
    };
    const nHold = (nCmd: number) => {
      const e = nCmd - nLpUpd();
      pitchI = clamp(pitchI + 30 * e * sim.dt, pitchC.min, pitchC.max);
      setPitch(pitchI + 3 * e - 0.3 * rates().q);
    };
    // Срыв на основном крыле: доля сорванных сечений несущих крыльев (оперение не в счёт — у него срыв от руля).
    const mainStalled = () => {
      let a = 0, b = 0;
      for (const p of sim.parts) if (p.spec.aero && p.spec.kind === 'wing' && p.spec.aero.role !== 'tail' && !p.broken) for (const e of p.elements) { b++; if (e.stalled) a++; }
      return b ? a / b : 0;
    };
    const lateral = (phiCmd: number) => {
      const s = sim.sample, g = gain();
      if (rollC) {
        const e = phiCmd - s.rollDeg;
        rollI = clamp(rollI + 0.3 * e * sim.dt * g, rollC.min, rollC.max);
        sim.channels[rollC.channel] = clamp(rollI + g * (0.8 * e - 0.3 * rates().p), rollC.min, rollC.max);
      }
      if (yawC) {
        yawI = clamp(yawI + 0.5 * s.betaDeg * sim.dt * g, yawC.min, yawC.max);
        sim.channels[yawC.channel] = clamp(yawI + g * 1.5 * s.betaDeg, yawC.min, yawC.max);
      }
    };
    const fixLateral = () => {
      if (rollC) sim.channels[rollC.channel] = 0;
      if (yawC) sim.channels[yawC.channel] = 0;
    };
    const kt = (v: number) => n(v / KT);
    const ensureAltitude = (need = hMin) => {
      const h = rb.translation().y;
      if (h < need) {
        sim.shift(v3(0, Math.max(H0, need + 500) - h, 0));
        lifts++;
      }
    };

    // ---- шаги ----
    type Step = { id: string; name: string; target: string; dur?: number; run: (t: number, rec: Rec) => boolean };
    type Rec = { nMax: number; nMin: number; margin: number; part: string; vMax: number; rollMax: number; rollMin: number; betaMax: number; h0: number; x: Record<string, number> };
    const newRec = (): Rec => ({ nMax: -Infinity, nMin: Infinity, margin: Infinity, part: '', vMax: 0, rollMax: -Infinity, rollMin: Infinity, betaMax: 0, h0: rb.translation().y, x: {} });
    const pass = (rec: Rec, extra = true) => rec.margin >= 1.5 && extra;
    const marginText = (rec: Rec) => (Number.isFinite(rec.margin) ? tr(`запас прочности ${n(rec.margin)} (${rec.part})`, `safety margin ${n(rec.margin)} (${rec.part})`) : tr('прочность не проверялась', 'strength not checked'));
    const out = (st: Step, rec: Rec, ok: boolean | null, values: [string, string][], note?: string) =>
      steps.push({ id: st.id, name: st.name, target: st.target, pass: ok, values: [...values, [tr('Прочность', 'Strength'), marginText(rec)]], note });

    // Выход на режим: горизонтальный полёт на заданной приборной скорости (не дольше 40 с).
    // Скорость — тангажом (каскад «скорость → вертикальная скорость → тангаж»): так пилот держит скорость на снижении,
    // фугоида демпфируется контуром вертикальной скорости.
    let vzI = 0;
    const speedOnPitch = (v: number, vzMin = -40) => {
      const e = eas() - v;
      vzI = clamp(vzI + 0.1 * e * sim.dt, vzMin, 5);
      climbHold(clamp(vzI + 1.0 * e, vzMin, 5));
    };
    let dive = false, okT = 0;
    const trimAt = (v: number) => (t: number) => {
      if (t < sim.dt * 1.5) { dive = false; okT = 0; }
      lateral(0);
      if (!dive && t > 10 && thrI > 0.98 && eas() < v - 2) { dive = true; vzI = sim.sample.vz; } // горизонтом не набирается — со снижением
      if (dive) {
        setThrottle(1);
        speedOnPitch(v);
      } else {
        altHold(stepH);
        speedHold(v);
      }
      // Установившийся режим: скорость, перегрузка 1 и (в горизонте) вертикальная скорость — 2 с подряд.
      const steady = Math.abs(eas() - v) < 1.5 && Math.abs(nLpUpd() - 1) < 0.05 && Math.abs(rates().q) < 1;
      okT = steady && (dive || Math.abs(sim.sample.vz) < 0.5) ? okT + sim.dt : 0;
      return okT > 2 || t > 90;
    };
    // Симметричный манёвр с перегрузкой: нарастание 1,5 g/с, удержание 3 с (§23.305: предельная — без остаточных
    // деформаций; расчётная 1,5× — запас прочности ≥ 1,5).
    const pull = (nT: number) => (t: number, rec: Rec) => {
      nHold(1 + (nT - 1) * smooth(t / (nT < 1 ? 1.5 : 0.9)));
      lateral(0);
      setThrottle(thrI);
      if (Math.abs(nLp - nT) < 0.05 * Math.abs(nT - 1) && rec.x.reached === undefined) rec.x.reached = t;
      return (rec.x.reached !== undefined && t - rec.x.reached > 1) || t > 8;
    };
    const nSafe = (nT: number) => Math.min(nT, 0.8 * (eas() / VS) ** 2);
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    let nRec0 = 1;
    const recover = (t: number) => {
      // Сначала плавно снять перегрузку (1,5 с), как пилот после манёвра; потом — горизонт и скорость.
      if (t < sim.dt * 1.5) nRec0 = nLpUpd();
      if (t < 1.5 && Math.abs(nRec0 - 1) > 0.3) {
        nHold(nRec0 + (1 - nRec0) * smooth(t / 1.5));
        lateral(0);
        setThrottle(thrI);
        if (t > 1.5 - 1.5 * sim.dt) { pitchI = sim.channels[pitchC.channel]; thetaI = sim.sample.pitchDeg; }
        return false;
      }
      altHold(stepH);
      speedHold(VA);
      lateral(0);
      return t > 10;
    };
    let stepH = H0;

    const seq: { trim?: number; minH?: number; step: Step; after?: (rec: Rec, st: Step) => void }[] = [];
    // 1–3. Перегрузки по углам диаграммы V–n.
    // На VA предельная перегрузка — на границе срыва, а пока она нарастает (0,9 с), скорость падает. Поэтому вход — на 1,05·VA.
    seq.push({ trim: 1.05 * VA, step: { id: 'pullVA', name: tr(`Перегрузка +${n(nLim)} g на VA`, `+${n(nLim)} g at VA`), target: tr(`VA = ${kt(VA)} узл. (VS·√n), вход на 1,05·VA, 1 с на перегрузке`, `VA = ${kt(VA)} kt (VS·√n), entry at 1.05·VA, 1 s at the load factor`), run: (t, rec) => {
      if (sim.sample.loadFactor > (rec.x.nTop ?? -Infinity)) { rec.x.nTop = sim.sample.loadFactor; rec.x.vTop = eas(); }
      return pull(nLim)(t, rec);
    } },
      after: (rec, st) => out(st, rec, pass(rec), [[tr('Перегрузка', 'Load factor'), n(rec.nMax)], [tr('Скорость на наибольшей перегрузке', 'Speed at the peak load factor'), `${kt(rec.x.vTop ?? NaN)} ${tr('узл.', 'kt')}`]], rec.nMax < 0.95 * nLim ? tr('предельная перегрузка не достигнута: крыло срывается раньше', 'the limit load factor was not reached: the wing stalls first') : undefined) });
    seq.push({ trim: VC, step: { id: 'pullVC', name: tr(`Перегрузка +${n(nLim)} g на VC`, `+${n(nLim)} g at VC`), target: tr(`VC = ${kt(VC)} узл. (33·√(W/S)), 1 с на перегрузке`, `VC = ${kt(VC)} kt (33·√(W/S)), 1 s at the load factor`), run: pull(nLim) },
      after: (rec, st) => out(st, rec, pass(rec), [[tr('Перегрузка', 'Load factor'), n(rec.nMax)]]) });
    seq.push({ trim: VC, step: { id: 'pushVC', name: tr(`Перегрузка ${n(nNeg)} g на VC`, `${n(nNeg)} g at VC`), target: tr('0,4 положительной (§23.337), 1 с на перегрузке', '0.4 of the positive (§23.337), 1 s at the load factor'), run: pull(nNeg) },
      after: (rec, st) => out(st, rec, pass(rec), [[tr('Перегрузка', 'Load factor'), n(rec.nMin)]]) });
    // 4–5. Порывы (§23.333(c), §23.341): 1-cos длиной 25 хорд, ±15,24 м/с на VC; руль закреплён.
    const Ude = 50 * 0.3048;
    const aw = (2 * Math.PI * AR) / (AR + 2);
    const mug = (2 * (W / S)) / (1.225 * chord * aw * sim.g);
    const Kg = (0.88 * mug) / (5.3 + mug);
    const dnFormula = (Kg * Ude * VC * aw * 1.225) / (2 * (W / S));
    for (const sign of [1, -1]) {
      seq.push({ trim: VC, step: {
        id: sign > 0 ? 'gustUp' : 'gustDown', name: sign > 0 ? tr('Порыв вверх на VC', 'Up-gust at VC') : tr('Порыв вниз на VC', 'Down-gust at VC'),
        target: tr(`15,2 м/с (50 ft/s), форма 1 − cos длиной 25 хорд; по формуле норм n = ${n(1 + sign * dnFormula)}`, `15.2 m/s (50 ft/s), 1 − cos shape over 25 chords; regulation formula n = ${n(1 + sign * dnFormula)}`),
        run: (t, rec) => {
          const L = 25 * chord;
          if (rec.x.e === undefined) {
            rec.x.e = sim.channels[pitchC.channel];
            // Порыв неподвижен в воздухе: фронт — в 2 м перед самым передним сечением, по направлению полёта.
            const v = copy(rb.linvel());
            const d = len(v) > 1 ? scale(v, 1 / len(v)) : v3(1, 0, 0);
            let front = -Infinity;
            for (const p of sim.parts) for (const e of p.elements) front = Math.max(front, dot(vsub(add(sim.pose(p).t, rotate(sim.pose(p).q, e.r)), rb.translation()), d));
            const P0 = add(copy(rb.translation()), scale(d, front + 2));
            const up = v3(0, sign * (Ude / 2), 0);
            sim.gustAt = (pt) => {
              const s = dot(vsub(pt, P0), d);
              return s > 0 && s < L ? scale(up, 1 - Math.cos((2 * Math.PI * s) / L)) : v3();
            };
            rec.x.T = (L + 2 + 15) / sim.sample.airspeed; // пока весь самолёт (до 15 м) не выйдет из порыва
          }
          setPitch(rec.x.e);
          setThrottle(thrI);
          fixLateral();
          return t > rec.x.T + 1.5;
        },
      }, after: (rec, st) => { sim.gustAt = null; out(st, rec, pass(rec), [[tr('Перегрузка в модели', 'Model load factor'), n(sign > 0 ? rec.nMax : rec.nMin)], [tr('По формуле норм', 'Regulation formula'), n(1 + sign * dnFormula)]]); } });
    }
    // 6. Резкое движение рулём высоты на VA (§23.423): полностью на себя, затем от себя.
    seq.push({ trim: VA, step: { id: 'checked', name: tr('Резкое движение руля высоты на VA', 'Checked pitch manoeuvre at VA'), target: tr('полностью на себя до предельной перегрузки, затем от себя (§23.423)', 'full aft stick to the limit load factor, then forward (§23.423)'),
      run: (t, rec) => {
        lateral(0);
        setThrottle(thrI);
        if (rec.x.back === undefined && (sim.sample.loadFactor >= nLim || t > 1.5)) rec.x.back = t;
        if (rec.x.back === undefined) setPitch(pitchC.max);
        else if (t - rec.x.back < 0.5) setPitch(pitchC.min);
        else setPitch(0);
        return rec.x.back !== undefined && t - rec.x.back > 2.5;
      } },
      after: (rec, st) => out(st, rec, pass(rec, rec.nMax <= nLim * 1.05), [[tr('Перегрузка', 'Load factor'), `${n(rec.nMax)} / ${n(rec.nMin)}`]], rec.nMax > nLim * 1.05 ? tr('перегрузка превысила предельную: резкий руль на VA перегружает самолёт', 'the load factor exceeded the limit: abrupt elevator at VA overloads the aeroplane') : undefined) });
    // 7. Вывод с креном (§23.349): 2/3 предельной перегрузки и полный элерон.
    if (rollC)
      seq.push({ trim: VA, step: { id: 'rollPull', name: tr('Вывод с креном на VA', 'Rolling pull-out at VA'), target: tr(`из разворота с креном 60°: перегрузка ${n((2 / 3) * nLim)} g (2/3 предельной) и полный элерон на вывод за 0,2 с (§23.349, §23.455)`, `from a 60° banked turn: ${n((2 / 3) * nLim)} g (2/3 of the limit) and full aileron to roll out in 0.2 s (§23.349, §23.455)`),
        run: (t, r) => {
          const s = sim.sample, n23 = (2 / 3) * nLim;
          setThrottle(thrI);
          if (r.x.pull === undefined) {
            // Ввод в разворот с креном 60° (перегрузка 1/cos крена).
            lateral(60);
            nHold(1 / Math.cos((Math.min(Math.abs(s.rollDeg), 60) * Math.PI) / 180));
            if (Math.abs(s.rollDeg - 60) < 5) r.x.bankT ??= t; else delete r.x.bankT;
            if ((r.x.bankT !== undefined && t - r.x.bankT > 0.5) || t > 10) { r.x.pull = t; r.x.n0 = nLpUpd(); }
            return false;
          }
          if (r.x.roll === undefined) {
            lateral(60);
            nHold(r.x.n0 + (n23 - r.x.n0) * smooth((t - r.x.pull) / 0.9));
            if (Math.abs(nLp - n23) < 0.05 * n23 || t - r.x.pull > 3) { r.x.roll = t; r.x.phi0 = s.rollDeg; r.x.pMax = 0; }
            return false;
          }
          if (r.x.off === undefined) {
            // Полный элерон на вывод из крена (влево) за 0,2 с, перегрузка держится; педали нейтрально.
            nHold(n23);
            sim.channels[rollC.channel] = rollC.min * Math.min(1, (t - r.x.roll) / 0.2);
            if (yawC) sim.channels[yawC.channel] = 0;
            r.x.pMax = Math.max(r.x.pMax, Math.abs(rates().p));
            if (s.rollDeg <= r.x.phi0 - 60 || t - r.x.roll > 3) r.x.off = t;
            return false;
          }
          lateral(0);
          nHold(1);
          return t - r.x.off > 1.5;
        } },
        after: (rec, st) => out(st, rec, pass(rec), [[tr('Перегрузка', 'Load factor'), n(rec.nMax)], [tr('Крен', 'Bank'), `${n(rec.x.phi0 ?? NaN)}° → ${n(rec.rollMin)}°`],
          [tr('Наибольшая угловая скорость крена', 'Peak roll rate'), `${n(rec.x.pMax ?? NaN)} °/${tr('с', 's')}`]]) });
    // 8. Полная педаль (§23.351): ступенька до заброса скольжения, затем нейтраль.
    if (yawC)
      seq.push({ trim: VA, step: { id: 'rudder', name: tr('Полная педаль на VA', 'Full rudder at VA'), target: tr('ступенька до наибольшего скольжения, затем нейтраль (§23.351)', 'step to the peak sideslip, then neutral (§23.351)'),
        run: (t) => {
          altHold(stepH);
          setThrottle(thrI);
          if (rollC) sim.channels[rollC.channel] = 0;
          sim.channels[yawC.channel] = t < 3 ? yawC.max * Math.min(1, t / 0.2) : 0;
          return t > 6;
        } },
        after: (rec, st) => out(st, rec, pass(rec), [[tr('Наибольшее скольжение', 'Peak sideslip'), `${n(rec.betaMax)}°`]]) });
    // 9. Пикирование до VD (§23.251, §23.629): разгон на полном газе (не выше номинальных оборотов), 2 с на VD, вывод.
    seq.push({ trim: VC, minH: 2500, step: { id: 'dive', name: tr('Пикирование до VD', 'Dive to VD'), target: tr(`VD = ${kt(VD)} узл. (1,4·VC); вывод с перегрузкой не выше предельной`, `VD = ${kt(VD)} kt (1.4·VC); pull-out within the limit load factor`),
      run: (t, rec) => {
        lateral(0);
        setThrottle(1);
        if (t < 1.5 * sim.dt) vzI = sim.sample.vz;
        if (rec.x.at === undefined) {
          if (eas() >= 0.98 * VD) rec.x.at = t;
          speedOnPitch(VD, -80);
          return t > 120;
        }
        if (t - rec.x.at < 1) {
          speedOnPitch(VD, -80);
          return false;
        }
        nHold(1 + (0.8 * nLim - 1) * smooth((t - rec.x.at - 1) / 1.5));
        return sim.sample.vz > 0 || t - rec.x.at > 15;
      } },
      after: (rec, st) => {
        const fl = this.r.flutter;
        const flOk = !fl || Math.min(fl.vFlutter, fl.vDivergence) > 1.2 * (VD / k);
        const reached = rec.vMax * k >= 0.98 * VD;
        const rpmOk = !Number.isFinite(rpmLimit) || (rec.x.rpm ?? 0) <= 1.1 * rpmLimit;
        out(st, rec, pass(rec, reached && flOk && rpmOk), [[tr('Наибольшая приборная скорость', 'Max equivalent airspeed'), `${kt(rec.vMax * k)} ${tr('узл.', 'kt')}`],
          [tr('Обороты винта', 'Propeller rpm'), `${n(rec.x.rpm ?? 0)}${Number.isFinite(rpmLimit) ? tr(` (номинальные ${n(rpmLimit)}, на VD допускается до ${n(1.1 * rpmLimit)}, §23.33)`, ` (rated ${n(rpmLimit)}, up to ${n(1.1 * rpmLimit)} allowed at VD, §23.33)`) : ''}`], [tr('Флаттер', 'Flutter'), fl ? `${n(Math.min(fl.vFlutter, fl.vDivergence))} ${tr('м/с', 'm/s')} (${tr('нужно > 1,2·VD', 'must exceed 1.2·VD')})` : tr('не проверялся (у крыла не задан кессон)', 'not checked (no torsion box)')]],
          !reached ? tr('VD не достигнута: не хватает высоты или скорость упирается в сопротивление', 'VD was not reached')
            : !rpmOk ? tr('винт фиксированного шага раскрутился выше 110 % номинальных оборотов даже с убранным газом: на пикировании его раскручивает поток', 'the fixed-pitch propeller overspeeds past 110 % of rated rpm even with the throttle closed: in the dive the airflow windmills it')
            : (rec.x.rpm ?? 0) > rpmLimit * 1.02 ? tr('обороты выше номинальных, но в пределах 110 %: газ на пикировании убирается, винт раскручивает поток', 'rpm above rated but within 110 %: the throttle is closed in the dive, the airflow windmills the propeller') : undefined);
      } });
    // 10–12. Сваливания (§23.201, §23.203): торможение 1 узел/с (ускоренное — 4 узла/с), на срыве органы закрепляются.
    const stall = (id: string, name: string, target: string, bank: number, rateKt: number, limits: [number, number]) =>
      seq.push({ trim: 1.5 * VS, step: { id, name, target,
        run: (t, rec) => {
          setThrottle(bank ? thrI : 0);
          if (rec.x.v0 === undefined) { rec.x.v0 = eas(); vzI = sim.sample.vz; }
          if (rec.x.brk === undefined) {
            const vCmd = rec.x.v0 - rateKt * KT * t;
            const s = sim.sample;
            lateral(bank);
            if (bank && rateKt > 2) nHold(Math.min(nLim, 1 / Math.cos((bank * Math.PI) / 180) + 0.5 * t));
            else speedOnPitch(vCmd, -15);
            const sat = sim.channels[pitchC.channel] >= pitchC.max - 0.5;
            if (sat) rec.x.satT ??= t;
            else delete rec.x.satT;
            if (mainStalled() > 0.3 || (rec.x.satT !== undefined && t - rec.x.satT > 1) || t > 90) {
              rec.x.brk = t;
              rec.x.vStall = eas();
              rec.x.phi0 = s.rollDeg;
              rec.x.hBrk = rb.translation().y;
              delete rec.x.hMin;
              rec.rollMax = -Infinity;
              rec.rollMin = Infinity;
            }
            return false;
          }
          // Срыв: 1 с органы закреплены (смотрим, куда валится), затем вывод — ручка от себя до безотрывного обтекания
          // и 1,25·VS, газ, крылья в горизонт; потом выход из снижения с перегрузкой до 2.
          if (t - rec.x.brk < 1) {
            fixLateral();
            return false;
          }
          lateral(0);
          setThrottle(1);
          if (rec.x.unst === undefined) {
            setPitch(-5);
            if (mainStalled() === 0 && eas() > 1.25 * VS) { rec.x.unst = t; rec.x.nU = nLpUpd(); }
          } else nHold(nSafe(rec.x.nU + (2 - rec.x.nU) * smooth((t - rec.x.unst) / 0.9)));
          return (rec.x.unst !== undefined && sim.sample.vz > -1) || t - rec.x.brk > 20;
        } },
        after: (rec, st) => {
          const dir = Math.sign(bank) || 1;
          const over = dir * (rec.x.phi0 ?? 0) >= 0 ? Math.max(dir * rec.rollMax, dir * rec.rollMin) : 0;
          const against = Math.max(-dir * rec.rollMax, -dir * rec.rollMin);
          const ok = bank ? over <= limits[0] && against <= limits[1] : Math.max(Math.abs(rec.rollMax), Math.abs(rec.rollMin)) <= limits[0];
          out(st, rec, pass(rec, ok), [[tr('Скорость сваливания', 'Stall speed'), `${kt(rec.x.vStall ?? NaN)} ${tr('узл.', 'kt')}`],
            [tr('Крен после срыва', 'Bank after the stall'), `${n(rec.rollMin)}…${n(rec.rollMax)}°`], [tr('Потеря высоты от срыва', 'Height loss from the break'), `${n((rec.x.hBrk ?? rec.h0) - (rec.x.hMin ?? rec.h0))} ${tr('м', 'm')}`]]);
        } });
    stall('stall', tr('Сваливание с прямой', 'Wings-level stall'), tr('торможение 1 узел/с, газ убран; крен после срыва не больше 15° (§23.201)', '1 kt/s deceleration, power idle; bank after the stall within 15° (§23.201)'), 0, 1, [15, 15]);
    if (rollC) {
      stall('turnStall', tr('Сваливание в развороте 30°', 'Turning stall, 30° bank'), tr('1 узел/с; крен не больше 60° в сторону разворота и 30° против (§23.203)', '1 kt/s; bank within 60° into the turn and 30° against (§23.203)'), 30, 1, [60, 30]);
      stall('accStall', tr('Ускоренное сваливание в развороте', 'Accelerated turning stall'), tr('30°, торможение 4 узла/с с ростом перегрузки; крен не больше 90° и 60° (§23.203)', '30°, 4 kt/s with rising load factor; bank within 90° and 60° (§23.203)'), 30, 4, [90, 60]);
    }
    // 13. Штопор на один виток (§23.221): на срыве руль высоты полностью на себя и педаль до упора, элероны нейтрально;
    // виток (или 3 с), затем вывод: педаль против, ручка от себя. Вывод — не больше чем за ещё один виток.
    if (yawC)
      seq.push({ trim: 1.5 * VS, step: { id: 'spin', name: tr('Штопор, один виток', 'One-turn spin'), target: tr('вывод не больше чем за ещё один виток; скорость и перегрузка в пределах (§23.221)', 'recovery within one additional turn; speed and load factor within limits (§23.221)'),
        run: (t, rec) => {
          setThrottle(0);
          const s = sim.sample;
          if (rec.x.entry === undefined) {
            lateral(0);
            if (t < 1.5 * sim.dt) vzI = s.vz;
            speedOnPitch(1.5 * VS - KT * t, -15);
            if (mainStalled() > 0.3 || t > 60) { rec.x.entry = t; rec.x.psi = s.headingDeg; rec.x.turn = 0; }
            return false;
          }
          // Курс накапливается по угловой скорости рыскания.
          rec.x.turn += (rates().r * sim.dt) / 360;
          if (rec.x.rec === undefined) {
            setPitch(pitchC.max);
            sim.channels[yawC.channel] = yawC.max;
            if (rollC) sim.channels[rollC.channel] = 0;
            if (Math.abs(rec.x.turn) >= 1 && t - rec.x.entry >= 3) { rec.x.rec = t; rec.x.turnAtRec = rec.x.turn; }
            else if (t - rec.x.entry > 15) { rec.x.rec = t; rec.x.turnAtRec = rec.x.turn; rec.x.noSpin = 1; }
            return false;
          }
          if (rec.x.stopped === undefined) {
            sim.channels[yawC.channel] = yawC.min;
            setPitch(-10);
            if (rollC) sim.channels[rollC.channel] = 0;
            if (Math.abs(rates().r) < 10) { rec.x.stopped = t; rec.x.extra = Math.abs(rec.x.turn - rec.x.turnAtRec); }
            return t - rec.x.rec > 30;
          }
          sim.channels[yawC.channel] = 0;
          lateral(0);
          if (Math.abs(sim.sample.rollDeg) > 30) nHold(1);
          else if (eas() > 1.3 * VS) nHold(nSafe(Math.min(nLim * 0.8, 3)));
          else setPitch(-5);
          return sim.sample.vz > 0 || t - rec.x.stopped > 15;
        } },
        after: (rec, st) => {
          const extra = rec.x.extra ?? Infinity;
          const spun = !rec.x.noSpin;
          out(st, rec, spun ? pass(rec, extra <= 1 && rec.vMax * k <= 0.9 * VD && rec.nMax <= nLim) : null,
            [[tr('Витков до вывода', 'Turns before recovery'), n(Math.abs(rec.x.turnAtRec ?? 0))], [tr('Витков на выводе', 'Turns during recovery'), Number.isFinite(extra) ? n(extra) : tr('не вышел', 'did not recover')],
              [tr('Наибольшая скорость', 'Max speed'), `${kt(rec.vMax * k)} ${tr('узл.', 'kt')}`], [tr('Перегрузка на выводе', 'Pull-out load factor'), n(rec.nMax)], [tr('Потеря высоты', 'Height loss'), `${n(rec.h0 - (rec.x.hMin ?? rec.h0))} ${tr('м', 'm')}`]],
            spun ? undefined : tr('в штопор не вошёл: за 15 с не сделал витка — модель крыла после срыва по полосам, сваливание на одно крыло может не воспроизводиться', 'did not enter a spin: no full turn in 15 s — the post-stall strip model may not reproduce a wing drop'));
        } });

    if (this.opts.stressOnly?.length) {
      const keep = new Set(this.opts.stressOnly);
      for (let j = seq.length - 1; j >= 0; j--) if (!keep.has(seq[j].step.id)) seq.splice(j, 1);
    }
    // ---- исполнитель ----
    const h0 = rb.translation().y;
    sim.lockRoot('planar');
    let i = -1, sub: 'takeoff' | 'trim' | 'step' | 'recover' = 'takeoff', t0 = 0;
    let rec = newRec();
    const vr = 1.2 * VS / k;
    this.ctl = () => {
      const s = sim.sample;
      const t = sim.t - t0;
      const h = rb.translation().y;
      // В браузере выход на режим и возврат в горизонт между манёврами досчитываются ускоренно; взлёт, сами манёвры и
      // первые секунды вывода (замер кончается на пике, а самолёт ещё в манёвре) — в реальном времени.
      this.fastForward = sub === 'trim' || (sub === 'recover' && t > STRESS_SHOW_RECOVERY);
      this.vibPaused = sub === 'step' || sub === 'recover';
      if (sub !== 'takeoff') {
        // Запись по шагу.
        rec.nMax = Math.max(rec.nMax, s.loadFactor);
        rec.nMin = Math.min(rec.nMin, s.loadFactor);
        rec.vMax = Math.max(rec.vMax, s.airspeed);
        rec.rollMax = Math.max(rec.rollMax, s.rollDeg);
        rec.rollMin = Math.min(rec.rollMin, s.rollDeg);
        rec.betaMax = Math.max(rec.betaMax, Math.abs(s.betaDeg));
        rec.x.hMin = Math.min(rec.x.hMin ?? h, h);
        rec.x.rpm = Math.max(rec.x.rpm ?? 0, s.propRpm);
        if (s.minMargin < rec.margin) { rec.margin = s.minMargin; rec.part = s.minMarginPart; }
      }
      if (sub === 'takeoff') {
        this.phase = tr('взлёт', 'take-off');
        setThrottle(1);
        pitchHold(s.airspeed >= vr ? 10 : 0);
        if (h > h0 + 20) {
          // Набор высоты пропускается: самолёт переносится на исходную высоту манёвров (плотность воздуха в стенде —
          // по высоте испытания, от положения над землёй не зависит).
          sim.shift(v3(0, H0 - h, 0));
          sim.lockRoot('free');
          lifts++;
          i = 0; sub = 'trim'; t0 = sim.t; thetaI = s.pitchDeg;
        } else if (sim.t > 90) {
          this.r.notes.push(tr('за 90 с не взлетел', 'did not take off in 90 s'));
          this.finish();
        }
        return;
      }
      const cur = seq[i];
      this.stressNow = { n: i + 1, of: seq.length, name: cur.step.name, target: cur.step.target, stage: sub as 'trim' | 'step' | 'recover' };
      if (sub === 'trim') {
        this.phase = tr(`подготовка: ${cur.step.name}`, `setting up: ${cur.step.name}`);
        if (trimAt(cur.trim ?? VA)(t)) {
          ensureAltitude(cur.minH);
          stepH = rb.translation().y;
          sub = 'step'; t0 = sim.t; rec = newRec();
        }
        return;
      }
      if (sub === 'step') {
        this.phase = cur.step.name;
        if (cur.step.run(t, rec)) {
          cur.after?.(rec, cur.step);
          sub = 'recover'; t0 = sim.t;
          pitchI = sim.channels[pitchC.channel];
          thetaI = s.pitchDeg;
        }
        return;
      }
      this.phase = tr('выход в горизонт', 'recovering to level flight');
      if (recover(t)) {
        i++;
        if (i >= seq.length) {
          this.r.notes.push(tr('вибрация в кресле измерена только в установившемся полёте между манёврами: порывы, резкие рули и выводы — разовые толчки, их оценивают перегрузка по осям и модель удара', 'seat vibration is measured only in steady flight between manoeuvres: gusts, abrupt controls and recoveries are one-off jolts, assessed by the g-load by axis and the impact model'));
          if (lifts > 1) this.r.notes.push(tr(`между манёврами самолёт ${lifts - 1} раз переносился на исходную высоту ${H0} м — набор высоты не считался`, `between manoeuvres the aeroplane was moved back to ${H0} m ${lifts - 1} times — the climbs were not simulated`));
          this.finish();
          return;
        }
        ensureAltitude();
        stepH = rb.translation().y;
        sub = 'trim'; t0 = sim.t;
      }
    };
  }

  // ---------- стресс-тесты вертолёта (нормы FAR 27, ограничения R22) ----------
  // Вертолёт взлетает, висит, разгоняется и проходит серию: перегрузки ручкой циклического шага, малая перегрузка
  // (демонстрация запрещённого у R22 режима), вертикальные порывы, полная педаль, отказ двигателя с переходом на
  // авторотацию, полёт на 1,1·VNE. Источники и критерии — data/stress-tests.md (раздел B, D.2).
  private setupHeliStress() {
    const sim = this.sim;
    const colC = this.control('lift'), lonC = this.control('pitch'), latC = this.control('roll'), pedC = this.control('yaw');
    const rotorA = this.spec.actuators.find((a) => a.type === 'spinner' && a.cyclic && a.flapping && a.tailRotor?.channel);
    if (!colC || !lonC || !latC || !pedC || !rotorA || rotorA.type !== 'spinner') {
      this.notApplicable(tr('нужен вертолёт: несущий винт на шарнирах с циклическим шагом, хвостовой винт с педалями, органы «общий шаг», «тангаж», «крен», «курс»',
        'a helicopter is required: an articulated main rotor with cyclic pitch, a tail rotor with pedals, and lift, pitch, roll and yaw controls'));
      return;
    }
    (this as { timeLimit: number }).timeLimit = 1500;
    sim.tailRotorFree = true;
    // Прочность лопастей в полёте вперёд — справочно (README, раздел о R22 в полёте вперёд): лонжерон — эквивалентная
    // коробка (в плоскости вращения слабее настоящего), подвеска втулки, гасящая кориолисовы силы, не опубликована.
    // Запас у корня падает ниже 1 уже в горизонтальном полёте на 90 узлах — поэтому лопасти здесь не ломаются.
    sim.opts.breakable = false;
    this.r.strengthInfoOnly = tr('прочность лопастей в полёте вперёд — справочно: лонжерон — эквивалентная коробка (в плоскости вращения слабее настоящего), подвеска втулки не опубликована; запас у корня ниже 1 уже в горизонтальном полёте на 90 узлах',
      'blade strength in forward flight is for reference only: the spar is an equivalent box (weaker in the plane of rotation than the real one) and the hub suspension is not published; the root margin is below 1 already in level flight at 90 kt');
    const rb = sim.root.b.rb;
    const rr = sim.rotors.find((x) => x.actuator === rotorA)!;
    const steps: StressStep[] = (this.r.stress = []);
    const k = Math.sqrt(sim.rho / 1.225);
    const KT = 0.514444;
    const pilot = new HeliPilot(sim, { col: colC, lon: lonC, lat: latC, ped: pedC }, rotorA.direction);
    const eas = () => pilot.airBody().x * k;
    const omNom = (rotorA.rpm * 2 * Math.PI) / 60;
    const rpmFrac = () => Math.abs(rr.omega) / omNom;
    const nLim = this.spec.limits?.loadFactor ?? 3.5; // §27.337: +3,5 / −1,0, если не обосновано иное
    const VNE = this.spec.limits?.vne ?? 50;
    const rpmOff = this.spec.limits?.rotorRpmOff ?? [0.9, 1.1];
    const D = 2 * rr.radius;
    const H0 = 600, hMin = 250;
    let lifts = 0;
    const kt = (v: number) => n(v / KT);
    const ch = sim.channels;
    const flapDeg = () => Math.max(...rr.blades.map((b) => Math.abs(b.flap?.beta ?? 0))) * (180 / Math.PI);
    const ensureAltitude = () => {
      const h = rb.translation().y;
      if (h < hMin) { sim.shift(v3(0, H0 - h, 0)); lifts++; }
    };
    let nLp = 1, nLpT = -1;
    const nLpUpd = () => {
      if (nLpT !== sim.t) { nLp += (1 - Math.exp(-2 * Math.PI * 8 * sim.dt)) * (sim.sample.loadFactor - nLp); nLpT = sim.t; }
      return nLp;
    };
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

    type Rec = { nMax: number; nMin: number; margin: number; part: string; rollMax: number; rollMin: number; betaMax: number; flapMax: number; rpmMin: number; rpmMax: number; x: Record<string, number> };
    const newRec = (): Rec => ({ nMax: -Infinity, nMin: Infinity, margin: Infinity, part: '', rollMax: -Infinity, rollMin: Infinity, betaMax: 0, flapMax: 0, rpmMin: Infinity, rpmMax: 0, x: {} });
    type Step = { id: string; name: string; target: string; run: (t: number, rec: Rec) => boolean };
    const marginText = (rec: Rec) => (Number.isFinite(rec.margin) ? tr(`запас лопастей ${n(rec.margin)} (${rec.part}; справочно)`, `blade margin ${n(rec.margin)} (${rec.part}; reference only)`) : tr('прочность не проверялась', 'strength not checked'));
    const out = (st: Step, rec: Rec, ok: boolean | null, values: [string, string][], note?: string) =>
      steps.push({ id: st.id, name: st.name, target: st.target, pass: ok, values: [...values, [tr('Взмах лопастей, наибольший', 'Peak blade flapping'), `${n(rec.flapMax)}°`], [tr('Прочность', 'Strength'), marginText(rec)]], note });
    // Критерии — лётные (мощность, обороты, запас хода органов управления); прочность лопастей — справочно.
    const pass = (_rec: Rec, extra = true) => extra;
    let stepH = H0;
    // Ручки в момент начала манёвра — от них считаются отклонения.
    const snap = () => ({ col: ch[colC.channel], lon: ch[lonC.channel], lat: ch[latC.channel], ped: ch[pedC.channel] });

    // Выход на режим: горизонтальный полёт на заданной приборной скорости; если мощности не хватает — со снижением.
    let okT = 0, dive = false;
    const trimAt = (v: number) => (t: number) => {
      if (t < 1.5 * sim.dt) { okT = 0; dive = false; }
      const s = sim.sample;
      if (!dive && v > 10 && t > 15 && s.power > 0.98 * sim.powerAvailable && eas() < v - 2) dive = true;
      pilot.step(dive ? { vz: -4, u: v / k } : { h: stepH, u: v / k });
      const w = pilot.rates();
      const steady = Math.abs(eas() - v) < 1.5 && (dive || Math.abs(s.vz) < 0.7) && Math.abs(w.p) + Math.abs(w.q) < 3;
      okT = steady ? okT + sim.dt : 0;
      return okT > 3 || t > 60;
    };
    const recover = (t: number, rec: Rec) => {
      const fw = rotorA.freewheel && ch[rotorA.freewheel] > 0.5;
      if (fw) {
        // После авторотации: обороты держит общий шаг, мотор подключается, когда они в пределах 1 % номинала.
        const e = rpmFrac() - 1;
        rec.x.cR = clamp((rec.x.cR ?? ch[colC.channel]) + 8 * e * sim.dt, colC.min, colC.max);
        pilot.step({ collective: clamp(rec.x.cR + 40 * e, colC.min, colC.max), u: (65 * KT) / k });
        if (Math.abs(e) < 0.01 || t > 30) ch[rotorA.freewheel!] = 0;
        return false;
      }
      pilot.step({ h: stepH, u: (0.6 * VNE) / k });
      return t > 8;
    };

    // Перегрузка ручкой: продольный циклический шаг держит перегрузку (ПИ по сглаженной перегрузке), общий шаг зажат.
    const pullTo = (nT: number, ramp: number) => (t: number, rec: Rec, c0: ReturnType<typeof snap>) => {
      const nn = nLpUpd();
      const target = 1 + (nT - 1) * smooth(t / ramp);
      const e = target - nn;
      rec.x.lonI = clamp((rec.x.lonI ?? 0) + 6 * e * sim.dt, lonC.min - c0.lon, lonC.max - c0.lon);
      const lon = clamp(c0.lon + rec.x.lonI + 1.5 * e - 0.3 * pilot.rates().q, lonC.min, lonC.max);
      return lon;
    };
    const seq: { trim: number; step: Step; after: (rec: Rec, st: Step) => void }[] = [];

    // 0. Висение вне влияния земли: мощность и запас педалей (§27.143: управляемость; хвостового винта должно хватать).
    seq.push({ trim: 0, step: { id: 'hHover', name: tr('Висение вне влияния земли', 'Hover out of ground effect'), target: tr('мощности хватает; запас хода педалей не меньше 10 %', 'enough power; at least 10 % of pedal travel left'),
      run: (t, rec) => {
        pilot.step({ h: stepH, u: 0 });
        if (t > 5) { rec.x.p = (rec.x.p ?? 0) + sim.sample.power; rec.x.ped = (rec.x.ped ?? 0) + ch[pedC.channel]; rec.x.n2 = (rec.x.n2 ?? 0) + 1; }
        return t > 15;
      } },
      after: (rec, st) => {
        const P = rec.x.p / rec.x.n2, ped = rec.x.ped / rec.x.n2;
        const margin = Math.min(pedC.max - ped, ped - pedC.min) / (pedC.max - pedC.min);
        this.r.hover = { achieved: P <= sim.powerAvailable, channel: ch[colC.channel], saturated: false, power: P, liftToWeightAtMax: NaN };
        out(st, rec, pass(rec, P <= sim.powerAvailable && margin >= 0.1), [[tr('Мощность', 'Power'), `${n(P / 1000)} ${tr('кВт из', 'kW of')} ${n(sim.powerAvailable / 1000)}`],
          [tr('Педали', 'Pedals'), tr(`${n(ped)}° (запас хода ${n(margin * 100)} %)`, `${n(ped)}° (${n(margin * 100)} % travel left)`)]]);
      } });

    // 1–2. Перегрузка ручкой циклического шага (§27.337, полётная проверка нагрузок §27.571: «cyclic pull-ups»).
    for (const [id, frac] of [['hPull60', 0.6], ['hPull90', 0.9]] as const) {
      let c0 = snap();
      seq.push({ trim: frac * VNE, step: { id, name: tr(`Перегрузка ручкой на ${n(frac * 100)} % VNE`, `Cyclic pull-up at ${n(frac * 100)} % VNE`),
        target: tr(`${kt(frac * VNE)} узл.; продольный циклический шаг на себя до +${n(nLim)} g (§27.337), общий шаг зажат`, `${kt(frac * VNE)} kt; aft cyclic to +${n(nLim)} g (§27.337), collective fixed`),
        run: (t, rec) => {
          if (t < 1.5 * sim.dt) { c0 = snap(); rec.x.u0 = eas(); }
          const lon = pullTo(nLim, 1)(t, rec, c0);
          pilot.step({ collective: c0.col, lonFixed: lon, theta: sim.sample.pitchDeg });
          if (Math.abs(nLp - nLim) < 0.05 * nLim) rec.x.reached ??= t;
          // До 1 с на перегрузке, или пока не упадёт скорость (тяги на большее нет) / не задерётся нос.
          return (rec.x.reached !== undefined && t - rec.x.reached > 1) || eas() < 0.6 * rec.x.u0 || sim.sample.pitchDeg > 35 || t > 5;
        } },
        after: (rec, st) => out(st, rec, null, [[tr('Перегрузка', 'Load factor'), n(rec.nMax)], [tr('Обороты винта', 'Rotor rpm'), `${n(rec.rpmMin * 100)}…${n(rec.rpmMax * 100)} %`]],
          rec.nMax < 0.95 * nLim ? tr(`предельная перегрузка не набрана: винт выходит на срыв лопастей раньше (наибольшая ${n(rec.nMax)} g); у R22 предельная перегрузка не опубликована`, `the limit load factor was not reached: the rotor stalls first (peak ${n(rec.nMax)} g); the R22 design limit is not published`) : undefined) });
    }

    // 3. Малая перегрузка (демонстрация): у R22 запрещена (POH, SN-11) — ручка от себя до 0,2 g, поперечный шаг и педали зажаты.
    {
      let c0 = snap();
      seq.push({ trim: 0.6 * VNE, step: { id: 'hLowG', name: tr('Малая перегрузка (демонстрация опасного режима)', 'Low-G pushover (hazard demonstration)'),
        target: tr('ручка от себя до 0,2 g на 1,5 с, поперечный шаг и педали зажаты: куда кренится вертолёт с качающейся втулкой (у R22 режим запрещён, POH)', 'forward cyclic to 0.2 g for 1.5 s, lateral cyclic and pedals fixed: where a teetering-rotor helicopter rolls (prohibited on the R22, POH)'),
        run: (t, rec) => {
          if (t < 1.5 * sim.dt) { c0 = snap(); rec.x.phi0 = sim.sample.rollDeg; rec.x.pMax = 0; }
          const lon = pullTo(0.2, 0.7)(t, rec, c0);
          pilot.step({ collective: c0.col, lonFixed: lon, latFixed: c0.lat, pedFixed: c0.ped, theta: sim.sample.pitchDeg });
          rec.x.pMax = Math.max(rec.x.pMax, Math.abs(pilot.rates().p));
          rec.x.dphi = sim.sample.rollDeg - rec.x.phi0;
          return t > 2.2 || Math.abs(rec.x.dphi) > 60;
        } },
        after: (rec, st) => out(st, rec, null, [[tr('Перегрузка', 'Load factor'), n(rec.nMin)], [tr('Крен за манёвр', 'Roll during the manoeuvre'), `${n(rec.x.dphi ?? 0)}° (${(rec.x.dphi ?? 0) >= 0 ? tr('вправо', 'right') : tr('влево', 'left')})`],
          [tr('Наибольшая угловая скорость крена', 'Peak roll rate'), `${n(rec.x.pMax ?? 0)} °/${tr('с', 's')}`]],
          tr('демонстрация: тяга несущего винта почти ноль, а хвостовой винт выше центра масс продолжает тянуть — вертолёт кренится вправо, поперечный шаг на малой тяге не помогает; выход — плавно ручку на себя, а не вбок (POH R22, SN-11)',
            'demonstration: main-rotor thrust is near zero while the tail rotor above the centre of mass keeps pulling — the helicopter rolls right and lateral cyclic is ineffective at low thrust; recovery is gentle aft cyclic, not sideways (R22 POH, SN-11)')) });
    }

    // 4–6. Вертикальный порыв 30 ft/s (§27.341) на висении, на 0,6·VNE и на VNE; органы зажаты.
    for (const [id, frac] of [['hGust0', 0], ['hGust60', 0.6], ['hGustVne', 1]] as const) {
      let c0 = snap();
      const Ude = 30 * 0.3048;
      seq.push({ trim: frac * VNE, step: { id, name: frac ? tr(`Вертикальный порыв на ${n(frac * 100)} % VNE`, `Vertical gust at ${n(frac * 100)} % VNE`) : tr('Вертикальный порыв на висении', 'Vertical gust in hover'),
        target: tr(`9,1 м/с (30 ft/s, §27.341), форма 1 − cos ${frac ? `длиной ${n(2 * D)} м (два диаметра винта)` : 'за 2 с'}; органы зажаты`, `9.1 m/s (30 ft/s, §27.341), 1 − cos shape ${frac ? `over ${n(2 * D)} m (two rotor diameters)` : 'over 2 s'}; controls fixed`),
        run: (t, rec) => {
          if (t < 1.5 * sim.dt) {
            c0 = snap();
            if (frac) {
              const v = copy(rb.linvel());
              const d = len(v) > 1 ? scale(v, 1 / len(v)) : v3(1, 0, 0);
              const P0 = add(copy(rb.translation()), scale(d, rr.radius + 2));
              const L = 2 * D;
              sim.gustAt = (pt) => {
                const s = dot(vsub(pt, P0), d);
                return s > 0 && s < L ? v3(0, (Ude / 2) * (1 - Math.cos((2 * Math.PI * s) / L)), 0) : v3();
              };
              rec.x.T = (2 * D + 2 * rr.radius + 8) / Math.max(5, len(v));
            } else rec.x.T = 2;
          }
          if (!frac) sim.opts.wind.y = t < 2 ? (Ude / 2) * (1 - Math.cos(Math.PI * t)) : 0;
          pilot.step({ collective: c0.col, lonFixed: c0.lon, latFixed: c0.lat, pedFixed: c0.ped, theta: sim.sample.pitchDeg });
          return t > rec.x.T + 0.3; // нагрузка от самого порыва (§27.341); дальше вертолёт ведёт лётчик
        } },
        after: (rec, st) => { sim.gustAt = null; sim.opts.wind.y = 0; out(st, rec, null, [[tr('Перегрузка', 'Load factor'), `${n(rec.nMax)} / ${n(rec.nMin)}`], [tr('Обороты винта', 'Rotor rpm'), `${n(rec.rpmMin * 100)}…${n(rec.rpmMax * 100)} %`]]); } });
    }

    // 7–8. Полная педаль за 0,2 с (§27.351): на висении и на 0,6·VNE, затем педали в балансировку.
    for (const [id, frac] of [['hPedal0', 0], ['hPedal60', 0.6]] as const) {
      let c0 = snap();
      seq.push({ trim: frac * VNE, step: { id, name: frac ? tr(`Полная педаль на ${n(frac * 100)} % VNE`, `Full pedal at ${n(frac * 100)} % VNE`) : tr('Полная педаль на висении', 'Full pedal in hover'),
        target: tr('педаль до упора за 0,2 с до наибольшего скольжения (не больше 90°), затем в балансировку (§27.351)', 'pedal to the stop in 0.2 s until the peak sideslip (up to 90°), then back to trim (§27.351)'),
        run: (t, rec) => {
          if (t < 1.5 * sim.dt) { c0 = snap(); rec.x.psi0 = sim.sample.headingDeg; rec.x.rMax = 0; rec.x.tMax = 0; rec.x.dpsi = 0; }
          const dpsi = Math.abs(((sim.sample.headingDeg - rec.x.psi0 + 540) % 360) - 180);
          rec.x.dpsi = Math.max(rec.x.dpsi, dpsi);
          const turning = rec.x.off === undefined;
          if (turning && (t > 3 || dpsi > 90 || (frac && t > 0.5 && Math.abs(sim.sample.betaDeg) < (rec.x.bPrev ?? 0)))) rec.x.off = t;
          rec.x.bPrev = Math.abs(sim.sample.betaDeg);
          const ped = turning ? c0.ped + (pedC.max - c0.ped) * Math.min(1, t / 0.2) : c0.ped;
          pilot.step({ collective: c0.col, lonFixed: c0.lon, latFixed: c0.lat, pedFixed: ped, theta: sim.sample.pitchDeg });
          rec.x.rMax = Math.max(rec.x.rMax, Math.abs(pilot.rates().r));
          rec.x.tMax = Math.max(rec.x.tMax, Math.abs(sim.tailCache.get(rotorA.id)?.thrust ?? 0));
          return rec.x.off !== undefined && t - rec.x.off > 1.5;
        } },
        after: (rec, st) => out(st, rec, null, [[frac ? tr('Наибольшее скольжение', 'Peak sideslip') : tr('Разворот', 'Heading change'), `${n(frac ? rec.betaMax : rec.x.dpsi)}°`],
          [tr('Угловая скорость рыскания', 'Yaw rate'), `${n(rec.x.rMax)} °/${tr('с', 's')}`], [tr('Тяга хвостового винта', 'Tail-rotor thrust'), `${n(rec.x.tMax)} ${tr('Н', 'N')}`]],
          tr('нагрузки хвостовой балки не считаются (у балки в модели нет силового набора)', 'tail-boom loads are not computed (the boom has no structure in the model)')) });
    }

    // 9. Полёт на 1,1·VNE (§27.175, AC 27-1: запас ручки на пикирование): запас продольного шага вперёд не меньше 10 %.
    seq.push({ trim: 1.1 * VNE, step: { id: 'hVne', name: tr('Полёт на 1,1·VNE', 'Flight at 1.1·VNE'), target: tr(`${kt(1.1 * VNE)} узл.; запас хода ручки вперёд не меньше 10 % (§27.175, AC 27-1)`, `${kt(1.1 * VNE)} kt; at least 10 % forward cyclic travel left (§27.175, AC 27-1)`),
      run: (t, rec) => {
        // Мощности на горизонтальный полёт не хватает — со снижением, как на выходе на режим (общий шаг сверх мощности
        // «съел» бы обороты).
        pilot.step(dive ? { vz: -4, u: (1.1 * VNE) / k } : { h: stepH, u: (1.1 * VNE) / k });
        rec.x.vz = (rec.x.vz ?? 0) + sim.sample.vz; rec.x.nv = (rec.x.nv ?? 0) + 1;
        const lon = ch[lonC.channel];
        rec.x.lonMin = Math.min(rec.x.lonMin ?? Infinity, lon);
        rec.x.st = Math.max(rec.x.st ?? 0, sim.sample.stalledFrac);
        return t > 6;
      } },
      after: (rec, st) => {
        const m = (rec.x.lonMin - lonC.min) / (lonC.max - lonC.min);
        out(st, rec, pass(rec, m >= 0.1), [[tr('Запас ручки вперёд', 'Forward cyclic left'), `${n(m * 100)} %`], [tr('Сорвано сечений', 'Stalled sections'), `${n(rec.x.st * 100)} %`],
          [tr('Вертикальная скорость', 'Vertical speed'), `${n(rec.x.vz / rec.x.nv)} ${tr('м/с', 'm/s')}${dive ? tr(' (на горизонтальный полёт мощности нет)', ' (not enough power for level flight)') : ''}`], [tr('Обороты винта', 'Rotor rpm'), `${n(rec.rpmMin * 100)}…${n(rec.rpmMax * 100)} %`]],
          m < 0.1 ? tr('ручки на пикирование почти не осталось', 'almost no forward cyclic left') : undefined);
      } });

    // 10. Отказ двигателя (§27.143(e)): на 0,9·VNE органы зажаты 1 с, затем общий шаг вниз — авторотация на 65 узлах.
    // Последний шаг: программа заканчивается на авторотации (мотор шарнира в стенде без ограничения момента, и его
    // повторное включение доводило бы обороты рывком — сотни киловатт за шаг расчёта).
    if (rotorA.freewheel) {
      let c0 = snap();
      const fw = rotorA.freewheel;
      const vAuto = 65 * KT;
      seq.push({ trim: 0.9 * VNE, step: { id: 'hPowerFail', name: tr('Отказ двигателя на 0,9·VNE', 'Engine failure at 0.9·VNE'),
        target: tr(`органы зажаты 1 с (§27.143(e)), затем авторотация на ${n(65)} узлах; установившиеся обороты — от ${n(rpmOff[0] * 100)} до ${n(rpmOff[1] * 100)} % (POH R22)`, `controls fixed for 1 s (§27.143(e)), then autorotation at 65 kt; steady rpm within ${n(rpmOff[0] * 100)}–${n(rpmOff[1] * 100)} % (R22 POH)`),
        run: (t, rec) => {
          if (t < 1.5 * sim.dt) { c0 = snap(); ch[fw] = 1; rec.x.cI = c0.col; rec.x.vz = 0; rec.x.nv = 0; rec.x.uS = 0; }
          if (t < 1) {
            pilot.step({ collective: c0.col, lonFixed: c0.lon, latFixed: c0.lat, pedFixed: c0.ped, theta: sim.sample.pitchDeg });
            rec.x.rpm1 = rpmFrac();
            return false;
          }
          // Общий шаг держит обороты (как лётчик на авторотации): обороты выше — шаг больше.
          const e = rpmFrac() - 1;
          rec.x.cI = clamp(rec.x.cI + 8 * e * sim.dt, colC.min, colC.max);
          pilot.step({ collective: clamp(rec.x.cI + 40 * e, colC.min, colC.max), u: vAuto / k });
          if (t > 12) {
            rec.x.vz += sim.sample.vz; rec.x.uS += eas(); rec.x.nv++;
            rec.x.sMin = Math.min(rec.x.sMin ?? Infinity, rpmFrac());
            rec.x.sMax = Math.max(rec.x.sMax ?? 0, rpmFrac());
          }
          return t > 25;
        } },
        after: (rec, st) => {
          const ok = rec.x.sMin >= rpmOff[0] && rec.x.sMax <= rpmOff[1];
          out(st, rec, pass(rec, ok), [[tr('Обороты на установившейся авторотации', 'Rotor rpm in steady autorotation'), `${n(rec.x.sMin * 100)}…${n(rec.x.sMax * 100)} %`],
            [tr('Обороты: наименьшие и через 1 с', 'Rotor rpm: lowest and after 1 s'), `${n(rec.rpmMin * 100)} %, ${n((rec.x.rpm1 ?? 1) * 100)} % (${tr('переходный минимум для R22 не опубликован', 'the R22 transient minimum is not published')})`],
            [tr('Установившееся снижение', 'Steady descent'), `${n(-(rec.x.vz / Math.max(1, rec.x.nv)))} ${tr('м/с', 'm/s')} (${n(-(rec.x.vz / Math.max(1, rec.x.nv)) * 196.85)} ft/min) ${tr('на', 'at')} ${kt(rec.x.uS / Math.max(1, rec.x.nv))} ${tr('узл.; Robinson SN-38: на 60–70 узлах обычно меньше 1500 ft/min', 'kt; Robinson SN-38: usually below 1500 ft/min at 60–70 kt')}`]],
            !ok ? tr('обороты вышли за пределы авторотации', 'rotor rpm left the autorotation limits') : undefined);
        } });
    }

    if (this.opts.stressOnly?.length) {
      const keep = new Set(this.opts.stressOnly);
      for (let j = seq.length - 1; j >= 0; j--) if (!keep.has(seq[j].step.id)) seq.splice(j, 1);
    }

    // ---- исполнитель ----
    sim.lockRoot('fixed');
    for (const c of [colC, lonC, latC, pedC]) ch[c.channel] = c.initial;
    let i = -1, sub: 'spin' | 'takeoff' | 'trim' | 'step' | 'recover' = 'spin', t0 = 0;
    const done = () => {
      this.r.notes.push(tr('вибрация в кресле измерена только в установившемся полёте между манёврами', 'seat vibration is measured only in steady flight between manoeuvres'));
      if (lifts > 1) this.r.notes.push(tr(`между манёврами вертолёт ${lifts - 1} раз переносился на исходную высоту ${H0} м — набор высоты не считался`, `between manoeuvres the helicopter was moved back to ${H0} m ${lifts - 1} times — the climbs were not simulated`));
      this.finish();
    };
    let rec = newRec();
    const tSpin = (rotorA.rampTime ?? 4) + 1;
    this.ctl = () => {
      const s = sim.sample;
      const t = sim.t - t0;
      const h = rb.translation().y;
      this.fastForward = sub === 'trim' || (sub === 'recover' && t > STRESS_SHOW_RECOVERY);
      this.vibPaused = sub === 'step' || sub === 'recover';
      if (sub === 'step' || sub === 'recover') {
        rec.nMax = Math.max(rec.nMax, s.loadFactor);
        rec.nMin = Math.min(rec.nMin, s.loadFactor);
        rec.rollMax = Math.max(rec.rollMax, s.rollDeg);
        rec.rollMin = Math.min(rec.rollMin, s.rollDeg);
        rec.betaMax = Math.max(rec.betaMax, Math.abs(s.betaDeg));
        rec.flapMax = Math.max(rec.flapMax, flapDeg());
        rec.rpmMin = Math.min(rec.rpmMin, rpmFrac());
        rec.rpmMax = Math.max(rec.rpmMax, rpmFrac());
        if (s.minMargin < rec.margin) { rec.margin = s.minMargin; rec.part = s.minMarginPart; }
      }
      if (sub === 'spin') {
        this.phase = tr('раскрутка винта', 'rotor spin-up');
        if (sim.t >= tSpin) { sim.lockRoot('free'); sub = 'takeoff'; t0 = sim.t; }
        return;
      }
      if (sub === 'takeoff') {
        this.phase = tr('взлёт', 'take-off');
        // Подъём на 10 м, висение, разгон с набором до 40 м.
        pilot.step(t < 10 ? { h: (this.spec.parts.find((p) => p.id === sim.root.spec.id)?.position[1] ?? 1) + 10, u: 0 } : { h: 40, u: Math.min(25, (t - 10) * 1.5) });
        if (t > 10 && eas() > 18 && h > 35) {
          sim.shift(v3(0, H0 - h, 0));
          lifts++;
          i = 0; sub = 'trim'; t0 = sim.t; stepH = rb.translation().y;
        } else if (t > 90) {
          this.r.notes.push(tr('за 90 с не взлетел', 'did not take off in 90 s'));
          this.finish();
        }
        return;
      }
      const cur = seq[i];
      this.stressNow = { n: i + 1, of: seq.length, name: cur.step.name, target: cur.step.target, stage: sub as 'trim' | 'step' | 'recover' };
      if (sub === 'trim') {
        this.phase = tr(`подготовка: ${cur.step.name}`, `setting up: ${cur.step.name}`);
        if (trimAt(cur.trim)(t)) { ensureAltitude(); stepH = rb.translation().y; sub = 'step'; t0 = sim.t; rec = newRec(); nLp = s.loadFactor; }
        return;
      }
      if (sub === 'step') {
        this.phase = cur.step.name;
        if (cur.step.run(t, rec)) {
          cur.after(rec, cur.step);
          if (i === seq.length - 1) done(); // последний шаг — сразу итог (после отказа двигателя мотор не включается)
          else { sub = 'recover'; t0 = sim.t; }
        }
        return;
      }
      this.phase = tr('выход на режим', 'recovering');
      if (recover(t, rec)) {
        i++;
        if (i >= seq.length) { done(); return; }
        ensureAltitude();
        stepH = rb.translation().y;
        sub = 'trim'; t0 = sim.t;
      }
    };
  }

  // ---------- общий цикл ----------

  private finish() {
    this.done = true;
    this.r.finished = true;
    const pp = this.spec.powerplant;
    if (pp.engine) {
      const need = this.r.free?.power ?? this.r.tunnel?.power ?? this.r.hover?.power ?? this.r.flight?.cruisePower ?? this.r.powerMean;
      this.r.endurance = endurance(pp.engine, need, pp.power);
    }
    const main = this.sim.mainCycle();
    this.r.fatigue = this.sim.fatigueLife(main?.hz || 1);
  }

  private collect() {
    const s = this.sim.sample;
    const r = this.r;
    if (s.minMargin < r.minMargin) {
      r.minMargin = s.minMargin;
      r.minMarginPart = s.minMarginPart;
      r.minMarginMode = s.minMarginMode;
      r.minMarginSpan = s.minMarginSpan;
    }
    r.minYieldMargin = Math.min(r.minYieldMargin, s.minYieldMargin);
    // Первые шаги после старта — переходные (скачок из покоя), их не учитываем.
    // Ускорение кресла сглаживается так, как его чувствует человек: частоты выше
    // ~16 Гц почти не ощущаются (ISO 2631, упрощённо — фильтр первого порядка).
    // Коэффициент 1 − e^(−2πf·dt) устойчив при любом шаге (простое f·dt при шаге 1/240 с раскачивалось).
    if (this.sim.steps > 5) {
      const k16 = 1 - Math.exp(-2 * Math.PI * 16 * this.sim.dt);
      // Удар — до 20 Гц: импульсы в десятки миллисекунд проходят, а одиночный шаг
      // жёсткого контакта колеса без амортизатора (артефакт модели) сглаживается.
      const k60 = 1 - Math.exp(-2 * Math.PI * 20 * this.sim.dt);
      this.crewLp = Number.isNaN(this.crewLp) ? s.crewAccel : this.crewLp + k16 * (s.crewAccel - this.crewLp);
      this.impactLp = Number.isNaN(this.impactLp) ? s.crewAccel : this.impactLp + k60 * (s.crewAccel - this.impactLp);
      r.crewPeakG = Math.max(r.crewPeakG, this.impactLp);
      this.crewWin.push(this.crewLp);
      // Вибрация — полоса 2…16 Гц за 2 с по всем трём осям кресла: медленный рост перегрузки в манёвре к ней не относится.
      const av = s.crewAccelVec;
      if (!this.vibPaused) this.vib.push([av.x, av.y, av.z]);
      this.crewLoad.push(av);
      r.crewLoad = this.crewLoad.r;
      if (this.crewWin.full) r.crewSustainedG = Math.max(r.crewSustainedG, this.crewWin.mean);
      if (this.vib.full && !this.vibPaused) r.vibrationRms = Math.max(r.vibrationRms, this.vib.rms);
    }
    r.maxMach = Math.max(r.maxMach, s.maxMach);
    r.airspeedMax = Math.max(r.airspeedMax, s.airspeed);
    r.powerPeak = Math.max(r.powerPeak, s.power);
    this.powerWin.push(s.power);
    r.powerMean = this.powerWin.mean;
    this.recWin.push(s.powerRecovered);
    r.powerRecoveredMean = Math.max(0, this.recWin.mean); // со знаком за целые циклы: остаётся работа над воздухом
    this.liftWin.push(s.liftToWeight);
    if (this.liftWin.full) r.liftToWeightMax = Math.max(r.liftToWeightMax, this.liftWin.mean);
    r.liftToWeightMean = this.liftWin.mean;
    r.simTime = this.sim.t;
    r.phase = this.phase;
  }

  /** Продвинуть программу на seconds секунд модельного времени. */
  advance(seconds: number, onStep?: () => void): void {
    const end = this.sim.t + seconds - this.sim.dt / 2;
    while (!this.done && this.sim.t < end) {
      this.ctl();
      if (this.done) break;
      this.sim.step();
      this.collect();
      onStep?.();
      if (this.sim.t >= this.timeLimit + 2 * this.sim.dt && !this.done) {
        this.r.notes.push(tr('программа остановлена по времени', 'the programme was stopped on time limit'));
        this.finish();
      }
    }
  }

  runToEnd(onStep?: () => void): ProgramResult {
    while (!this.done) this.advance(1, onStep);
    return this.r;
  }

  free() {
    this.sim.free();
  }
}

export const speedOf = (v: { x: number; y: number; z: number }) => len(v);
