// Программы испытаний и автопилот (ТЗ, разделы 3 и 4).
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { tr } from './i18n.ts';
import { endurance } from './engine.ts';
import { n } from './analyze.ts';
import { Sim, type BreakEvent, type SimOptions } from './sim.ts';
import { surfaceArea, type Spec, type Control } from './spec.ts';
import type { FailureMode } from './strength.ts';
import { v3, clamp, len, unrotate, copy } from './vec.ts';
import { CrewLoad, VibrationMeter, type CrewLoadResult } from './crew.ts';

export type ProgramId = 'tethered' | 'hover' | 'flight' | 'tunnel' | 'free' | 'max';

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
  max: { get name() { return tr('Максимальный режим', 'Maximum mode'); }, get what() { return tr('Предельные обороты или манёвр с наибольшей перегрузкой: запас прочности и усталость', 'Maximum speed or the highest-load manoeuvre: safety margin and fatigue'); } },
};

export interface ProgramOptions extends SimOptions {
  cruiseSpeed?: number; // м/с, для программы полёта
  climbSpeed?: number; // м/с: вместо полёта по кругу — установившийся набор высоты на полном газе с этой скоростью (скороподъёмность)
  hoverHeight?: number;
  holdTime?: number;
  windSpeed?: number; // для привязного стенда самолёта
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

export class ProgramRun {
  readonly sim: Sim;
  readonly id: ProgramId;
  readonly spec: Spec;
  readonly opts: ProgramOptions;
  phase = 'старт';
  done = false;
  // Идёт часть испытания, на которую незачем смотреть в замедлении (автопилот трубы перебирает
  // десятки циклов взмаха): стенд считает её ускоренно.
  fastForward = false;
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
      if (cls !== 'fixed-wing')
        this.notApplicable(spec.limits?.cruiseSpeed
          ? tr('программа для самолётов; машущему аппарату для полёта вперёд подходит «Свободный полёт махолёта»', 'this programme is for aeroplanes; for a forward-flying flapping vehicle use “Flapping-wing free flight”')
          : tr('программа для самолётов; для винтов и машущих крыльев — «Взлёт и висение»', 'this programme is for aeroplanes; for rotors and flapping wings use “Take-off and hover”'));
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
      this.vib.push([av.x, av.y, av.z]);
      this.crewLoad.push(av);
      r.crewLoad = this.crewLoad.r;
      if (this.crewWin.full) r.crewSustainedG = Math.max(r.crewSustainedG, this.crewWin.mean);
      if (this.vib.full) r.vibrationRms = Math.max(r.vibrationRms, this.vib.rms);
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
