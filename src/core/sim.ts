// Сборка модели из спецификации и ядро симуляции (ТЗ, разделы 4 и 7).
// Не зависит от браузера: модуль Rapier передаётся снаружи.
//
// Устройство:
// - Детали на жёстком соединении свариваются в одно тело Rapier (составной
//   коллайдер). Жёсткий шарнир Rapier податлив и подправляет положения в обход
//   скоростей — у быстро вращающихся лопастей это давало ложный момент на валу.
// - Детали на поворотном шарнире — отдельные тела, привод работает по скорости.
// - Нагрузки считаются по каждой детали отдельно, по уравнениям Ньютона — Эйлера
//   для поддерева, в положении на середине шага.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Spec, Part, Joint, Actuator, AeroSurface } from './spec.ts';
import { chordAtFrac, surfaceArea, validateSpec } from './spec.ts';
import { MATERIALS, type Material } from './materials.ts';
import { sectionAt, type SectionProps } from './section.ts';
import { bemtStep, tailRotorPower } from './tailrotor.ts';
import { laminateMaterial } from './laminate.ts';
import { flutterAnalysis, type FlutterResult, type Strip, type Supports } from './aeroelastic.ts';
import { airViscosity } from './aero.ts';
import { availablePower, fuelFlow } from './engine.ts';
import { airfoilCoeffs, atmosphere, dynamicStall, flapKPrime, flapTau, flapViscous, rotorGroundFactor, rotorInflow, theodorsen, wagnerStep, wingGroundFactor, type StallState } from './aero.ts';
import { propellerLoads } from './propeller.ts';
import { stationStress, fatigueCycles, type StationStress, type FailureMode } from './strength.ts';
import {
  type V3, type Q, v3, fromArr, add, sub, scale, dot, cross, len, norm, addTo, rotate, unrotate,
  qEulerDeg, qConj, qMul, qAxisAngle, copy, deg, clamp,
} from './vec.ts';

type R = typeof RAPIER_NS;
type RigidBody = RAPIER_NS.RigidBody;
type ImpulseJoint = RAPIER_NS.ImpulseJoint;

// ---------- модель ----------

export interface Element {
  r: V3; // точка четверти хорды, оси детали
  chord: number;
  dr: number;
  mass: number;
  twist: number; // рад
  spanFrac: number;
  innerR: V3; // внутренняя граница элемента — станция расчёта прочности
  section: SectionProps | null;
  vnPrev: number;
  dF: V3; // аэродинамическая сила на шаге, мир (Rapier держит её постоянной весь шаг)
  fLoc: V3; // она же в осях тела в начале шага
  // Она же на середине шага: сила поворачивается вместе с сечением, как и точка pW, на которой она берётся
  // в нагрузках. Лопасть за шаг поворачивается на 5–7°; если брать силу начала шага в точке середины шага,
  // радиальная составляющая (у лопасти с конусностью — L·sin β) давала ложный момент на валу, около 3 % мощности.
  dFm: V3;
  pW: V3; // положение на середине шага (у машущей лопасти — с учётом взмаха)
  pR: V3; // положение точки жёсткого тела на середине шага (без взмаха)
  alpha: number;
  stalled: boolean;
  mach: number;
  // Нестационарная модель (aero.unsteady): запаздывание подъёмной силы и прошлые значения для производных.
  wag: { x: number; y: number };
  aQPrev: number; // угол по скосу в точке ¾ хорды на прошлом шаге
  incPrev: number; // угол установки на прошлом шаге
  wnPrev: number; // нормальная к хорде скорость воздуха на прошлом шаге
  stall: StallState; // запаздывание срыва
  // Несущая линия (у несущих крыльев): индуктивный угол этого сечения и циркуляция на прошлом шаге.
  ai: number;
  gam: number;
}

export interface StationState extends StationStress {
  spanFrac: number;
  dyn?: { x: number[]; v: number[] }; // состояние колебательного звена первой формы
  lp?: number[]; // сглаженные нагрузки: растяжение, изгиб взмаха, изгиб в плоскости, кручение, срез ×2
  // Размах напряжений за цикл в каждом углу сечения (усталость считается по худшему углу).
  cycleMax: number[];
  cycleMin: number[];
  lastCycle: { max: number[]; min: number[] } | null;
}

export interface BodyModel {
  rb: RigidBody;
  parts: PartModel[];
  prevV: V3 | null;
  prevW: V3 | null;
  prevT: V3 | null;
  prevQ: Q | null;
  mid: { t: V3; q: Q; w: V3; c: V3 }; // середина шага; c — центр масс
  acc: V3; // ускорение центра масс
  angAcc: V3;
}

export interface PartModel {
  // Лопасть на шарнире взмаха у оси винта: угол взмаха β (от построенной формы), скорость, момент инерции относительно
  // оси шарнира, ось в осях втулки; на шаге — ось в мире, центр втулки, момент воздуха и тяжести; pre — построенная
  // конусность (рад).
  flap?: { beta: number; rate: number; acc: number; Ib: number; axisHub: V3; aW: V3; H: V3; M: number; pre: number };
  // Несущее крыло: история циркуляции присоединённого вихря (для скоса потока за ним с запаздыванием).
  wake?: { t: number; g: number }[];
  spec: Part;
  b: BodyModel;
  offT: V3; // корень детали в осях тела
  offQ: Q; // оси детали в осях тела
  collider: RAPIER_NS.Collider;
  colliderLocal: V3; // центр формы в осях детали
  mass: number;
  com: V3; // центр масс детали, оси детали
  inertia: V3; // главные моменты, оси детали, относительно её центра масс
  elements: Element[];
  material: Material | null;
  parent: PartModel | null;
  joint: JointModel | null;
  children: PartModel[];
  broken: boolean;
  aeroForce: V3;
  inducedAlpha: number;
  groundFactor: number; // доля индуктивного скоса крыла, оставшаяся у земли
  stations: StationState[];
  worst: { margin: number; mode: FailureMode; spanFrac: number; yieldMargin: number };
  rotor: RotorModel | null;
  elastic: ElasticInfo | null; // первая форма изгиба
  axes: BeamAxes; // оси балки в осях детали (с учётом стреловидности, поперечного V и конусности)
}

/**
 * Оси балки несущей поверхности в осях детали. s — вдоль оси балки от корня к законцовке, z — та же ось,
 * направленная в сторону +z детали (s·side), c — хорда, перпендикулярная оси, n = z × c — нормаль.
 * Без стреловидности и поперечного V это оси самой детали: c = x, n = y, z = z.
 * Раньше нагрузки и обтекание раскладывались по осям детали и у лопасти с конусностью или крыла с поперечным V:
 * центробежная сила лопасти не разгружала срез от тяги, а вес наклонного крыла не давал продольной силы.
 */
export interface BeamAxes {
  s: V3;
  z: V3;
  c: V3;
  n: V3;
  stretch: number; // длина оси балки на единицу проекции размаха: 1 / (cos) — у наклонной балки элементы длиннее
}
export function beamAxes(a: AeroSurface | undefined): BeamAxes {
  if (!a) return { s: v3(0, 0, 1), z: v3(0, 0, 1), c: v3(1, 0, 0), n: v3(0, 1, 0), stretch: 1 };
  const raw = v3(-Math.tan((a.sweepDeg ?? 0) * deg), Math.tan((a.dihedralDeg ?? 0) * deg), a.side);
  const s = norm(raw);
  const z = scale(s, a.side);
  const c = norm(sub(v3(1, 0, 0), scale(z, z.x)));
  return { s, z, c, n: cross(z, c), stretch: len(raw) };
}

export interface ElasticInfo {
  f1: number; // собственная частота первой формы изгиба, Гц (с центробежным упрочнением у лопастей)
  fe: number; // частота возбуждения, Гц (взмах или 1 раз за оборот)
  ratio: number; // fe / f1
  daf: number; // коэффициент динамического усиления колебательной части нагрузок (не меньше 1)
  zeta: number; // демпфирование первой формы: конструкция (0,03) и воздух
  zetaAir: number; // из него — воздух
  // Изгиб в плоскости крыла (вращения) — своя форма: жёсткость EI_lag, без присоединённой массы,
  // у лопасти центробежное упрочнение слабее (коэффициент Саутвелла на единицу меньше), демпфирование 0,03.
  fLag: number;
  // У неподвижного крыла демпфирование воздухом пропорционально скорости потока; в свободном полёте она меняется —
  // в шаге нагрузок ζ пересчитывается по текущей воздушной скорости: ζ = 0,03 + cAU·U·F(k)/(2·m·ω₁).
  cAU?: number; // демпфирование формы на единицу скорости, Н·с/м на м/с
  mModal?: number; // модальная масса с присоединённой, кг
  chord?: number; // средняя хорда, м
}

/** Первая форма изгиба консоли: φ(ξ) = ch βξ − cos βξ − σ·(sh βξ − sin βξ), β = 1,8751, σ = 0,7341; φ(1) = 2. */
export function cantileverMode(xi: number): number {
  const b = 1.875104 * xi;
  return Math.cosh(b) - Math.cos(b) - 0.734096 * (Math.sinh(b) - Math.sin(b));
}
export const STRUCTURAL_DAMPING = 0.03;

export interface JointModel {
  spec: Joint;
  parent: PartModel;
  child: PartModel;
  welded: boolean;
  rapier: ImpulseJoint | null;
  axisParentBody: V3; // ось шарнира в осях тела родителя
  force: V3; // что родитель передаёт поддереву ребёнка, мир
  moment: V3; // относительно корня ребёнка
  shaftPower: number;
  target: number;
  anchor: V3; // точка шарнира в осях тела родителя
  motorless?: boolean; // шарнир пересоздан без мотора (обгонная муфта)
}

export interface RotorModel {
  actuator: Extract<Actuator, { type: 'spinner' }>;
  hub: PartModel;
  blades: PartModel[];
  radius: number;
  axisW: V3;
  inflow: number;
  thrust: number;
  tipLoss: number;
  groundFactor: number; // во сколько раз индуктивная скорость у земли меньше, чем вдали от неё
  // Кольца диска — по сечениям лопасти (у всех лопастей винта сечения одинаковые): радиус, ширина, индуктивная скорость,
  // тяга кольца за прошлый шаг (сумма по лопастям), множитель концевых потерь Прандтля.
  st: { r: number; dr: number; vi: number; dT: number; F: number }[];
  // Качающаяся втулка: угол качания β вокруг оси шарнира (она вращается с втулкой), его скорость, момент инерции
  // лопастей относительно оси шарнира, ось в осях втулки; на шаге — ось в мире, центр втулки, аэродинамический момент.
  flapping: boolean; // лопасти на шарнирах взмаха (у каждой — PartModel.flap)
  omega: number; // угловая скорость винта, рад/с (со знаком направления вращения)
}

export interface Sample {
  t: number;
  altitude: number;
  airspeed: number;
  vz: number;
  pitchDeg: number;
  rollDeg: number; // крен, + правое крыло вниз
  headingDeg: number; // курс, + вправо от оси x
  betaDeg: number; // скольжение, + воздух набегает справа
  liftToWeight: number; // вертикальная аэродинамическая сила / вес
  loadFactor: number; // по нормали к корпусу / вес — перегрузка
  aeroForce: V3;
  // Мощность на валах. Привод отдаёт энергию, когда разгоняет деталь или давит на воздух
  // (мощность > 0), и получает её обратно, когда деталь тормозится (мощность < 0).
  shaftPower: number; // Σ положительных частей по приводам: торможение бесплатно, но энергия не возвращается
  shaftPowerNet: number; // Σ со знаком: энергия торможения возвращается полностью (пружина, маховик)
  tailRotorPower: number; // мощность хвостовых винтов на валу, Вт (входит в shaftPower)
  fuelFlow: number; // расход топлива, кг/с (если у силовой установки задан двигатель)
  propPower: number;
  propRpm: number; // обороты винта фиксированного шага (первого), об/мин; 0 — таких винтов нет
  propEfficiency: number; // его КПД T·V/P_вал (0 на месте)
  power: number; // нужная мощность без возврата энергии, с потерями
  powerRecovered: number; // то же с полным возвратом (мгновенное значение, может быть отрицательным)
  powerAvailable: number;
  minMargin: number;
  minMarginPart: string;
  minMarginMode: FailureMode;
  minMarginSpan: number;
  minYieldMargin: number;
  crewAccel: number; // |a − g| / g в худшем кресле
  crewAccelVec: V3; // a − g в том же кресле, м/с², в осях корпуса
  maxMach: number;
  stalledFrac: number;
  wingAlphaDeg: number;
  actuatorLagDeg: number;
}

export interface BreakEvent {
  t: number;
  part: string;
  spanFrac: number;
  mode: FailureMode;
  margin: number;
}

export interface SimOptions {
  breakable?: boolean;
  altitude?: number;
  wind?: V3;
  gravity?: boolean;
  aero?: boolean;
  materialOverride?: string;
  materialCustom?: Material; // свой материал для всех силовых деталей (обратная задача)
  stepScale?: number; // во сколько раз мельче шаг расчёта (проверка сходимости по шагу)
  isaDeviation?: number; // отклонение температуры от стандартной, °C (ISA ± dT)
  groundEffect?: boolean; // влияние земли на винты и крылья (по умолчанию включено; выключается для сверок «вдали от земли»)
  // Поток через несущий винт: 'bemt' — свой на каждом кольце диска (теория элемента лопасти с импульсом по кольцам,
  // концевые потери Прандтля); 'uniform' — прежний: один на весь диск × κ = 1,15 и обрезка подъёмной силы у конца лопасти.
  rotorInflow?: 'bemt' | 'uniform';
}

const RAD_PER_RPM = (2 * Math.PI) / 60;
const SPAN_EFF = 0.9;

/**
 * Скорость, наведённая прямым вихревым отрезком A→B циркуляции G в точке P (закон Био — Савара), с ядром вихря rc:
 * v = G/(4π) · (r₁×r₂)/(|r₁×r₂|² + rc²·|r₀|²) · r₀·(r₁/|r₁| − r₂/|r₂|), r₁ = P − A, r₂ = P − B, r₀ = B − A.
 */
export function vortexSegment(P: V3, A: V3, B: V3, G: number, rc: number): V3 {
  const r1 = sub(P, A), r2 = sub(P, B), r0 = sub(B, A);
  const l1 = len(r1), l2 = len(r2);
  if (l1 < 1e-9 || l2 < 1e-9 || !G) return v3();
  const c = cross(r1, r2);
  const den = dot(c, c) + rc * rc * dot(r0, r0);
  if (den < 1e-12) return v3();
  return scale(c, ((G / (4 * Math.PI)) * dot(r0, sub(scale(r1, 1 / l1), scale(r2, 1 / l2)))) / den);
}

/**
 * Присоединённые массы эллипсоида вращения (Лэмб, «Гидродинамика», § 373): k₁ — при движении вдоль оси, k₂ — поперёк.
 * L — длина, D — диаметр. e = √(1 − (D/L)²), α₀ = 2(1 − e²)/e³·(½·ln((1+e)/(1−e)) − e),
 * β₀ = 1/e² − (1 − e²)/(2e³)·ln((1+e)/(1−e)), k₁ = α₀/(2 − α₀), k₂ = β₀/(2 − β₀).
 */
export function lambCoefficients(L: number, D: number): { k1: number; k2: number } {
  if (!(L > D * 1.001)) return { k1: 0.5, k2: 0.5 }; // шар (и сплюснутое тело — момента Мунка не считаем)
  const e = Math.sqrt(1 - (D / L) ** 2);
  const lg = Math.log((1 + e) / (1 - e));
  const a0 = ((2 * (1 - e * e)) / e ** 3) * (0.5 * lg - e);
  const b0 = 1 / (e * e) - ((1 - e * e) / (2 * e ** 3)) * lg;
  return { k1: a0 / (2 - a0), k2: b0 / (2 - b0) };
}
const IDQ: Q = { x: 0, y: 0, z: 0, w: 1 };

export class Sim {
  private shaftLp = new Map<string, number>();
  static flutterCache = new Map<string, FlutterResult>();
  tailCache = new Map<string, { t: number; power: number; thetaDeg: number; thrust: number }>();
  readonly R: R;
  readonly spec: Spec;
  readonly world: RAPIER_NS.World;
  readonly parts: PartModel[] = [];
  readonly bodies: BodyModel[] = [];
  readonly partById = new Map<string, PartModel>();
  readonly joints: JointModel[] = [];
  readonly rotors: RotorModel[] = [];
  readonly root: PartModel;
  readonly dt: number;
  readonly totalMass: number;
  readonly opts: Required<Omit<SimOptions, 'materialOverride' | 'materialCustom'>> & { materialOverride?: string; materialCustom?: Material };
  channels: Record<string, number> = { throttle: 0, collective: 0, pitch: 0, feather: 1, rpm: 1 };
  t = 0;
  steps = 0;
  rho: number;
  soundSpeed: number;
  mu = 1.81e-5; // динамическая вязкость воздуха, Па·с (Сазерленд, по температуре на высоте)
  g: number;
  powerAvailable: number;
  /** Угловая скорость винтов фиксированного шага, рад/с (по id привода). */
  propOmega = new Map<string, number>();
  sample: Sample;
  events: BreakEvent[] = [];
  private phases = new Map<string, number>();
  private freqNow = new Map<string, number>();
  private prevSeatV: V3[] | null = null;
  private extF = v3(); // воздух: сумма сил за шаг
  private extM0 = v3(); // и их момент относительно начала координат
  // Измерять момент, которым фиксатор держит корпус (свободный полёт с удержанием курса и наклона).
  measureHold = false;
  holdTorque = v3(); // этот момент на последнем шаге, Н·м, мир

  constructor(RAPIER: R, spec: Spec, opts: SimOptions = {}) {
    const val = validateSpec(spec, Object.keys(MATERIALS));
    if (!val.ok) throw new SpecError(val.errors);
    this.R = RAPIER;
    this.spec = spec;
    // Незаданные (undefined) опции не должны затирать значения по умолчанию.
    const given = Object.fromEntries(Object.entries(opts).filter(([, x]) => x !== undefined));
    this.opts = { breakable: true, altitude: 0, wind: v3(), gravity: true, aero: true, stepScale: 1, isaDeviation: 0, groundEffect: true, rotorInflow: (globalThis as { __ROTOR_INFLOW?: 'bemt' | 'uniform' }).__ROTOR_INFLOW ?? 'bemt', ...given };
    if (!Number.isFinite(this.opts.altitude)) throw new SpecError([`высота ${this.opts.altitude}: должна быть числом`]);
    const atm = atmosphere(spec.environment, this.opts.altitude, this.opts.isaDeviation);
    this.rho = atm.rho;
    this.soundSpeed = atm.soundSpeed;
    this.mu = airViscosity(atm.soundSpeed);
    // Мощность с высотой (engine.ts): поршневой без наддува — закон графика Lycoming P/P₀ = 1 − k·(1 − δ/√θ);
    // турбовальный — δ/√θ, не больше взлётной. Раньше: Гэгг — Феррар (1,132σ − 0,132) и σ^0,7 — формулы без связи с данными мотора.
    const pp = spec.powerplant;
    const eng = pp.engine ?? (pp.lapse === 'piston' ? { type: 'piston' as const, fullThrottleSL: pp.power } : pp.lapse === 'turbine' ? { type: 'turboshaft' as const, sfcRated: 0 } : null);
    this.powerAvailable = eng ? availablePower(eng, pp.power, spec.environment, this.opts.altitude, this.opts.isaDeviation) : pp.power;
    this.g = spec.environment.g;
    this.world = new RAPIER.World(v3(0, this.opts.gravity ? -this.g : 0, 0));
    this.world.numSolverIterations = 8;

    let fMax = 0;
    for (const a of spec.actuators) {
      if (a.type === 'oscillator') fMax = Math.max(fMax, a.freqHz);
      if (a.type === 'spinner') fMax = Math.max(fMax, (a.rpm / 60) * 1.3);
    }
    this.dt = 1 / (Math.max(240, 40 * fMax) * Math.max(1, this.opts.stepScale)); // ТЗ 7.1
    this.world.timestep = this.dt;

    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setFriction(0.6), ground);

    // Обход дерева от корня: жёсткие соединения — в тело родителя, поворотные — новое тело.
    const childJoints = new Map<string, Joint[]>();
    const hasParent = new Set(spec.joints.map((j) => j.child));
    for (const j of spec.joints) childJoints.set(j.parent, [...(childJoints.get(j.parent) ?? []), j]);
    const rootSpec = spec.parts.find((p) => !hasParent.has(p.id))!;
    const visit = (p: Part, body: BodyModel | null, viaJoint: Joint | null, parent: PartModel | null) => {
      const pm = this.buildPart(p, body);
      if (parent && viaJoint) this.linkJoint(viaJoint, parent, pm);
      for (const j of childJoints.get(p.id) ?? []) {
        const child = spec.parts.find((x) => x.id === j.child)!;
        visit(child, j.type === 'fixed' ? pm.b : null, j, pm);
      }
    };
    visit(rootSpec, null, null, null);
    for (const b of this.bodies) this.setBodyMass(b);
    this.root = this.partById.get(rootSpec.id)!;
    for (const a of spec.actuators) if (a.type === 'spinner') this.buildRotor(a);
    this.totalMass = this.parts.reduce((s, p) => s + p.mass, 0);
    for (const p of this.parts) p.elastic = this.elasticInfo(p);
    this.sample = this.emptySample();
  }

  // ---------- сборка ----------

  private material(p: Part): Material | null {
    if (!p.structure) return null;
    if (this.opts.materialCustom) return this.opts.materialCustom;
    const m = MATERIALS[this.opts.materialOverride ?? p.structure.material] ?? MATERIALS[p.structure.material];
    // Укладка задана и материал слоистый (с поперечным модулем) — свойства ламината по CLT.
    return m && p.structure.layup && m.E2 ? laminateMaterial(m, p.structure.layup) : m;
  }

  private newBody(t: V3, q: Q): BodyModel {
    const rb = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(q).setCanSleep(false),
    );
    const b: BodyModel = {
      rb, parts: [], prevV: null, prevW: null, prevT: null, prevQ: null,
      mid: { t, q, w: v3(), c: t }, acc: v3(), angAcc: v3(),
    };
    this.bodies.push(b);
    return b;
  }

  /** Масса, центр масс, инерция и коллайдер детали в её собственных осях. */
  private massModel(p: Part) {
    const R = this.R;
    const mat = this.material(p);
    const elements: Element[] = [];
    let mass = 0;
    let com = v3();
    let inertia = v3();
    let shape: RAPIER_NS.ColliderDesc;
    let shapeCenter = v3();
    if (p.aero) {
      const a = p.aero;
      const n = a.sections ?? 12;
      const dr = a.span / n; // по проекции размаха
      const dl = dr * beamAxes(a).stretch; // длина элемента вдоль оси балки
      const tan = (d?: number) => Math.tan((d ?? 0) * deg);
      const at = (r: number) => v3(-r * tan(a.sweepDeg), r * tan(a.dihedralDeg), a.side * r);
      const chordAt = (r: number) => chordAtFrac(a, r / a.span);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const rMid = (i + 0.5) * dr;
        const rIn = i * dr;
        const c = chordAt(rMid);
        const sec = p.structure ? sectionAt(p.structure, chordAt(rIn), a.airfoil.thickness) : null;
        const secMid = p.structure ? sectionAt(p.structure, c, a.airfoil.thickness) : null;
        const m = (secMid && mat ? mat.density * secMid.area * dl : 0) + (p.structure ? p.structure.skinArealMass * c * dl : 0);
        sum += m;
        elements.push({
          r: at(rMid), chord: c, dr: dl, mass: m, twist: ((a.twistDeg ?? 0) * deg * rMid) / a.span,
          spanFrac: rMid / a.span, innerR: at(rIn), section: sec,
          vnPrev: NaN, dF: v3(), fLoc: v3(), dFm: v3(), pW: v3(), pR: v3(), alpha: 0, stalled: false, mach: 0,
          wag: { x: 0, y: 0 }, aQPrev: NaN, incPrev: NaN, wnPrev: NaN, stall: { aF: NaN, w: 1, tauV: NaN, cv: NaN, cnV: 0 }, ai: 0, gam: 0,
        });
      }
      const target = p.mass ?? sum;
      for (const e of elements) e.mass = sum > 0 ? (e.mass * target) / sum : target / n;
      mass = target;
      for (const e of elements) com = add(com, scale(e.r, e.mass / mass));
      const th = a.airfoil.thickness;
      for (const e of elements) {
        const d = sub(e.r, com);
        const ct = e.chord * th;
        inertia = add(inertia, v3(
          e.mass * (d.y * d.y + d.z * d.z + (ct * ct) / 12),
          e.mass * (d.x * d.x + d.z * d.z + (e.chord * e.chord) / 12),
          e.mass * (d.x * d.x + d.y * d.y + (e.chord * e.chord) / 12),
        ));
      }
      const meanChord = surfaceArea(a) / a.span;
      shapeCenter = at(a.span / 2);
      shape = R.ColliderDesc.cuboid(meanChord / 2, Math.max(0.005, (meanChord * th) / 2), a.span / 2);
    } else {
      const s = p.shape!;
      const [sx, sy, sz] = s.size;
      mass = p.mass!;
      if (s.type === 'ellipsoid' || s.type === 'sphere') {
        const [a, b, c] = [sx / 2, sy / 2, sz / 2];
        inertia = v3((mass * (b * b + c * c)) / 5, (mass * (a * a + c * c)) / 5, (mass * (a * a + b * b)) / 5);
        shape = s.type === 'sphere' ? R.ColliderDesc.ball(a) : R.ColliderDesc.cuboid(a * 0.8, b * 0.8, c * 0.8);
      } else {
        inertia = v3((mass * (sy * sy + sz * sz)) / 12, (mass * (sx * sx + sz * sz)) / 12, (mass * (sx * sx + sy * sy)) / 12);
        shape = R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
      }
    }
    return { mat, elements, mass, com, inertia, shape, shapeCenter };
  }

  /**
   * Масса, центр масс и тензор инерции тела — по его деталям, с теоремой Штейнера I + m·(|d|²·E − d·dᵀ).
   * Rapier 0.14 при сложении коллайдеров одного тела прибавляет m·(|d|²·E + d·dᵀ): две массы по 1 кг
   * в ±1 м по оси z давали момент инерции вокруг этой оси 4 кг·м² вместо нуля. У самолёта это втрое–вчетверо
   * завышало инерцию по тангажу (крылья на ±5 м по размаху), у винта — инерцию поперёк оси вращения.
   * Поэтому тело из нескольких деталей получает уже сложенные свойства, а его коллайдеры — нулевую массу.
   * У тела из одной детали складывать нечего: масса — у её коллайдера, как раньше (так левое и правое крыло
   * получают в точности зеркальную инерцию).
   */
  private setBodyMass(b: BodyModel) {
    if (b.parts.length <= 1) {
      for (const p of b.parts) p.collider.setMassProperties(p.mass, sub(p.com, p.colliderLocal), p.inertia, IDQ);
      b.rb.setAdditionalMassProperties(0, v3(), v3(), IDQ, true);
      b.rb.recomputeMassPropertiesFromColliders();
      return;
    }
    for (const p of b.parts) p.collider.setDensity(0);
    let m = 0;
    let c = v3();
    for (const p of b.parts) {
      m += p.mass;
      c = add(c, scale(add(p.offT, rotate(p.offQ, p.com)), p.mass));
    }
    if (m <= 0) return;
    c = scale(c, 1 / m);
    const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const ax = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
    for (const p of b.parts) {
      const cols = ax.map((e) => rotate(p.offQ, e)); // оси детали в осях тела
      const Ip = [p.inertia.x, p.inertia.y, p.inertia.z];
      const d = sub(add(p.offT, rotate(p.offQ, p.com)), c);
      const dv = [d.x, d.y, d.z];
      const d2 = dot(d, d);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const ci = [cols[0], cols[1], cols[2]].map((v) => [v.x, v.y, v.z][i]);
          const cj = [cols[0], cols[1], cols[2]].map((v) => [v.x, v.y, v.z][j]);
          I[i][j] += ci[0] * cj[0] * Ip[0] + ci[1] * cj[1] * Ip[1] + ci[2] * cj[2] * Ip[2] + p.mass * ((i === j ? d2 : 0) - dv[i] * dv[j]);
        }
    }
    const { values, frame } = symmetricEigen(I);
    b.rb.setAdditionalMassProperties(m, c, v3(Math.max(values[0], 1e-12), Math.max(values[1], 1e-12), Math.max(values[2], 1e-12)), frame, true);
    b.rb.recomputeMassPropertiesFromColliders();
  }

  private attachCollider(pm: PartModel, shape: RAPIER_NS.ColliderDesc) {
    const R = this.R;
    const c = add(pm.offT, rotate(pm.offQ, pm.colliderLocal));
    shape.setTranslation(c.x, c.y, c.z).setRotation(pm.offQ);
    shape.setMassProperties(pm.mass, sub(pm.com, pm.colliderLocal), pm.inertia, IDQ);
    const collides = pm.spec.collides ?? (pm.spec.kind === 'body' || pm.spec.kind === 'gear');
    shape.setCollisionGroups(collides || pm.broken ? 0x0001ffff : 0);
    if (pm.spec.friction !== undefined) shape.setFriction(pm.spec.friction).setFrictionCombineRule(R.CoefficientCombineRule.Min);
    pm.collider = this.world.createCollider(shape, pm.b.rb);
  }

  private buildPart(p: Part, body: BodyModel | null): PartModel {
    const qW = qEulerDeg(p.rotation);
    const tW = fromArr(p.position);
    const b = body ?? this.newBody(tW, qW);
    const bt = copy(b.rb.translation());
    const bq = b.rb.rotation();
    const mm = this.massModel(p);
    const pm: PartModel = {
      spec: p, b, offT: unrotate(bq, sub(tW, bt)), offQ: qMul(qConj(bq), qW),
      collider: null as unknown as RAPIER_NS.Collider, colliderLocal: mm.shapeCenter,
      mass: mm.mass, com: mm.com, inertia: mm.inertia, elements: mm.elements, material: mm.mat,
      parent: null, joint: null, children: [], broken: false, aeroForce: v3(), inducedAlpha: 0, groundFactor: 1,
      stations: mm.elements.map((_, i, all) => ({
        sigmaTension: 0, sigmaCompression: 0, tau: 0, sigmaTop: 0, corners: [], margin: Infinity, mode: 'none' as FailureMode,
        yieldMargin: Infinity, bucklingStress: 0, spanFrac: i / all.length, // внутренняя граница элемента
        cycleMax: [], cycleMin: [], lastCycle: null,
      })),
      worst: { margin: Infinity, mode: 'none', spanFrac: 0, yieldMargin: Infinity },
      rotor: null,
      elastic: null,
      axes: beamAxes(p.aero),
    };
    this.attachCollider(pm, mm.shape);
    b.parts.push(pm);
    this.parts.push(pm);
    this.partById.set(p.id, pm);
    return pm;
  }

  private linkJoint(j: Joint, parent: PartModel, child: PartModel) {
    const R = this.R;
    const welded = j.type === 'fixed';
    let rj: ImpulseJoint | null = null;
    let axisParentBody = v3(1, 0, 0);
    let anchor = v3();
    if (!welded) {
      axisParentBody = rotate(parent.offQ, fromArr(j.axis!));
      const pb = parent.b.rb;
      anchor = unrotate(pb.rotation(), sub(copy(child.b.rb.translation()), copy(pb.translation())));
      // Rapier задаёт ось одинаково в осях обоих тел — проверяем, что это одна ось в мире.
      const wP = rotate(pb.rotation(), axisParentBody);
      const wC = rotate(child.b.rb.rotation(), axisParentBody);
      if (len(sub(wP, wC)) > 1e-6) throw new SpecError([`joints[${j.id}]: ось шарнира не совпадает в осях родителя и ребёнка`]);
      rj = this.world.createImpulseJoint(R.JointData.revolute(anchor, v3(), axisParentBody), pb, child.b.rb, true);
      (rj as RAPIER_NS.RevoluteImpulseJoint).configureMotorModel(R.MotorModel.AccelerationBased);
    }
    const jm: JointModel = {
      spec: j, parent, child, welded, rapier: rj, axisParentBody, force: v3(), moment: v3(), shaftPower: 0, target: 0, anchor,
    };
    child.parent = parent;
    child.joint = jm;
    parent.children.push(child);
    this.joints.push(jm);
  }

  private buildRotor(a: Extract<Actuator, { type: 'spinner' }>) {
    const jm = this.joints.find((j) => j.spec.id === a.joint)!;
    const hub = jm.child;
    const blades: PartModel[] = [];
    const collect = (p: PartModel) => {
      for (const c of p.children) {
        if (c.spec.kind === 'blade') blades.push(c);
        collect(c);
      }
    };
    collect(hub);
    const hubPos = fromArr(hub.spec.position);
    const radius = blades.reduce((m, b) => Math.max(m, len(sub(fromArr(b.spec.position), hubPos)) + (b.spec.aero?.span ?? 0)), 0);
    const rot: RotorModel = { actuator: a, hub, blades, radius, axisW: v3(0, 1, 0), inflow: 0, thrust: 0, tipLoss: 1, groundFactor: 1, st: [], flapping: !!a.flapping && blades.length > 0, omega: 0 };
    if (rot.flapping) {
      // Ось шарнира каждой лопасти — поперёк лопасти в плоскости вращения, через центр втулки. Момент инерции — по массам
      // сечений лопасти.
      const mastW = norm(rotate(jm.parent.b.rb.rotation(), jm.axisParentBody));
      const elW = (b: PartModel, r: V3) => add(fromArr(b.spec.position), rotate(qEulerDeg(b.spec.rotation), r));
      for (const b of blades) {
        let s = sub(elW(b, b.elements[b.elements.length - 1].r), hubPos);
        s = norm(sub(s, scale(mastW, dot(s, mastW))));
        const aW = norm(cross(s, mastW)); // поворот на +β вокруг этой оси поднимает лопасть (s → ось вала)
        let Ib = 0;
        for (const e of b.elements) {
          const d = sub(elW(b, e.r), hubPos);
          const dp = sub(d, scale(aW, dot(d, aW)));
          Ib += e.mass * dot(dp, dp);
        }
        b.flap = { beta: 0, rate: 0, acc: 0, Ib, axisHub: unrotate(hub.b.rb.rotation(), aW), aW, H: hubPos, M: 0, pre: (b.spec.aero?.dihedralDeg ?? 0) * deg };
      }
    }
    if (blades[0]) {
      const b0 = blades[0];
      const off = len(sub(fromArr(b0.spec.position), hubPos));
      rot.st = b0.elements.map((e) => ({ r: off + len(e.r), dr: e.dr, vi: 0, dT: 0, F: 1 }));
    }
    for (const b of blades) b.rotor = rot;
    this.rotors.push(rot);
  }

  /**
   * Первая форма изгиба как у консольной балки: f₁ = (1,875²/2π)·√(EI/(μL⁴)), по сечению
   * на середине размаха. У лопасти центробежная сила повышает жёсткость: f² = f₁² + 1,17·n²
   * (Саутвелл, n — частота вращения).
   *
   * Воздух в этой форме участвует дважды (по полосам, с формой φ консоли):
   * - присоединённая масса ρ·π·c²/4 на метр размаха колеблется вместе с крылом и понижает частоту:
   *   у лёгкого крыла махолёта она сравнима с массой самого крыла;
   * - изгиб меняет угол атаки на ẇ/U, и подъёмная сила гасит колебание: демпфирование на метр
   *   ½·ρ·a·c·U·F(k) (F — действительная часть функции Теодорсена, k = ω·c/2U). U — скорость
   *   сечения: Ω·r у лопасти, скорость потока у крыла. У лопасти это то же, что число Лока γ:
   *   ζ ≈ γ/16 у шарнирной лопасти, у настоящих винтов 0,2–0,5. Демпфирование конструкции — 0,03.
   * Раньше учитывалась только конструкция, и у каждой лопасти вертолёта (первая частота около
   * 1,1 оборота) стенд предупреждал о раскачке «до 4–6 раз».
   */
  private elasticInfo(p: PartModel): ElasticInfo | null {
    const a = p.spec.aero;
    if (!a || !p.material || !p.elements.length) return null;
    const mid = p.elements[Math.floor(p.elements.length / 2)].section;
    if (!mid) return null;
    const L = a.span * p.axes.stretch;
    const EI = p.material.E * mid.iFlap;
    const mu = p.mass / L;
    const f1Struct = ((1.875 * 1.875) / (2 * Math.PI)) * Math.sqrt(EI / (mu * L ** 4));
    let fe = 0;
    // Возбуждение: машущий привод этой детали или её предков; у лопасти — раз за оборот.
    const chain: string[] = [];
    for (let x: PartModel | null = p; x; x = x.parent) if (x.joint) chain.push(x.joint.spec.id);
    for (const act of this.spec.actuators) if (act.type === 'oscillator' && act.joints.some((j) => chain.includes(j.joint))) fe = act.freqHz;
    const air = this.opts.aero ? this.rho : 0;
    const omegaRotor = p.rotor ? (p.rotor.actuator.rpm * 2 * Math.PI) / 60 : 0;
    const hubOff = p.rotor ? len(sub(fromArr(p.spec.position), fromArr(p.rotor.hub.spec.position))) : 0;
    const flow = len(this.opts.wind);
    const cla = a.airfoil.clAlpha ?? 2 * Math.PI * 0.9;
    let mS = 0, mA = 0, cA = 0, chord = 0, cAU1 = 0;
    for (const e of p.elements) {
      const phi2 = cantileverMode(e.spanFrac) ** 2;
      mS += e.mass * phi2;
      mA += ((air * Math.PI * e.chord * e.chord) / 4) * e.dr * phi2;
      const U = p.rotor ? omegaRotor * (hubOff + e.spanFrac * a.span) : flow;
      cA += 0.5 * air * cla * e.chord * U * e.dr * phi2;
      cAU1 += 0.5 * air * cla * e.chord * e.dr * phi2;
      chord += e.chord / p.elements.length;
    }
    const massRatio = mS > 0 ? mS / (mS + mA) : 1;
    let f1 = f1Struct * Math.sqrt(massRatio);
    if (p.rotor) {
      const n = p.rotor.actuator.rpm / 60;
      f1 = Math.sqrt(f1 * f1 + 1.17 * n * n * massRatio);
      fe = n;
    }
    const w1 = 2 * Math.PI * f1;
    const uRef = p.rotor ? omegaRotor * (hubOff + 0.75 * a.span) : flow;
    const F = uRef > 0 ? theodorsen((w1 * chord) / (2 * uRef)).F : 1;
    const zetaAir = mS + mA > 0 ? (cA * F) / (2 * (mS + mA) * w1) : 0;
    const zeta = Math.min(1, STRUCTURAL_DAMPING + zetaAir);
    let fLag = f1Struct * Math.sqrt(mid.iLag / mid.iFlap);
    if (p.rotor) fLag = Math.sqrt(fLag * fLag + 0.17 * (p.rotor.actuator.rpm / 60) ** 2);
    const air1 = p.rotor ? undefined : { cAU: cAU1, mModal: mS + mA, chord };
    if (!fe) return { f1, fe: 0, ratio: 0, daf: 1, zeta, zetaAir, fLag, ...air1 };
    const r = fe / f1;
    const daf = r < 1 ? Math.max(1, 1 / Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2)) : 1;
    return { f1, fe, ratio: r, daf, zeta, zetaAir, fLag, ...air1 };
  }

  /**
   * Флаттер и дивергенция крыла (src/core/aeroelastic.ts) — у неподвижного крыла с заданным кессоном (structure.torsionBox):
   * без него жёсткость на кручение не известна. По сечениям:
   *  - изгибная жёсткость EI — лонжерона (E вдоль размаха, у ламината — Ex);
   *  - крутильная GJ — замкнутого кессона по формуле Бредта: GJ = 4A²·G / ∮ds/t, A = ширина × высота кессона
   *    (высота — 0,9 наибольшей толщины профиля: у кессона между лонжеронами профиль тоньше), обшивка сверху и снизу
   *    толщиной skin, стенки лонжеронов — wall; G — модуль сдвига материала (у ламината — Gxy);
   *  - упругая ось — середина кессона по хорде; масса лонжерона — на structure.sparAt, обшивки — равномерно по хорде;
   *    масса крыла сверх расчётной (mass детали) делится в той же пропорции. Грузы на крыле (баки, двигатели) не учтены.
   * Сжимаемость не учитывается (аэродинамика Теодорсена — несжимаемая): выше M ≈ 0,5 скорость флаттера завышена.
   */
  flutterInfo(p: PartModel): FlutterResult | null {
    const a = p.spec.aero, s = p.spec.structure, mat = p.material;
    if (!a || !s?.torsionBox || !mat || p.rotor || !p.elements.length) return null;
    const tb = s.torsionBox;
    const G = mat.G12 && mat.E2 ? mat.G12 : mat.E / (2 * (1 + mat.nu));
    const sparAt = s.sparAt ?? 0.3;
    const xEA = (tb.from + tb.to) / 2;
    const strips: Strip[] = [];
    for (const e of p.elements) {
      const sec = e.section;
      if (!sec) return null;
      const c = e.chord;
      const w = (tb.to - tb.from) * c, h = 0.9 * a.airfoil.thickness * c;
      const GJ = (4 * (w * h) ** 2 * G) / ((2 * w) / tb.skin + (2 * h) / s.wall);
      const mSpar = mat.density * sec.area, mSkin = s.skinArealMass * c;
      const k = e.mass / e.dr / Math.max(1e-12, mSpar + mSkin); // масса детали сверх расчётной — в той же пропорции
      const ms = mSpar * k, mk = mSkin * k;
      const m = ms + mk;
      const xcg = (ms * sparAt + mk * 0.5) * c / m;
      const Ia = ms * (sparAt * c - xEA * c) ** 2 + mk * ((0.5 * c - xEA * c) ** 2 + (c * c) / 12);
      strips.push({ y: e.spanFrac * a.span * p.axes.stretch, dy: e.dr, b: c / 2, a: 2 * xEA - 1, m, xa: xcg - xEA * c, Ia, EI: mat.E * sec.iFlap, GJ });
    }
    let sup: Supports = {};
    if (s.strut) {
      const yS = s.strut.at * a.span * p.axes.stretch;
      const c = chordAtFrac(a, s.strut.at);
      sup = { root: 'pinned', strut: { y: yS, d: (s.strut.chordAt - xEA) * c } };
    }
    // Расчёт долгий (секунда-две): у симметричной пары крыльев он одинаковый — кэш по конструкции, крылу и плотности.
    const key = JSON.stringify([s, { ...a, side: 0, control: undefined }, p.mass, p.spec.mass, this.rho]);
    const hit = Sim.flutterCache.get(key);
    if (hit) return hit;
    const r = flutterAnalysis(strips, this.rho, Math.max(50, 0.8 * this.soundSpeed), sup);
    Sim.flutterCache.set(key, r);
    return r;
  }

  /**
   * Сопротивление корпуса по точкам его плана: продольное — по dragArea (лобовое C_D·S), поперечное — по принципу
   * поперечного обтекания: C_D поперёк × площадь проекции формы поперёк потока. В каждой точке к потоку добавляется
   * струя несущих винтов, если точка под диском: так получается нагрузка от струи на корпус (download) и её момент.
   */
  private bodyDrag(p: PartModel, tP: V3, q: Q, wind: V3, rho: number) {
    const sh = p.spec.shape!;
    const [L, H, W] = sh.size;
    const cd = p.spec.crossflowCd ?? (sh.type === 'box' ? 1.2 : sh.type === 'sphere' ? 0.47 : 0.7);
    // Площадь проекции поперёк продольной оси на плоскость, перпендикулярную направлению (0, ny, nz).
    const aProj = (ny: number, nz: number) =>
      sh.type === 'box' ? Math.abs(ny) * L * W + Math.abs(nz) * L * H
      : sh.type === 'sphere' ? (Math.PI / 4) * L * L
      : (Math.PI / 4) * L * Math.sqrt((W * ny) ** 2 + (H * nz) ** 2);
    // Сетка по плану: 16 точек, гуще вдоль длинной стороны (у панели под винтом — по размаху, где струя неравномерна).
    const Nx = Math.max(2, Math.min(16, Math.round(4 * Math.sqrt(L / W))));
    const Nz = Math.max(2, Math.min(16, Math.round(4 * Math.sqrt(W / L))));
    const pts: V3[] = [];
    for (let i = 0; i < Nx; i++)
      for (let j = 0; j < Nz; j++) {
        const x = ((i + 0.5) / Nx - 0.5) * 2, z = ((j + 0.5) / Nz - 0.5) * 2;
        if (sh.type !== 'box' && x * x + z * z > 1.2) continue; // у эллипсоида — точки внутри плана (с запасом по углам сетки)
        pts.push(add(p.com, v3((x * L) / 2, 0, (z * W) / 2)));
      }
    const share = 1 / pts.length;
    const Ftot = v3();
    for (const lp of pts) {
      const pw = add(tP, rotate(q, lp));
      const air = add(wind, this.rotorWakeAt(pw));
      const vl = unrotate(q, sub(this.pointVel(p.b, pw), air)); // движение точки относительно воздуха, в осях детали
      const Fl = v3(-0.5 * rho * Math.abs(vl.x) * vl.x * (p.spec.dragArea ?? 0) * share, 0, 0);
      const vc = Math.hypot(vl.y, vl.z);
      if (vc > 1e-9) {
        const k = -0.5 * rho * vc * cd * aProj(vl.y / vc, vl.z / vc) * share;
        Fl.y = k * vl.y;
        Fl.z = k * vl.z;
      }
      const F = rotate(q, Fl);
      p.b.rb.addForceAtPoint(F, pw, true);
      this.noteForce(F, pw);
      addTo(Ftot, F);
    }
    p.aeroForce = Ftot;
    if (sh.type === 'ellipsoid' && L > Math.max(H, W)) {
      // Момент Мунка (потенциальное обтекание тела, Аллен — Перкинс — его «невязкая» часть): тело, идущее под углом
      // к потоку, разворачивается поперёк потока. Импульс присоединённой массы P = ρ·V·(k₁·v_x·x̂ + k₂·v_⊥), момент на
      // тело M = P × v = ρ·V·(k₁ − k₂)·v_x·(x̂ × v), v — скорость тела относительно воздуха, V — объём эллипсоида.
      // Поперечные размеры усредняются: D = √(H·W).
      const cW = add(tP, rotate(q, p.com));
      const v = sub(this.pointVel(p.b, cW), add(wind, this.rotorWakeAt(cW)));
      const xh = rotate(q, v3(1, 0, 0));
      const { k1, k2 } = lambCoefficients(L, Math.sqrt(H * W));
      const M = scale(cross(xh, v), rho * ((Math.PI / 6) * L * H * W) * (k1 - k2) * dot(v, xh));
      p.b.rb.addTorque(M, true);
      addTo(this.extM0, M);
    }
  }

  /**
   * Возмущение потока у фюзеляжа (обтекание тела поперечным потоком, теория тонкого тела): в сечении тела — обтекание
   * кругового цилиндра местного радиуса R поперечной составляющей c набегающего потока (двумерный диполь):
   * δ = (R²/r²)·(c − 2(c·r̂)·r̂), r — расстояние от оси тела в плоскости сечения. Так у корня крыла фюзеляж скашивает поток:
   * у среднеплана — вверх по углу атаки (вдвое у самого борта), у высокоплана при скольжении — вверх под наветренной
   * консолью и вниз под подветренной (поперечная устойчивость высокоплана); у киля над хвостовой частью — боковой скос.
   * Тела — эллипсоиды с аэродинамикой (dragArea), радиус сечения — по эллипсоиду, поперечные размеры усреднены: √(H·W)/2.
   */
  private bodyFlowAt(P: V3, wind: V3): V3 {
    const out = v3();
    for (const b of this.parts) {
      const sh = b.spec.shape;
      if (b.broken || b.spec.aero || !sh || sh.type !== 'ellipsoid' || b.spec.dragArea === undefined) continue;
      const [L, H, W] = sh.size;
      const { t, q } = this.pose(b);
      const c0 = add(t, rotate(q, b.com));
      const xh = rotate(q, v3(1, 0, 0));
      const d = sub(P, c0);
      const s = dot(d, xh);
      if (Math.abs(s) >= L / 2) continue;
      const R = (Math.sqrt(H * W) / 2) * Math.sqrt(1 - ((2 * s) / L) ** 2);
      const rv = sub(d, scale(xh, s));
      const r = len(rv);
      if (r < 1e-6) continue;
      const u = sub(wind, this.pointVel(b.b, c0));
      const c = sub(u, scale(xh, dot(u, xh)));
      const rh = scale(rv, 1 / r);
      addTo(out, scale(sub(c, scale(rh, 2 * dot(c, rh))), (R * R) / Math.max(r, R) ** 2));
    }
    return out;
  }

  /**
   * Несущая линия Прандтля для всех несущих крыльев вместе (обе консоли, тандем, биплан): каждое сечение — подковообразный
   * вихрь (присоединённый по линии четвертей хорд на ширине сечения, два свободных — по потоку), циркуляция — из подъёмной
   * силы сечения на этом шаге. Индуктивная скорость в середине каждого сечения — по Био — Савару от всех подков,
   * индуктивный угол — её проекция на нормаль сечения. Простые итерации здесь расходятся (пилообразная мода соседних
   * сечений), поэтому каждый шаг — шаг Ньютона: система (I + V·A·D)·Δ = A·Γ − αi решается целиком (D = ½·c·c_lα, у
   * сорванного сечения наклон берётся нулевым).
   *
   * Раньше индуктивный угол был один на консоль: C_L консоли / (π·e·λ). Так подъёмная сила у законцовки не падала, а
   * антисимметричная нагрузка (элероны, вращение по крену) почти не гасилась скосом: эффективность элеронов была вдвое
   * больше расчётной (C_lδa ≈ 0,48 против 0,18–0,23 у моделей C172), угловая скорость крена — в 2,6 раза больше измеренной
   * у Cessna 177B (pb/2V ≈ 0,24 против 0,09, NASA CR-2337). Влияние земли — как раньше, множителем к скосу.
   * Если потока почти нет (стенд без ветра), остаётся прежняя модель: без потока следа нет. Машущие крылья — тоже прежняя.
   */
  private llOn = false;
  /**
   * Порыв, «вмороженный» в воздух: добавка к ветру в точке мира (м/с). Задан — каждое сечение крыла и оперения видит порыв
   * в своём месте: самолёт входит в порыв носом, оперение — позже на плечо/V (так порыв проходят на самом деле и так
   * выведен коэффициент ослабления порыва в нормах). null — порыва нет.
   */
  gustAt: ((p: V3) => V3) | null = null;
  /**
   * Хвостовой винт как сила (свободный полёт вертолёта): тяга — BEMT при шаге от педалей (tailRotor.channel), приложена
   * в центре хвостового винта поперёк балки. Выключено (по умолчанию) — прежняя модель для программ с закреплённым по
   * рысканию корпусом: тяга = реактивный момент / плечо, только мощность.
   */
  tailRotorFree = false;
  private govI = 0;
  private enginePower = 0;
  private rotorInertia(r: RotorModel): number {
    const mastW = norm(rotate(r.hub.parent!.b.rb.rotation(), r.hub.joint!.axisParentBody));
    let I = 0;
    for (const b of [r.hub, ...r.blades]) {
      const { t } = this.pose(b);
      for (const e of b.elements) {
        const d = sub(add(t, rotate(this.pose(b).q, e.r)), this.pose(r.hub).t);
        const dp = sub(d, scale(mastW, dot(d, mastW)));
        I += e.mass * dot(dp, dp);
      }
    }
    return Math.max(I, 1);
  }
  private tailVi = new Map<string, number[]>();
  private hubWPrev = new Map<RotorModel, V3>();
  private liftingLine(wind: V3) {
    const vRoot = this.pointVel(this.root.b, copy(this.root.b.rb.translation()));
    const vInf = sub(wind, vRoot);
    const V = len(vInf);
    // Машущие крылья (нестационарная аэродинамика) — по-прежнему: их след нестационарный, квазистационарная несущая
    // линия для них неверна (на Snowbird запас тяги упал бы с 0,54 до 0,40 при измеренных 0,92).
    const parts = this.parts.filter((p) => this.isMainWing(p) && !p.flap && !p.spec.aero!.unsteady);
    this.llOn = V > 2 && parts.length > 0;
    if (!this.llOn) return;
    const d = scale(vInf, 1 / V); // куда сносится след
    type S = { e: Element; A: V3; B: V3; P: V3; n: V3; g: number; ka: number; gf: number; V: number };
    const S: S[] = [];
    for (const p of parts) {
      const { t: tP, q } = this.pose(p);
      const eN = rotate(q, p.axes.n);
      const eS = rotate(q, p.axes.s);
      const cla = p.spec.aero!.airfoil.clAlpha ?? 2 * Math.PI * 0.9;
      for (const e of p.elements) {
        const P = add(tP, rotate(q, e.r));
        // Направление присоединённого вихря — такое, чтобы положительная циркуляция давала подъёмную силу по нормали.
        const sgn = dot(cross(vInf, eS), eN) >= 0 ? 1 : -1;
        const h = scale(eS, (sgn * e.dr) / 2);
        const Vs = Math.max(1, len(sub(sub(wind, this.pointVel(p.b, P)), scale(eS, dot(sub(wind, this.pointVel(p.b, P)), eS)))));
        S.push({ e, A: sub(P, h), B: add(P, h), P, n: eN, g: e.gam, ka: e.stalled ? 0 : 0.5 * e.chord * cla, gf: p.groundFactor, V: Vs });
      }
    }
    const core2 = 1e-4; // ядро вихря (1 см), чтобы не было деления на ноль на самом вихре
    // Скорость от отрезка X1→X2 и от полубесконечного вихря из X вдоль d (на единицу циркуляции).
    const seg = (Pt: V3, X1: V3, X2: V3) => {
      const r1 = sub(Pt, X1), r2 = sub(Pt, X2), r0 = sub(X2, X1);
      const c = cross(r1, r2);
      const c2 = dot(c, c) + core2 * dot(r0, r0);
      const l1 = len(r1), l2 = len(r2);
      if (l1 < 1e-9 || l2 < 1e-9) return v3();
      return scale(c, dot(r0, sub(scale(r1, 1 / l1), scale(r2, 1 / l2))) / (4 * Math.PI * c2));
    };
    const semi = (Pt: V3, X: V3) => {
      const r = sub(Pt, X);
      const c = cross(d, r);
      const lr = len(r);
      if (lr < 1e-9) return v3();
      return scale(c, (1 + dot(r, d) / lr) / (4 * Math.PI * (dot(c, c) + core2)));
    };
    const horse = (Pt: V3, s: S) => add(sub(seg(Pt, s.A, s.B), semi(Pt, s.A)), semi(Pt, s.B));
    const N = S.length;
    // A[j][i] — индуктивный угол в сечении j от единичной циркуляции сечения i.
    const M: number[][] = [];
    const rhs: number[] = [];
    for (let j = 0; j < N; j++) {
      const sj = S[j];
      const row = new Array<number>(N + 1);
      let target = 0;
      for (let i = 0; i < N; i++) {
        const Aji = (-dot(horse(sj.P, S[i]), sj.n) / sj.V) * sj.gf;
        target += Aji * S[i].g;
        // dΓi/dαi = −V_i·D_i: рост индуктивного угла уменьшает циркуляцию.
        row[i] = Aji * S[i].V * S[i].ka + (i === j ? 1 : 0);
      }
      row[N] = target - sj.e.ai;
      M.push(row);
      rhs.push(target);
    }
    // Гаусс с выбором ведущего элемента.
    for (let c = 0; c < N; c++) {
      let piv = c;
      for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const m = M[c][c];
      if (Math.abs(m) < 1e-12) return;
      for (let r = c + 1; r < N; r++) {
        const f = M[r][c] / m;
        if (f) for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array<number>(N).fill(0);
    for (let r = N - 1; r >= 0; r--) {
      let s = M[r][N];
      for (let k = r + 1; k < N; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    // Шаг Ньютона чуть недорелаксирован: подъёмная сила нелинейна (срыв), а след на самом деле сходит за время.
    for (let j = 0; j < N; j++) if (Number.isFinite(x[j])) S[j].e.ai += 0.7 * x[j];
  }

  private applyTailRotors(wind: V3) {
    for (const a of this.spec.actuators) {
      if (a.type !== 'spinner' || !a.tailRotor?.channel || !a.tailRotor.at) continue;
      const tr = a.tailRotor;
      const rr = this.rotors.find((x) => x.actuator === a);
      if (!rr || rr.hub.broken) continue;
      const body = rr.hub.parent!;
      const { t: tB, q: qB } = this.pose(body);
      const P = add(tB, rotate(qB, sub(fromArr(tr.at!), fromArr(body.spec.position))));
      const mastW = scale(norm(rotate(body.b.rb.rotation(), rr.hub.joint!.axisParentBody)), a.direction);
      const hubT = this.pose(rr.hub).t;
      let rv = sub(P, hubT);
      rv = sub(rv, scale(mastW, dot(rv, mastW)));
      // Тяга — так, чтобы её момент вокруг вала был по вращению винта (против реактивного момента на корпус).
      const d = norm(cross(mastW, norm(rv)));
      const Vc = dot(sub(this.pointVel(body.b, P), wind), d);
      const omNom = a.rpm * RAD_PER_RPM;
      const om = Math.abs(rr.omega) > 1 ? Math.abs(rr.omega) : omNom;
      let vi = this.tailVi.get(a.id);
      if (!vi) this.tailVi.set(a.id, (vi = []));
      const res = bemtStep(tr, this.channels[tr.channel!] ?? 0, Vc, this.rho, this.soundSpeed, om / omNom, this.mu, vi);
      const F = scale(d, res.T);
      body.b.rb.addForceAtPoint(F, P, true);
      this.noteForce(F, P);
      this.tailCache.set(a.id, { t: this.t, power: Math.max(0, res.P), thetaDeg: this.channels[tr.channel!] ?? 0, thrust: res.T });
    }
  }

  /** Главные (несущие) крылья — источники скоса потока: крыло с индуктивным скосом, не оперение и не лопасть. */
  private isMainWing(p: PartModel): boolean {
    const a = p.spec.aero;
    return !!a && p.spec.kind === 'wing' && a.induced === 'wing' && a.role !== 'tail' && !p.rotor && !p.broken;
  }

  /**
   * Скос потока от несущих крыльев в точке P (на оперении). Каждая консоль — подковообразный вихрь (Прандтль): присоединённый
   * вихрь по линии четвертей хорд от корня на π/4 размаха консоли (так у эллиптической нагрузки сходит свёрнутый концевой
   * вихрь) и два свободных вихря по потоку. Циркуляция — из подъёмной силы консоли: Γ = L/(ρ·V·b'). Вихревой след
   * сносится потоком, поэтому в точку P приходит циркуляция, которая была у крыла Δt = (путь по потоку)/V назад
   * (запаздывание скоса — от него демпфирование тангажа C_mα̇). У земли — зеркальный вихрь обратного знака.
   */
  wingWash(P: V3, wind: V3): V3 {
    const out = v3();
    for (const w of this.parts) {
      if (!w.wake || !w.wake.length || !this.isMainWing(w)) continue;
      const a = w.spec.aero!;
      const { t: tP, q } = this.pose(w);
      const vRel = sub(this.pointVel(w.b, tP), wind);
      const V = len(vRel);
      if (V < 1) continue;
      const d = scale(vRel, -1 / V); // вниз по потоку
      const last = w.elements[w.elements.length - 1];
      const tip = add(tP, scale(rotate(q, last.r), (Math.PI / 4) / last.spanFrac));
      const delay = Math.max(0, dot(sub(P, tP), d)) / V;
      const tg = this.t - delay;
      const h = w.wake;
      let g = h[h.length - 1].g;
      if (tg < h[h.length - 1].t) {
        let i = h.length - 1;
        while (i > 0 && h[i - 1].t > tg) i--;
        g = i === 0 ? h[0].g : h[i - 1].g + ((tg - h[i - 1].t) / (h[i].t - h[i - 1].t)) * (h[i].g - h[i - 1].g);
      }
      const far = 200 * a.span;
      const rc = 0.1 * (surfaceArea(a) / a.span);
      const pts = [add(tP, scale(d, far)), tP, tip, add(tip, scale(d, far))];
      for (let k = 0; k < 3; k++) addTo(out, vortexSegment(P, pts[k], pts[k + 1], g, rc));
      if (this.opts.groundEffect !== false) {
        const m = (x: V3) => v3(x.x, -x.y, x.z);
        for (let k = 0; k < 3; k++) addTo(out, vortexSegment(P, m(pts[k]), m(pts[k + 1]), -g, rc));
      }
    }
    return out;
  }

  /** Записать циркуляцию несущих крыльев за этот шаг (по их подъёмной силе) — для скоса потока за ними. */
  private recordWake(wind: V3) {
    for (const p of this.parts) {
      if (!this.isMainWing(p) || !p.elements.length) continue;
      const { t: tP, q } = this.pose(p);
      const vRel = sub(this.pointVel(p.b, tP), wind);
      const V = len(vRel);
      const last = p.elements[p.elements.length - 1];
      const s = scale(rotate(q, last.r), (Math.PI / 4) / last.spanFrac); // присоединённый вихрь: корень → π/4 размаха
      const bLen = len(s);
      let g = 0;
      if (V > 1 && bLen > 1e-6) {
        // Жуковский: F = ρ·Γ·(U × s), U = −v — поток относительно крыла.
        const n = cross(scale(vRel, -1), scale(s, 1 / bLen));
        const nl = len(n);
        if (nl > 1e-6) g = dot(p.aeroForce, scale(n, 1 / nl)) / (this.rho * nl * bLen);
      }
      const h = (p.wake ??= []);
      h.push({ t: this.t, g });
      while (h.length > 2 && h[1].t < this.t - 5) h.shift();
    }
  }

  /**
   * Скорость струи несущих винтов в точке (вниз по оси винта). Струя за диском: на глубине d средняя скорость
   * vᵢ·(1 + d/√(d² + R²)) (вихревой цилиндр за равномерно нагруженным диском), сечение струи сжимается так, что расход
   * сохраняется: R_стр = R/√(1 + d/√(d² + R²)). Внутри струи скорость берётся с того кольца диска, из которого пришла
   * точка (поток по кольцам — BEMT). Над диском и вне струи — ноль. Влияние земли на струю (растекание у земли) не учтено.
   */
  rotorWakeAt(pw: V3): V3 {
    const out = v3();
    for (const r of this.rotors) {
      if (r.axisW.y < 0.3 || r.inflow <= 0) continue;
      const rel = sub(pw, this.pose(r.hub).t);
      const d = -dot(rel, r.axisW);
      if (d <= 0) continue;
      const radial = len(add(rel, scale(r.axisW, d)));
      const f = 1 + d / Math.sqrt(d * d + r.radius * r.radius);
      const rw = r.radius / Math.sqrt(f);
      if (radial >= rw) continue;
      const rDisk = radial * Math.sqrt(f);
      let vi = r.inflow;
      if (this.opts.rotorInflow === 'bemt' && r.st.length) {
        const s = r.st;
        if (rDisk <= s[0].r - s[0].dr / 2) vi = 0; // вырез у втулки: через него поток почти не идёт
        else {
          let k = s.findIndex((x) => x.r >= rDisk);
          if (k < 0) vi = s[s.length - 1].vi;
          else if (k === 0) vi = s[0].vi;
          else vi = s[k - 1].vi + ((rDisk - s[k - 1].r) / (s[k].r - s[k - 1].r)) * (s[k].vi - s[k - 1].vi);
        }
      }
      addTo(out, scale(r.axisW, -vi * f));
    }
    return out;
  }

  // ---------- положение деталей ----------

  /** Положение и оси детали в мире: сейчас (now) или на середине шага (mid). */
  pose(p: PartModel, when: 'now' | 'mid' = 'now'): { t: V3; q: Q } {
    const bt = when === 'mid' ? p.b.mid.t : copy(p.b.rb.translation());
    const bq = when === 'mid' ? p.b.mid.q : p.b.rb.rotation();
    return { t: add(bt, rotate(bq, p.offT)), q: qMul(bq, p.offQ) };
  }

  bodyCom(b: BodyModel): V3 {
    return add(copy(b.rb.translation()), rotate(b.rb.rotation(), copy(b.rb.localCom())));
  }

  private pointVel(b: BodyModel, pw: V3): V3 {
    return add(copy(b.rb.linvel()), cross(copy(b.rb.angvel()), sub(pw, this.bodyCom(b))));
  }

  // ---------- приводы ----------

  actuatorPhase(id: string): number {
    return this.phases.get(id) ?? 0;
  }

  actuatorFreq(id: string): number {
    return this.freqNow.get(id) ?? 0;
  }

  /**
   * Ускорение точки машущей лопасти от самого взмаха (сверх движения жёсткого тела): угловое β̈·(a × d), центростремительное
   * −β̇²·d⊥ и кориолисово 2·ω × (β̇·a × d). Без него в нагрузках оставалась центробежная сила отклонённой лопасти, которую
   * у настоящей уравновешивает её же ускорение при взмахе.
   */
  private flapAccAt(p: PartModel, pW: V3): V3 {
    const f = p.flap;
    if (!f || !this.flapPose(p)) return v3();
    const aW = norm(rotate(p.rotor!.hub.b.mid.q, f.axisHub));
    const d = sub(pW, this.pose(p.rotor!.hub, 'mid').t);
    const dp = sub(d, scale(aW, dot(d, aW)));
    const vt = scale(cross(aW, d), f.rate);
    return add(add(scale(cross(aW, d), f.acc), scale(dp, -f.rate * f.rate)), scale(cross(p.b.mid.w, vt), 2));
  }

  /** Взмах лопасти на середине шага: поворот вокруг оси шарнира и центр втулки (null — у детали взмаха нет). */
  private flapPose(p: PartModel): { q: Q; H: V3 } | null {
    const f = p.flap;
    if (!f || !p.rotor?.flapping || p.broken || p.rotor.blades.some((b) => b.broken)) return null;
    const aW = norm(rotate(p.rotor.hub.b.mid.q, f.axisHub));
    return { q: qAxisAngle(aW, f.beta), H: this.pose(p.rotor.hub, 'mid').t };
  }

  /** Пересоздать вращательный шарнир: с мотором (по скорости) или без него. */
  private rebuildRevolute(jm: JointModel, motor: boolean) {
    this.world.removeImpulseJoint(jm.rapier!, true);
    const rj = this.world.createImpulseJoint(this.R.JointData.revolute(jm.anchor, v3(), jm.axisParentBody), jm.parent.b.rb, jm.child.b.rb, true);
    if (motor) (rj as RAPIER_NS.RevoluteImpulseJoint).configureMotorModel(this.R.MotorModel.AccelerationBased);
    jm.rapier = rj;
    jm.motorless = !motor;
  }

  private driveActuators() {
    const dt = this.dt;
    for (const a of this.spec.actuators) {
      if (a.type === 'propeller') continue;
      const ramp = a.rampTime ?? 0;
      const x = ramp > 0 ? Math.min(1, (this.t + dt) / ramp) : 1;
      const s = x * x * (3 - 2 * x); // плавный разгон без рывка
      if (a.type === 'oscillator') {
        const f = a.freqHz * s;
        this.freqNow.set(a.id, f);
        const ph = (this.phases.get(a.id) ?? 0) + 2 * Math.PI * f * dt;
        this.phases.set(a.id, ph);
        for (const jr of a.joints) {
          const jm = this.joints.find((j) => j.spec.id === jr.joint)!;
          if (!jm.rapier || jm.child.broken) continue;
          const p = ph + ((a.phaseDeg ?? 0) + (a.groupPhase?.[jr.joint] ?? 0)) * deg;
          const amp = a.amplitudeDeg * deg;
          const angle = jr.sign * ((a.offsetDeg ?? 0) * deg + amp * Math.sin(p));
          const rate = jr.sign * amp * 2 * Math.PI * f * Math.cos(p);
          // Привод по скорости: позиционная пружина Rapier портит скорости (этап 0).
          (jm.rapier as RAPIER_NS.RevoluteImpulseJoint).configureMotor(angle, rate, 2e5, 2e4);
          jm.target = angle;
        }
      } else {
        const jm = this.joints.find((j) => j.spec.id === a.joint)!;
        const mult = a.channel ? this.channels[a.channel] ?? 1 : 1;
        const omega = a.direction * a.rpm * RAD_PER_RPM * s * mult;
        if ((a.freewheel && (this.channels[a.freewheel] ?? 0) > 0.5) || (this.tailRotorFree && a.tailRotor)) {
          // Мотор отключён: винт вращается свободно — его обороты задают воздух и инерция.
          // В свободном полёте вертолёта вал тоже без мотора Rapier: момент двигателя прикладывает applyAero (регулятор
          // оборотов с пределом мощности), а мотор шарнира Rapier держал бы обороты с любым моментом.
          // Мотор шарнира в Rapier не выключается (при нулевых коэффициентах шарнир становится жёстким), поэтому
          // шарнир вала пересоздаётся без мотора.
          if (jm.rapier && !jm.child.broken && !jm.motorless) this.rebuildRevolute(jm, false);
          const rr = this.rotors.find((x) => x.actuator === a);
          const w = Math.abs(rr?.omega ?? omega);
          this.freqNow.set(a.id, w / (2 * Math.PI));
          this.phases.set(a.id, (this.phases.get(a.id) ?? 0) + w * dt);
          continue;
        }
        if (jm.rapier && !jm.child.broken && jm.motorless) this.rebuildRevolute(jm, true);
        this.freqNow.set(a.id, Math.abs(omega) / (2 * Math.PI));
        this.phases.set(a.id, (this.phases.get(a.id) ?? 0) + Math.abs(omega) * dt);
        if (jm.rapier && !jm.child.broken) (jm.rapier as RAPIER_NS.RevoluteImpulseJoint).configureMotorVelocity(omega, 2e4);
      }
    }
  }

  // ---------- аэродинамика ----------

  /** Текущий угол установки поверхности с учётом управления и поворота крыла, рад. */
  surfaceIncidence(a: AeroSurface, spanFrac = 1, withControl = true): number {
    let inc = a.incidenceDeg * deg;
    if (a.control && withControl) inc += this.controlDeflection(a);
    if (a.feathering) {
      const f = a.feathering;
      const ph = this.actuatorPhase(f.actuator) + (f.phaseDeg ?? 0) * deg;
      // paddle — поворот «ребром» на обратном ходе (висение); sine — закручивание ±maxDeg/2
      // в фазе со скоростью взмаха (полёт вперёд). linear — угол растёт от корня к законцовке,
      // как местная скорость взмаха.
      const shape = f.mode === 'sine' ? Math.cos(ph) / 2 : (1 + Math.cos(ph)) / 2;
      const along = f.distribution === 'linear' ? spanFrac : 1;
      inc += (this.channels[f.channel] ?? 0) * f.maxDeg * deg * shape * along;
    }
    return inc;
  }

  /** Добавка к углу установки от органа управления (рад) — на участке размаха control.from…to. */
  controlDeflection(a: AeroSurface): number {
    const c = a.control;
    if (!c) return 0;
    const x = this.channels[c.channel] ?? 0;
    const k = x < 0 && c.degNeg !== undefined ? c.degNeg : c.deg;
    if (!c.chordFrac) return x * k * deg;
    // Физический угол отклонения: x·k = δ·τ (так задаётся deg), τ — по теории тонкого профиля.
    const tau = flapTau(c.chordFrac);
    const dPhys = Math.abs((x * k) / tau);
    return x * k * deg * flapViscous(c.chordFrac, a.airfoil) * flapKPrime(c.chordFrac, dPhys);
  }

  private applyAero() {
    const rho = this.rho;
    const wind = this.opts.wind;
    let maxMach = 0;
    let stalled = 0;
    let lifting = 0;

    for (const r of this.rotors) {
      r.axisW = rotate(r.hub.parent!.b.rb.rotation(), r.hub.joint!.axisParentBody);
      const hubT = this.pose(r.hub).t;
      r.omega = dot(sub(copy(r.hub.b.rb.angvel()), copy(r.hub.parent!.b.rb.angvel())), r.axisW);
      if (r.flapping) {
        // Нормаль к плоскости концов лопастей: средняя по лопастям нормаль, повёрнутая взмахом каждой
        // (качание диска наклоняет её, общая конусность — нет).
        const mast = r.axisW;
        let n = v3();
        for (const b of r.blades) {
          const f = b.flap!;
          f.aW = norm(rotate(r.hub.b.rb.rotation(), f.axisHub));
          f.H = hubT;
          f.M = 0;
          n = add(n, rotate(qAxisAngle(f.aW, f.beta), mast));
        }
        r.axisW = norm(n);
      }
      const vRel = sub(this.pointVel(r.hub.b, hubT), wind);
      const vAx = dot(vRel, r.axisW);
      const vEdge = len(sub(vRel, scale(r.axisW, vAx)));
      const A = Math.PI * r.radius * r.radius;
      // Динамический поток: индуктивная скорость устанавливается с запаздыванием
      // τ ≈ R / (2·vᵢ) (как в модели Питта — Петерса). Мгновенный пересчёт по тяге
      // прошлого шага раскачивался: тяга и поток прыгали через шаг.
      // κ — поправка на неравномерность потока по диску: идеальная импульсная теория
      // с равномерным потоком занижает индуктивную мощность; в практике винтов κ ≈ 1,15.
      const kappa = r.actuator.inducedFactor ?? 1.15;
      // Влияние земли: расстояние от втулки до земли вдоль оси (земля — плоскость y = 0). Ось почти горизонтальна
      // (воздушный винт самолёта) — отражение далеко, влияния нет.
      const zAxis = r.axisW.y > 0.3 ? hubT.y / r.axisW.y : Infinity;
      const viOge = kappa * rotorInflow(Math.max(0, r.thrust), rho, A, vAx, vEdge, r.inflow / kappa);
      r.groundFactor = this.opts.groundEffect === false ? 1 : rotorGroundFactor(zAxis, r.radius, vEdge, viOge);
      const target = viOge * r.groundFactor;
      const tau = clamp(r.radius / (2 * Math.max(target, r.inflow, 0.5)), 5 * this.dt, 0.5);
      const omega = Math.abs(dot(copy(r.hub.b.rb.angvel()), r.axisW)) + 1e-6;
      if (this.opts.rotorInflow === 'bemt' && r.st.length) {
        // Теория элемента лопасти с импульсом по кольцам (BEMT): тяга кольца dT = 2ρ·(2πr·dr)·F·vᵢ·√(V² + (v_ax + vᵢ)²),
        // F — концевые потери Прандтля: F = (2/π)·arccos(e^(−f)), f = (b/2)·(R − r)/(r·sin φ), φ — угол притекания.
        // Поток на каждом кольце свой, поэтому неравномерность по диску получается сама, без поправки κ.
        // inducedFactor (κ спецификации) здесь — дополнительный множитель к κ = 1,15 прежней модели: 1,15 — без добавки,
        // у соосной пары 1,15·κ_int — множитель κ_int (взаимное влияние винтов).
        const kExtra = (r.actuator.inducedFactor ?? 1.15) / 1.15;
        const nb = Math.max(1, r.blades.length);
        let viA = 0, aSum = 0;
        for (const s of r.st) {
          const phi = Math.atan2(Math.max(0, vAx) + s.vi, omega * s.r);
          const f = ((nb / 2) * Math.max(0, r.radius - s.r)) / (s.r * Math.max(Math.sin(phi), 1e-3));
          s.F = Math.max(0.05, (2 / Math.PI) * Math.acos(Math.min(1, Math.exp(-f))));
          const Ai = 2 * Math.PI * s.r * s.dr * s.F;
          const tgt = kExtra * rotorInflow(Math.max(0, s.dT), rho, Ai, vAx, vEdge, s.vi / kExtra) * r.groundFactor;
          const ts = clamp(r.radius / (2 * Math.max(tgt, s.vi, 0.5)), 5 * this.dt, 0.5);
          s.vi += (1 - Math.exp(-this.dt / ts)) * (tgt - s.vi);
          viA += s.vi * s.r * s.dr;
          aSum += s.r * s.dr;
          s.dT = 0;
        }
        r.inflow = aSum > 0 ? viA / aSum : 0; // средняя по площади — для отчёта и для влияния земли на следующем шаге
      } else r.inflow += (1 - Math.exp(-this.dt / tau)) * (target - r.inflow);
      const ct = Math.max(0, r.thrust) / (rho * A * (omega * r.radius) ** 2);
      r.tipLoss = 1 - Math.sqrt(2 * ct) / Math.max(1, r.blades.length);
      r.thrust = 0;
    }

    for (const b of this.bodies) {
      b.rb.resetForces(true);
      b.rb.resetTorques(true);
    }
    this.extF = v3();
    this.extM0 = v3();
    for (const p of this.parts) {
      p.aeroForce = v3();
      const { t: tP, q } = this.pose(p);
      if (!p.spec.aero) {
        if (p.spec.dragArea !== undefined && p.spec.shape && p.spec.shape.type !== 'cylinder') {
          this.bodyDrag(p, tP, q, wind, rho);
        } else if (p.spec.dragArea) {
          const cW = add(tP, rotate(q, p.com));
          const v = sub(this.pointVel(p.b, cW), wind);
          const F = scale(v, -0.5 * rho * len(v) * p.spec.dragArea);
          p.b.rb.addForceAtPoint(F, cW, true);
          this.noteForce(F, cW);
          p.aeroForce = F;
        }
        continue;
      }
      const a = p.spec.aero;
      // У отломившейся лопасти (или если отломилась другая) качания нет: лопасти уже не на общем шарнире.
      const tt = p.flap && p.rotor?.flapping && !p.broken && !p.rotor.blades.some((b) => b.broken) ? p.flap : null;
      const qb = tt ? qAxisAngle(tt.aW, tt.beta) : null; // взмах лопасти: поворот вокруг оси шарнира через центр втулки
      const eC = qb ? rotate(qb, rotate(q, p.axes.c)) : rotate(q, p.axes.c);
      const eN = qb ? rotate(qb, rotate(q, p.axes.n)) : rotate(q, p.axes.n);
      const eZ = qb ? rotate(qb, rotate(q, p.axes.z)) : rotate(q, p.axes.z);
      // Циклический шаг: азимут лопасти в осях корпуса, от хвоста по вращению.
      let cyc = 0;
      const cy = p.rotor?.actuator.cyclic;
      if (cy) {
        const sF = unrotate(p.rotor!.hub.parent!.b.rb.rotation(), rotate(q, p.axes.s));
        const psi = Math.atan2(p.rotor!.actuator.direction * sF.z, -sF.x);
        cyc = ((this.channels[cy.cos] ?? 0) * Math.cos(psi) + (this.channels[cy.sin] ?? 0) * Math.sin(psi)) * deg;
      }
      const incRoot = this.surfaceIncidence(a, 0, false) + cyc;
      const incTip = this.surfaceIncidence(a, 1, false) + cyc;
      const ctl = this.controlDeflection(a);
      const cFrom = a.control?.from ?? 0, cTo = a.control?.to ?? 1, halfEl = 0.5 / Math.max(1, p.elements.length);
      const rot = p.rotor;
      const wBody = copy(p.b.rb.angvel());
      const bemt = !!rot && this.opts.rotorInflow === 'bemt' && rot.st.length > 0;
      const washed = a.role === 'tail' && !rot; // оперение — в скосе потока от несущих крыльев
      const indUniform = rot && a.induced !== 'none' ? scale(rot.axisW, -rot.inflow) : v3();
      const hubOff = rot ? len(sub(fromArr(p.spec.position), fromArr(rot.hub.spec.position))) : 0;
      let clSum = 0;
      let qcSum = 0;
      let hSum = 0;
      for (let ei = 0; ei < p.elements.length; ei++) {
        const e = p.elements[ei];
        const pw0 = add(tP, rotate(q, e.r));
        const pw = qb ? add(tt!.H, rotate(qb, sub(pw0, tt!.H))) : pw0;
        hSum += pw.y;
        const ring = bemt && a.induced !== 'none' ? rot!.st[ei] : undefined;
        const ind = ring ? scale(rot!.axisW, -ring.vi) : indUniform;
        const vSec = tt ? add(this.pointVel(p.b, pw), scale(cross(tt.aW, sub(pw, tt.H)), tt.rate)) : this.pointVel(p.b, pw);
        const windHere = this.gustAt ? add(wind, this.gustAt(pw)) : wind;
        let u = sub(add(windHere, washed ? add(ind, this.wingWash(pw, wind)) : ind), vSec);
        if (!rot) u = add(u, this.bodyFlowAt(pw, wind));
        u = sub(u, scale(eZ, dot(u, eZ)));
        const uc = dot(u, eC);
        const un = dot(u, eN);
        const V = Math.hypot(uc, un);
        const vn = -dot(vSec, eN);
        let F = v3();
        if (V > 1e-6) {
          // Рулевая поверхность — только на своём участке размаха; элемент на границе — по доле перекрытия.
          const cover = ctl ? Math.max(0, Math.min(cTo, e.spanFrac + halfEl) - Math.max(cFrom, e.spanFrac - halfEl)) / (2 * halfEl) : 0;
          const inc = incRoot + (incTip - incRoot) * e.spanFrac + e.twist + cover * ctl;
          const aGeo = Math.atan2(un, -uc) + inc; // угол между хордой и набегающим потоком
          const aInd = a.induced === 'wing' ? (this.llOn && this.isMainWing(p) && !a.unsteady ? e.ai : p.inducedAlpha) : 0;
          let alpha = aGeo - aInd;
          let shift = 0; // на сколько эффективный угол отличается от мгновенного
          if (a.unsteady) {
            // Скос в точке ¾ хорды: к углу атаки добавляется скорость поворота сечения
            // (закручивание на взмахе и вращение самого тела вокруг размаха).
            const incRate = Number.isFinite(e.incPrev) ? (inc - e.incPrev) / this.dt : 0;
            const aQ = aGeo + (0.5 * e.chord * (incRate + dot(wBody, eZ))) / V;
            if (Number.isFinite(e.aQPrev)) wagnerStep(e.wag, wrapPi(aQ - e.aQPrev), (2 * V * this.dt) / e.chord);
            e.aQPrev = aQ;
            e.incPrev = inc;
            const aE = aQ - e.wag.x - e.wag.y;
            shift = aE - aGeo;
            alpha = aE - aInd;
          }
          const mach = V / this.soundSpeed;
          const re = (rho * V * e.chord) / this.mu;
          const c = airfoilCoeffs(a.airfoil, alpha, mach, re);
          let cl = c.cl;
          let cd0 = c.cd;
          let isStalled = c.stalled;
          if (a.unsteady) {
            const dyn = dynamicStall(a.airfoil, e.stall, c, alpha, mach, (2 * V * this.dt) / e.chord, re);
            cl = dyn.cl;
            cd0 = dyn.cd;
            isStalled = dyn.stalled;
          }
          // Концевые потери: в BEMT — через F в импульсе кольца; в прежней модели — обрезка подъёмной силы у конца.
          if (rot && !bemt && len(e.r) + hubOff > rot.tipLoss * rot.radius) cl = 0;
          const qd = 0.5 * rho * V * V;
          const d = v3((uc * eC.x + un * eN.x) / V, (uc * eC.y + un * eN.y) / V, (uc * eC.z + un * eN.z) / V);
          const L = norm(cross(d, eZ));
          // Скос потока за крылом наклоняет подъёмную силу назад — индуктивное сопротивление.
          const cd = cd0 + cl * aInd;
          e.gam = 0.5 * V * e.chord * cl; // циркуляция сечения (Жуковский: L' = ρ·V·Γ)
          // Подъёмная сила перпендикулярна эффективному потоку. Когда она отстаёт от угла атаки,
          // эффективный поток повёрнут относительно мгновенного на shift — сила наклонена назад,
          // и тяга взмаха меньше, чем в установившемся обтекании (теория Гаррика).
          const Ldir = shift ? add(scale(L, Math.cos(shift)), scale(d, -Math.sin(shift))) : L;
          F = scale(add(scale(Ldir, cl), scale(d, cd)), qd * e.chord * e.dr);
          // У оторвавшейся детали присоединённая масса не считается: сила берётся по ускорению с прошлого
          // шага, а у лёгкого обломка масса вовлечённого воздуха больше его собственной — расчёт расходится.
          if (a.unsteady && a.addedMass && !p.broken) {
            // Присоединённая масса: сила по нормали к хорде, пропорциональная ускорению воздуха
            // относительно сечения поперёк хорды — и от взмаха, и от поворота сечения в потоке.
            const wn = V * Math.sin(aGeo);
            if (Number.isFinite(e.wnPrev)) {
              const nHat = add(scale(L, Math.cos(aGeo)), scale(d, Math.sin(aGeo)));
              F = add(F, scale(nHat, ((rho * Math.PI * e.chord * e.chord) / 4) * e.dr * ((wn - e.wnPrev) / this.dt)));
            }
            e.wnPrev = wn;
          }
          e.alpha = alpha;
          e.stalled = isStalled;
          e.mach = mach;
          if (!p.broken) maxMach = Math.max(maxMach, mach); // обломки не в счёт
          if (p.spec.kind === 'wing' || p.spec.kind === 'blade') {
            lifting++;
            if (isStalled) stalled++;
          }
          clSum += cl * qd * e.chord * e.dr;
          qcSum += qd * e.chord * e.dr;
        }
        if (a.addedMass && !a.unsteady && !p.broken && Number.isFinite(e.vnPrev)) {
          // Присоединённая масса воздуха: сила против ускорения сечения по нормали.
          const an = (vn - e.vnPrev) / this.dt;
          F = add(F, scale(eN, ((rho * Math.PI * e.chord * e.chord) / 4) * e.dr * an));
        }
        e.vnPrev = vn;
        e.dF = F;
        e.fLoc = unrotate(p.b.rb.rotation(), F);
        if (ring) ring.dT += dot(F, rot!.axisW);
        addTo(p.aeroForce, F);
        p.b.rb.addForceAtPoint(F, pw, true);
        this.noteForce(F, pw);
        if (tt) tt.M += dot(cross(sub(pw, tt.H), F), tt.aW);
      }
      if (a.induced === 'wing' && qcSum > 0) {
        const AR = a.aspectRatio ?? (2 * a.span * a.span) / surfaceArea(a);
        // Влияние земли: высота — средняя по размаху высота сечений, размах — полный (по удлинению и площади пары крыльев).
        const b = Math.sqrt(AR * 2 * surfaceArea(a));
        p.groundFactor = this.opts.groundEffect === false ? 1 : wingGroundFactor(hSum / Math.max(1, p.elements.length), b);
        p.inducedAlpha += 0.3 * ((clSum / qcSum / (Math.PI * SPAN_EFF * AR)) * p.groundFactor - p.inducedAlpha);
      }
      if (rot) rot.thrust += dot(p.aeroForce, rot.axisW);
    }

    this.liftingLine(wind);
    if (this.tailRotorFree) this.applyTailRotors(wind);
    this.recordWake(wind);

    // Лопасти на шарнирах взмаха: момент воздуха и тяжести вокруг оси шарнира на втулку не передаётся — он машет лопастью.
    // Iβ·β̈ = M − Iβ·Ω²·(β₀ + β): центробежная сила возвращает лопасть с собственной частотой ровно 1 раз за оборот
    // (шарнир на оси вращения); β₀ — построенная конусность. Лопасти — жёсткие тела Rapier без взмаха: взмах наложен на
    // положение и скорость сечений в аэродинамике и в нагрузках, а момент вокруг шарнира снимается с тела лопасти.
    // В общем виде: Iβ·β̈ = M + M_тяж − Σ m·(d × (ω̇ × d + ω × (ω × d)))·ê, ω — угловая скорость втулки вместе с корпусом,
    // d — сечение лопасти от центра втулки (с взмахом). При одном вращении винта это прежнее −Iβ·Ω²·(β₀ + β), а с вращением
    // корпуса появляются гироскопические 2Ω·(p, q) и инерционные (ṗ, q̇) моменты: диск отстаёт от поворота вала — так
    // несущий винт демпфирует корпус.
    const gW = v3(0, this.opts.gravity ? -this.g : 0, 0);
    for (const r of this.rotors) {
      if (!r.flapping || r.hub.broken || r.blades.some((b) => b.broken)) continue;
      // Угловая скорость втулки — из «чистых» составляющих: вращение винта вокруг вала плюс вращение корпуса. Угловая
      // скорость тела втулки в Rapier содержит ещё дрожание шарнира поперёк вала (решатель), а умноженное на Ω оно
      // раскачивало бы взмах дважды за оборот.
      const wF = copy(r.hub.parent!.b.rb.angvel());
      const wH = add(wF, scale(norm(rotate(r.hub.parent!.b.rb.rotation(), r.hub.joint!.axisParentBody)), r.omega));
      const wPrev = this.hubWPrev.get(r) ?? wF;
      const wDot = scale(sub(wF, wPrev), 1 / this.dt);
      this.hubWPrev.set(r, wF);
      for (const b of r.blades) {
        const f = b.flap!;
        const { t: tB, q: qB } = this.pose(b);
        const qf = qAxisAngle(f.aW, f.beta);
        // Тяжесть и ускорение втулки: в осях втулки на лопасть действует g − a_втулки (в манёвре с перегрузкой лопасти
        // поднимаются, как от большей тяжести). На жёсткое тело лопасти тяжесть Rapier прикладывает сам — её момент
        // вокруг шарнира снимается, как и раньше.
        const aH = r.hub.b.acc ?? v3();
        // Инерционные моменты вокруг шарнира — по сечениям, как и нагрузки: a = ω̇ × d + ω × (ω × d) для точки d
        // (от центра втулки), вынос корня, построенная конусность и повороты корпуса учитываются сами.
        const inert = (d: V3) => add(cross(wDot, d), cross(wH, cross(wH, d)));
        let Mg = 0, MgRigid = 0, MiFlap = 0, MiRigid = 0;
        for (const e of b.elements) {
          const dR = sub(add(tB, rotate(qB, e.r)), f.H);
          const dF = rotate(qf, dR);
          Mg += dot(cross(dF, scale(sub(gW, aH), e.mass)), f.aW);
          MgRigid += dot(cross(dR, scale(gW, e.mass)), f.aW);
          MiFlap += e.mass * dot(cross(dF, inert(dF)), f.aW);
          MiRigid += e.mass * dot(cross(dR, add(inert(dR), aH)), f.aW);
        }
        // Шарнир не передаёт втулке момента вокруг своей оси. Жёсткое тело лопасти Rapier ведёт вместе с втулкой, и момент,
        // нужный для этого (инерция при поворотах корпуса — гироскопический, и ускорение втулки), шёл бы в корпус через
        // соединение: у винта с моментом импульса около 7000 кг·м²/с это сотни Н·м на каждые 0,1 рад/с тангажа — ложная
        // перекрёстная связь тангажа и крена. Этот момент прикладывается к лопасти снаружи; сам взмах считает его
        // уравнение ниже.
        const Mt = scale(f.aW, -(f.M + MgRigid) + MiRigid);
        b.b.rb.addTorque(Mt, true);
        addTo(this.extM0, Mt);
        f.acc = (f.M + Mg - MiFlap) / f.Ib;
        f.rate += this.dt * f.acc;
        f.beta += this.dt * f.rate;
      }
    }
    for (const r of this.rotors) {
      // Привод хвостового винта на авторотации — от несущего: его профильная мощность тормозит винт.
      const fw = r.actuator.freewheel && (this.channels[r.actuator.freewheel] ?? 0) > 0.5;
      const tc = this.tailCache.get(r.actuator.id);
      const free = this.tailRotorFree && !!r.actuator.tailRotor;
      if ((fw || free) && tc && Math.abs(r.omega) > 1) {
        const Qb = scale(r.axisW, -Math.sign(r.omega) * tc.power / Math.abs(r.omega));
        r.hub.b.rb.addTorque(Qb, true);
        r.hub.parent!.b.rb.addTorque(scale(Qb, -1), true);
      }
      // Двигатель в свободном полёте: регулятор держит номинальные обороты (у R22 — 104 %), момент не больше, чем дают
      // располагаемая мощность за вычетом потерь в трансмиссии на этих оборотах. Мощности не хватает — обороты падают.
      if (free) {
        const a = r.actuator;
        const mastW = norm(rotate(r.hub.parent!.b.rb.rotation(), r.hub.joint!.axisParentBody));
        const ramp = a.rampTime ?? 0;
        const x = ramp > 0 ? Math.min(1, this.t / ramp) : 1;
        const omT = a.rpm * RAD_PER_RPM * x * x * (3 - 2 * x);
        const om = Math.abs(r.omega);
        let Q = 0;
        if (!fw) {
          // Инерция винта вокруг вала — для коэффициентов регулятора (постоянная времени около 0,2 с).
          const Ir = this.rotorInertia(r);
          const e = omT - om;
          this.govI = clamp(this.govI + (Ir / 0.5) * e * this.dt, 0, 1e9);
          const Qmax = (this.powerAvailable / (1 + (this.spec.powerplant.losses ?? 0))) / Math.max(om, 0.3 * a.rpm * RAD_PER_RPM);
          Q = clamp((Ir / 0.2) * e + this.govI, 0, Qmax);
          if (Q >= Qmax) this.govI = Math.min(this.govI, Qmax); // без накопления на пределе
        } else this.govI = 0;
        const Qe = scale(mastW, Q * a.direction);
        r.hub.b.rb.addTorque(Qe, true);
        r.hub.parent!.b.rb.addTorque(scale(Qe, -1), true);
        this.enginePower = Q * om;
      }
    }

    let propPower = 0;
    let propRpm = 0;
    let propEta = 0;
    let firstFixed = true;
    for (const a of this.spec.actuators) {
      if (a.type !== 'propeller') continue;
      const p = this.partById.get(a.part)!;
      if (p.broken) continue;
      const thr = Math.min(1, Math.max(0, this.channels[a.channel] ?? 0));
      const { t: tP, q } = this.pose(p);
      const axis = rotate(q, fromArr(a.axis));
      const V = Math.max(0, dot(sub(this.pointVel(p.b, tP), wind), axis));
      let T: number;
      let Qreact = 0; // момент мотора на валу, Н·м
      if (a.fixedPitch) {
        // Винт фиксированного шага: обороты — переменная состояния, I·dΩ/dt = Q_мотора − Q_винта.
        // Момент мотора на полном газе постоянный (мощность ∝ оборотам), газ — доля этого момента
        // (дроссель снижает давление во впуске, а момент ему пропорционален). Число Маха на конце лопасти
        // считается по местной скорости звука.
        const fp = a.fixedPitch;
        const wRated = (this.spec.powerplant.ratedRpm ?? 2700) * RAD_PER_RPM;
        const wMin = 0.05 * wRated; // ниже не опускается: модель не останавливает винт
        const om = this.propOmega.get(a.id) ?? wMin;
        const Qe = (thr * (a.powerShare ?? 1) * this.powerAvailable) / wRated;
        const L = propellerLoads({ ...fp, radius: a.diameter / 2 }, V, om, rho, this.soundSpeed);
        const omNext = Math.max(wMin, om + (this.dt * (Qe - L.torque)) / fp.inertia);
        this.propOmega.set(a.id, omNext);
        T = L.thrust;
        Qreact = Qe;
        const P = Qe * om;
        propPower += P;
        if (firstFixed) {
          propRpm = om / RAD_PER_RPM;
          propEta = P > 0 ? (T * V) / P : 0;
          firstFixed = false;
        }
      } else {
        const P = thr * (a.powerShare ?? 1) * this.powerAvailable;
        propPower += P;
        if (P <= 0) continue;
        Qreact = P / ((this.spec.powerplant.ratedRpm ?? 2700) * RAD_PER_RPM);
        const A = (Math.PI * a.diameter * a.diameter) / 4;
        // Импульсная теория диска: η·P = T·(V + vᵢ), T = 2ρA·(V + vᵢ)·vᵢ.
        // На месте даёт статическую тягу, на скорости — КПД около η·(идеальный КПД).
        const Pe = a.efficiency * P;
        let vi = Math.cbrt(Pe / (2 * rho * A));
        for (let k = 0; k < 30; k++) {
          const f = 2 * rho * A * (V + vi) ** 2 * vi - Pe;
          const df = 2 * rho * A * ((V + vi) ** 2 + 2 * (V + vi) * vi);
          const next = Math.max(1e-6, vi - f / df);
          if (Math.abs(next - vi) < 1e-9) break;
          vi = next;
        }
        T = 2 * rho * A * (V + vi) * vi;
      }
      const F = scale(axis, T);
      p.b.rb.addForceAtPoint(F, tP, true);
      this.noteForce(F, tP);
      if (a.spin && Qreact) {
        // Мотор крутит винт моментом Q и сам с тем же моментом упирается в корпус в обратную сторону.
        const M = scale(axis, -a.spin * Qreact);
        p.b.rb.addTorque(M, true);
        addTo(this.extM0, M);
      }
      addTo(p.aeroForce, F);
    }
    this.sample.propRpm = propRpm;
    this.sample.propEfficiency = propEta;
    this.sample.propPower = propPower;
    this.sample.maxMach = maxMach;
    this.sample.stalledFrac = lifting ? stalled / lifting : 0;
  }

  // ---------- нагрузки и прочность ----------

  private kinematics() {
    const dt = this.dt;
    for (const b of this.bodies) {
      const v = copy(b.rb.linvel());
      const w = copy(b.rb.angvel());
      const t = copy(b.rb.translation());
      const q = b.rb.rotation();
      const lc = copy(b.rb.localCom());
      if (b.prevV && b.prevW && b.prevT && b.prevQ) {
        b.acc = scale(sub(v, b.prevV), 1 / dt);
        b.angAcc = scale(sub(w, b.prevW), 1 / dt);
        const s = b.prevQ.x * q.x + b.prevQ.y * q.y + b.prevQ.z * q.z + b.prevQ.w * q.w < 0 ? -1 : 1;
        const qm = { x: b.prevQ.x + s * q.x, y: b.prevQ.y + s * q.y, z: b.prevQ.z + s * q.z, w: b.prevQ.w + s * q.w };
        const ql = Math.hypot(qm.x, qm.y, qm.z, qm.w);
        const mq = { x: qm.x / ql, y: qm.y / ql, z: qm.z / ql, w: qm.w / ql };
        const mt = scale(add(t, b.prevT), 0.5);
        b.mid = { t: mt, q: mq, w: scale(add(w, b.prevW), 0.5), c: add(mt, rotate(mq, lc)) };
      } else b.mid = { t, q: { x: q.x, y: q.y, z: q.z, w: q.w }, w, c: add(t, rotate(q, lc)) };
      b.prevV = v;
      b.prevW = w;
      b.prevT = t;
      b.prevQ = { x: q.x, y: q.y, z: q.z, w: q.w };
    }
    for (const p of this.parts) {
      const { t, q } = this.pose(p, 'mid');
      const fl = this.flapPose(p);
      for (const e of p.elements) {
        e.pR = add(t, rotate(q, e.r));
        e.pW = fl ? add(fl.H, rotate(fl.q, sub(e.pR, fl.H))) : e.pR;
        e.dFm = rotate(p.b.mid.q, e.fLoc);
      }
    }
  }

  /** Ускорение точки тела в мире (поле скоростей твёрдого тела). */
  private accAt(b: BodyModel, pw: V3): V3 {
    const d = sub(pw, b.mid.c);
    return add(add(b.acc, cross(b.angAcc, d)), cross(b.mid.w, cross(b.mid.w, d)));
  }

  /** Сила и момент (относительно o), которые нужно передать поддереву p, чтобы оно двигалось так, как двигается. */
  private subtree(p: PartModel, o: V3, gVec: V3): { F: V3; M: V3 } {
    const F = v3();
    const M = v3();
    if (p.elements.length) {
      for (const e of p.elements) {
        // Нагрузка на шарнир — как её видит жёсткое тело Rapier: инерция и тяжесть — в точке тела, силы воздуха — там,
        // где они приложены (у машущей лопасти — в отклонённой точке).
        const Gi = scale(sub(this.accAt(p.b, e.pR), gVec), e.mass);
        addTo(F, sub(Gi, e.dFm));
        addTo(M, sub(cross(sub(e.pR, o), Gi), cross(sub(e.pW, o), e.dFm)));
      }
    } else {
      const { t, q } = this.pose(p, 'mid');
      const cW = add(t, rotate(q, p.com));
      const G = sub(scale(sub(this.accAt(p.b, cW), gVec), p.mass), p.aeroForce);
      addTo(F, G);
      addTo(M, cross(sub(cW, o), G));
      const Iw = (x: V3) => {
        const l = unrotate(q, x);
        return rotate(q, v3(l.x * p.inertia.x, l.y * p.inertia.y, l.z * p.inertia.z));
      };
      addTo(M, add(Iw(p.b.angAcc), cross(p.b.mid.w, Iw(p.b.mid.w))));
    }
    for (const ch of p.children) {
      if (ch.broken) continue;
      const jp = this.pose(ch, 'mid').t;
      const s = this.subtree(ch, jp, gVec);
      addTo(F, s.F);
      addTo(M, add(s.M, cross(sub(jp, o), s.F)));
    }
    return { F, M };
  }

  private measure() {
    const gVec = v3(0, this.opts.gravity ? -this.g : 0, 0);
    this.kinematics();

    let shaft = 0;

    let shaftNet = 0;
    let lag = 0;
    for (const j of this.joints) {
      if (j.child.broken) continue;
      const o = this.pose(j.child, 'mid').t;
      const s = this.subtree(j.child, o, gVec);
      j.force = s.F;
      j.moment = s.M;
      if (!j.welded) {
        const axisW = rotate(j.parent.b.mid.q, j.axisParentBody);
        const wRel = dot(sub(j.child.b.mid.w, j.parent.b.mid.w), axisW);
        j.shaftPower = dot(s.M, axisW) * wRel;
        // Раньше здесь была сумма модулей: торможение крыла считалось такой же затратой, как разгон,
        // и мощность инерционных взмахов завышалась вдвое. Привод, который тормозит деталь,
        // энергию не тратит — он её рассеивает или возвращает.
        // У несущего винта момент на валу пульсирует (кориолисовы силы машущих лопастей — дважды за оборот, в среднем ноль):
        // мотор держит обороты, а пульсации гасит инерция винта. Поэтому его мощность — со знаком.
        const spun = this.rotors.some((r) => r.hub.joint === j);
        shaft += spun ? j.shaftPower : Math.max(0, j.shaftPower);
        shaftNet += j.shaftPower;
        if (this.spec.actuators.some((a) => a.type === 'oscillator' && a.joints.some((x) => x.joint === j.spec.id))) {
          const qr = qMul(qConj(j.parent.b.rb.rotation()), j.child.b.rb.rotation());
          const ax = j.axisParentBody;
          const ang = 2 * Math.atan2(qr.x * ax.x + qr.y * ax.y + qr.z * ax.z, qr.w);
          lag = Math.max(lag, Math.abs(wrapPi(ang - j.target)));
        }
      }
    }
    // Хвостовые винты: тяга = момент на валу несущего винта / плечо; мощность — BEMT (tailrotor.ts).
    // Считается раз в 0,05 с (подбор шага — десятки итераций), между пересчётами держится.
    let tail = 0;
    for (const a of this.spec.actuators) {
      if (a.type !== 'spinner' || !a.tailRotor) continue;
      const j = this.joints.find((x) => x.spec.id === a.joint);
      if (!j || j.child.broken) continue;
      const omNom = a.rpm * RAD_PER_RPM;
      const rr = this.rotors.find((x) => x.actuator === a);
      const om = rr && Math.abs(rr.omega) > 1 ? Math.abs(rr.omega) : omNom * (a.channel ? this.channels[a.channel] ?? 1 : 1);
      // Момент на валу — сглаженный (0,5 с): мгновенный пульсирует дважды за оборот.
      const Pf = (this.shaftLp.get(a.id) ?? j.shaftPower) + (1 - Math.exp(-this.dt / 0.5)) * (j.shaftPower - (this.shaftLp.get(a.id) ?? j.shaftPower));
      this.shaftLp.set(a.id, Pf);
      const Q = Math.max(0, Pf) / Math.max(om, 1e-6);
      const key = a.id;
      const cache = this.tailCache.get(key);
      const freewheel = !!a.freewheel && (this.channels[a.freewheel] ?? 0) > 0.5;
      if (!this.tailRotorFree && (!cache || this.t - cache.t >= 0.05)) {
        const res = tailRotorPower(a.tailRotor, Q / a.tailRotor.arm, this.rho, this.soundSpeed, om / omNom, this.mu);
        this.tailCache.set(key, { t: this.t, power: res.power, thetaDeg: res.thetaDeg, thrust: Q / a.tailRotor.arm });
      }
      if (!freewheel) tail += this.tailCache.get(key)?.power ?? 0; // на авторотации хвостовой винт крутит несущий (см. applyAero)
    }
    if (this.tailRotorFree && this.spec.actuators.some((a) => a.type === 'spinner' && a.tailRotor)) {
      // Свободный полёт вертолёта: на валу — момент двигателя (хвостовой винт в нём уже есть: он нагружает несущий).
      const tr = this.spec.actuators.find((a) => a.type === 'spinner' && a.tailRotor);
      tail = this.tailCache.get(tr!.id)?.power ?? 0;
      shaft = this.enginePower;
      shaftNet = this.enginePower;
    } else {
      shaft += tail;
      shaftNet += tail;
    }
    this.sample.tailRotorPower = tail;
    this.sample.shaftPower = shaft;
    this.sample.shaftPowerNet = shaftNet;
    this.sample.actuatorLagDeg = lag / deg;

    let minMargin = Infinity;
    let minPart = '';
    let minMode: FailureMode = 'none';
    let minSpan = 0;
    let minYield = Infinity;
    const toBreak: [PartModel, PartModel['worst']][] = [];
    const fMain = this.spec.actuators.reduce((m, a) => (a.type === 'oscillator' ? Math.max(m, a.freqHz) : a.type === 'spinner' ? Math.max(m, a.rpm / 60) : m), 0);
    const kLoad = 1 - Math.exp(-2 * Math.PI * Math.max(30, 5 * fMain) * this.dt);
    for (const p of this.parts) {
      if (p.broken || !p.material || !p.elements.length || !p.spec.aero) continue;
      const { t: tP, q } = this.pose(p, 'mid');
      // Нагрузки — в осях балки: у лопасти с конусностью центробежная сила частично снимает срез от тяги.
      // У машущей лопасти оси и станции повёрнуты взмахом.
      const fl = this.flapPose(p);
      const fq = (v: V3) => (fl ? rotate(fl.q, v) : v);
      const fp = (x: V3) => (fl ? add(fl.H, rotate(fl.q, sub(x, fl.H))) : x);
      const eC = fq(rotate(q, p.axes.c));
      const eN = fq(rotate(q, p.axes.n));
      const eS = fq(rotate(q, p.axes.s));
      const kids = p.children.filter((k) => !k.broken).map((k) => {
        const at = this.pose(k, 'mid').t;
        return { at, s: this.subtree(k, at, gVec) };
      });
      const n = p.elements.length;
      // Демпфирование изгиба воздухом — по текущей скорости (у крыла самолёта в полёте ζ ≈ 0,1–0,2, без него
      // крыло после каждого движения руля звенело бы на первой форме с ζ = 0,03).
      let zFlap = p.elastic?.zeta ?? STRUCTURAL_DAMPING;
      const el0 = p.elastic;
      if (el0?.cAU && el0.mModal) {
        const U = Math.max(len(this.opts.wind), this.sample.airspeed);
        const w1 = 2 * Math.PI * el0.f1;
        const F = U > 0 ? theodorsen((w1 * (el0.chord ?? 1)) / (2 * U)).F : 1;
        zFlap = Math.min(1, STRUCTURAL_DAMPING + (el0.cAU * U * F) / (2 * el0.mModal * w1));
      }
      const G = p.elements.map((e) => sub(scale(sub(add(this.accAt(p.b, e.pW), this.flapAccAt(p, e.pW)), gVec), e.mass), e.dFm));
      let worst = { margin: Infinity, mode: 'none' as FailureMode, spanFrac: 0, yieldMargin: Infinity };
      // Накопление от законцовки к корню: F_i = F_{i+1} + G_i,
      // M_i = M_{i+1} + (s_{i+1} − s_i) × F_{i+1} + (p_i − s_i) × G_i.
      const accF = v3();
      const accM = v3();
      let prevS: ReturnType<typeof v3> | null = null;
      for (let i = n - 1; i >= 0; i--) {
        const e = p.elements[i];
        const sw = fp(add(tP, rotate(q, e.innerR)));
        if (prevS) addTo(accM, cross(sub(prevS, sw), accF));
        addTo(accM, cross(sub(e.pW, sw), G[i]));
        addTo(accF, G[i]);
        prevS = sw;
        if (!e.section) continue;
        const st = p.stations[i];
        const F = { ...accF };
        const M = { ...accM };
        for (const kd of kids) {
          addTo(F, kd.s.F);
          addTo(M, add(kd.s.M, cross(sub(kd.at, sw), kd.s.F)));
        }
        // Конструкция не успевает отозваться на импульс короче своего периода: жёсткий
        // контакт с землёй даёт пик в один шаг (артефакт модели без амортизации).
        // Поэтому нагрузки сглаживаются до частоты, в 5 раз выше главного привода (не ниже 30 Гц):
        // нагрузки от взмахов и оборотов проходят почти без потерь (около 2 %).
        const raw = [-dot(F, eS), dot(M, eC), dot(M, eN), dot(M, eS), dot(F, eN), dot(F, eC)];
        if (!st.lp) st.lp = raw;
        else for (let k = 0; k < 6; k++) st.lp[k] += kLoad * (raw[k] - st.lp[k]);
        // Упругость: изгиб и срез проходят через колебательное звено первой формы
        // x'' + 2ζω₁x' + ω₁²x = ω₁²·u (u — нагрузка жёсткого крыла). Медленные изменения
        // проходят как есть, вблизи резонанса раскачка растёт. Выше резонанса звено даёт
        // меньше, чем жёсткая модель, — берём большее из двух (жёсткая модель там и так
        // неприменима, об этом предупреждение в вердикте).
        // Изгиб взмаха и срез по нормали — через первую форму взмаха; изгиб и срез в плоскости крыла —
        // через свою форму (жёстче, без воздуха). Раньше обе шли через форму взмаха.
        let L = st.lp;
        const el = p.elastic;
        if (el) {
          if (!st.dyn) st.dyn = { x: [...st.lp], v: [0, 0, 0, 0, 0, 0] };
          const d = st.dyn;
          L = st.lp.map((u, k) => {
            if (k === 0 || k === 3) return u;
            const lag = k === 2 || k === 5;
            const w = 2 * Math.PI * (lag ? el.fLag : el.f1);
            if (w * this.dt >= 0.5) return u;
            const z = lag ? STRUCTURAL_DAMPING : zFlap;
            d.v[k] += this.dt * (w * w * (u - d.x[k]) - 2 * z * w * d.v[k]);
            d.x[k] += this.dt * d.v[k];
            return Math.abs(d.x[k]) > Math.abs(u) ? d.x[k] : u;
          });
        }
        const res = stationStress(e.section, p.material, {
          tension: L[0], mFlap: L[1], mLag: L[2], torsion: L[3], vNormal: L[4], vChord: L[5],
        });
        Object.assign(st, res);
        res.corners.forEach((x, k) => {
          st.cycleMax[k] = Math.max(st.cycleMax[k] ?? -Infinity, x);
          st.cycleMin[k] = Math.min(st.cycleMin[k] ?? Infinity, x);
        });
        if (res.margin < worst.margin) worst = { margin: res.margin, mode: res.mode, spanFrac: st.spanFrac, yieldMargin: worst.yieldMargin };
        worst.yieldMargin = Math.min(worst.yieldMargin, res.yieldMargin);
      }
      p.worst = worst;
      if (worst.margin < minMargin) {
        minMargin = worst.margin;
        minPart = p.spec.id;
        minMode = worst.mode;
        minSpan = worst.spanFrac;
      }
      minYield = Math.min(minYield, worst.yieldMargin);
      if (this.opts.breakable && worst.margin < 1 && this.steps > 3) toBreak.push([p, worst]);
    }
    for (const [p, w] of toBreak) if (!p.broken) this.breakPart(p, w);
    Object.assign(this.sample, { minMargin, minMarginPart: minPart, minMarginMode: minMode, minMarginSpan: minSpan, minYieldMargin: minYield });
  }

  private breakPart(p: PartModel, w: PartModel['worst']) {
    const j = p.joint;
    if (j?.rapier) {
      this.world.removeImpulseJoint(j.rapier, true);
      j.rapier = null;
    } else if (j?.welded) this.detach(p);
    const mark = (x: PartModel) => {
      x.broken = true;
      x.collider.setCollisionGroups(0x0001ffff);
      for (const c of x.children) {
        if (c.joint?.rapier) {
          this.world.removeImpulseJoint(c.joint.rapier, true);
          c.joint.rapier = null;
        }
        mark(c);
      }
    };
    mark(p);
    this.events.push({ t: this.t, part: p.spec.id, spanFrac: w.spanFrac, mode: w.mode, margin: w.margin });
  }

  /** Отделить приваренную деталь (и приваренное к ней) в отдельное тело. */
  private detach(p: PartModel) {
    const old = p.b;
    const group: PartModel[] = [];
    const collect = (x: PartModel) => {
      group.push(x);
      for (const c of x.children) if (c.joint?.welded && c.b === old) collect(c);
    };
    collect(p);
    const { t: pT, q: pQ } = this.pose(p);
    const comOld = this.bodyCom(old);
    const vOld = copy(old.rb.linvel());
    const wOld = copy(old.rb.angvel());
    const nb = this.newBody(pT, pQ);
    for (const g of group) {
      const { t, q } = this.pose(g);
      this.world.removeCollider(g.collider, true);
      old.parts.splice(old.parts.indexOf(g), 1);
      g.b = nb;
      g.offT = unrotate(pQ, sub(t, pT));
      g.offQ = qMul(qConj(pQ), q);
      g.broken = true;
      const shape = this.massModel(g.spec).shape;
      this.attachCollider(g, shape);
      nb.parts.push(g);
    }
    this.setBodyMass(old);
    this.setBodyMass(nb);
    const comNew = this.bodyCom(nb);
    const v = add(vOld, cross(wOld, sub(comNew, comOld)));
    nb.rb.setLinvel(v, true);
    nb.rb.setAngvel(wOld, true);
  }

  closeCycle() {
    for (const p of this.parts)
      for (const s of p.stations) {
        if (s.cycleMax.length) s.lastCycle = { max: s.cycleMax, min: s.cycleMin };
        s.cycleMax = [];
        s.cycleMin = [];
      }
  }

  /** Ресурс по усталости, часы: худшая станция за последний цикл. NaN — нет данных об усталости. */
  fatigueLife(cycleHz: number): { hours: number; part: string; spanFrac: number; noData: string[] } {
    let best = { hours: Infinity, part: '', spanFrac: 0 };
    const noData = new Set<string>();
    for (const p of this.parts) {
      if (!p.material || p.broken) continue;
      if (!p.material.fatigue) {
        noData.add(p.material.name);
        continue;
      }
      for (const s of p.stations) {
        if (!s.lastCycle) continue;
        // Худший угол: у растянутой в среднем полки ресурс меньше, чем у сжатой.
        let n = Infinity;
        for (let k = 0; k < s.lastCycle.max.length; k++) n = Math.min(n, fatigueCycles(p.material, s.lastCycle.max[k], s.lastCycle.min[k]));
        const hours = n / Math.max(cycleHz, 1e-9) / 3600;
        if (hours < best.hours) best = { hours, part: p.spec.id, spanFrac: s.spanFrac };
      }
    }
    return { ...best, noData: [...noData] };
  }

  private crew() {
    const p = this.partById.get(this.spec.crew.part);
    if (!p) return;
    const { t, q } = this.pose(p);
    const gVec = v3(0, this.opts.gravity ? -this.g : 0, 0);
    const vs = this.spec.crew.seats.map((s) => this.pointVel(p.b, add(t, rotate(q, fromArr(s)))));
    let worst = 0;
    let vec = v3();
    if (this.prevSeatV) {
      vs.forEach((v, i) => {
        const a = sub(scale(sub(v, this.prevSeatV![i]), 1 / this.dt), gVec);
        if (len(a) / this.g >= worst) {
          worst = len(a) / this.g;
          vec = unrotate(q, a); // в осях корпуса — для вибрации по трём осям
        }
      });
    }
    this.prevSeatV = vs;
    this.sample.crewAccel = worst;
    this.sample.crewAccelVec = vec;
  }

  step() {
    this.driveActuators();
    if (this.opts.aero) this.applyAero();
    else {
      for (const b of this.bodies) {
        b.rb.resetForces(true);
        b.rb.resetTorques(true);
      }
      for (const p of this.parts) for (const e of p.elements) {
        e.dF = v3();
        e.fLoc = v3();
      }
      this.extF = v3();
      this.extM0 = v3();
    }
    // Момент, которым фиксатор держит корпус: изменение момента импульса всей системы за шаг минус момент
    // внешних сил (воздух, тяжесть) — относительно одной и той же неподвижной точки.
    let hold: { o: V3; H0: V3; Mext: V3 } | null = null;
    if (this.measureHold) {
      const o = this.bodyCom(this.root.b);
      const gVec = v3(0, this.opts.gravity ? -this.g : 0, 0);
      const Mext = sub(this.extM0, cross(o, this.extF));
      for (const b of this.bodies) addTo(Mext, cross(sub(this.bodyCom(b), o), scale(gVec, b.rb.mass())));
      hold = { o, H0: this.angularMomentum(o), Mext };
    }
    this.world.step();
    if (hold) this.holdTorque = sub(scale(sub(this.angularMomentum(hold.o), hold.H0), 1 / this.dt), hold.Mext);
    this.t += this.dt;
    this.steps++;
    this.measure();
    this.crew();
    const rb = this.root.b.rb;
    const v = sub(copy(rb.linvel()), this.opts.wind);
    const q = rb.rotation();
    const aeroTotal = v3();
    for (const p of this.parts) if (!p.broken) addTo(aeroTotal, p.aeroForce);
    const alphas = this.parts.filter((p) => p.spec.kind === 'wing' && !p.broken).flatMap((p) => p.elements.map((e) => e.alpha));
    const bx = rotate(q, v3(1, 0, 0)), by = rotate(q, v3(0, 1, 0)), bz = rotate(q, v3(0, 0, 1));
    Object.assign(this.sample, {
      t: this.t,
      altitude: rb.translation().y,
      airspeed: len(v),
      vz: rb.linvel().y,
      // Тангаж: при повороте только вокруг z (плоское движение) — полный угол до ±180°; в пространстве — углы Эйлера.
      pitchDeg: (Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9 ? 2 * Math.atan2(q.z, q.w) : Math.atan2(bx.y, Math.hypot(bx.x, bx.z))) / deg,
      rollDeg: Math.atan2(-bz.y, by.y) / deg,
      headingDeg: Math.atan2(bx.z, bx.x) / deg,
      betaDeg: len(v) > 0.1 ? Math.asin(Math.max(-1, Math.min(1, dot(v, bz) / len(v)))) / deg : 0,
      aeroForce: aeroTotal,
      liftToWeight: aeroTotal.y / (this.totalMass * this.g),
      loadFactor: dot(aeroTotal, rotate(q, v3(0, 1, 0))) / (this.totalMass * this.g),
      power: this.sample.shaftPower * (1 + (this.spec.powerplant.losses ?? 0)) + this.sample.propPower,
      powerRecovered: this.sample.shaftPowerNet * (1 + (this.spec.powerplant.losses ?? 0)) + this.sample.propPower,
      powerAvailable: this.powerAvailable,
      fuelFlow: this.spec.powerplant.engine ? fuelFlow(this.spec.powerplant.engine, Math.max(0, this.sample.power), this.spec.powerplant.power) : 0,
      wingAlphaDeg: alphas.length ? alphas.reduce((s, x) => s + x, 0) / alphas.length / deg : 0,
    });
    const main = this.mainCycle();
    if (main) {
      const ph = this.phases.get(main.id) ?? 0;
      const prev = ph - 2 * Math.PI * main.hz * this.dt;
      if (Math.floor(ph / (2 * Math.PI)) !== Math.floor(prev / (2 * Math.PI))) this.closeCycle();
    }
  }

  /** Привод, задающий цикл нагружения: машущий, иначе самый быстрый винт. */
  mainCycle(): { id: string; hz: number } | null {
    const osc = this.spec.actuators.find((a) => a.type === 'oscillator');
    if (osc) return { id: osc.id, hz: this.freqNow.get(osc.id) ?? 0 };
    let best: { id: string; hz: number } | null = null;
    for (const a of this.spec.actuators) {
      if (a.type !== 'spinner') continue;
      const hz = this.freqNow.get(a.id) ?? 0;
      if (!best || hz > best.hz) best = { id: a.id, hz };
    }
    return best;
  }

  advance(seconds: number, onStep?: (s: Sample) => void, maxSteps = 500000): number {
    let n = 0;
    const end = this.t + seconds - this.dt * 0.5;
    while (this.t < end && n < maxSteps) {
      this.step();
      n++;
      onStep?.(this.sample);
    }
    return n;
  }

  /**
   * Перейти из системы отсчёта трубы в систему отсчёта земли (или обратно): всем телам добавляется
   * скорость dv, ветру — тоже. Обтекание при этом не меняется: это один и тот же полёт, увиденный
   * из трубы (аппарат стоит, воздух идёт навстречу) и с земли (воздух стоит, аппарат летит).
   * Запомненные скорости сдвигаются тоже — иначе ускорение, которое считается как разность скоростей
   * за шаг, дало бы ложный рывок в нагрузках на лонжерон и в перегрузке экипажа.
   */
  boost(dv: V3) {
    for (const b of this.bodies) {
      const v = b.rb.linvel();
      b.rb.setLinvel({ x: v.x + dv.x, y: v.y + dv.y, z: v.z + dv.z }, true);
      if (b.prevV) b.prevV = add(b.prevV, dv);
    }
    if (this.prevSeatV) this.prevSeatV = this.prevSeatV.map((v) => add(v, dv));
    this.opts.wind = add(this.opts.wind, dv);
  }

  /** Момент импульса всей системы относительно неподвижной точки o, мир. */
  angularMomentum(o: V3): V3 {
    const H = v3();
    for (const b of this.bodies) {
      const rb = b.rb;
      addTo(H, cross(sub(this.bodyCom(b), o), scale(copy(rb.linvel()), rb.mass())));
      const qf = qMul(rb.rotation(), rb.principalInertiaLocalFrame());
      const I = copy(rb.principalInertia());
      const wl = unrotate(qf, copy(rb.angvel()));
      addTo(H, rotate(qf, v3(I.x * wl.x, I.y * wl.y, I.z * wl.z)));
    }
    return H;
  }

  /** Момент инерции всей системы относительно оси axis (единичной), проходящей через точку o. */
  inertiaAbout(o: V3, axis: V3): number {
    let I = 0;
    for (const b of this.bodies) {
      const rb = b.rb;
      const qf = qMul(rb.rotation(), rb.principalInertiaLocalFrame());
      const Ip = copy(rb.principalInertia());
      const a = unrotate(qf, axis);
      I += Ip.x * a.x * a.x + Ip.y * a.y * a.y + Ip.z * a.z * a.z;
      const d = sub(this.bodyCom(b), o);
      I += rb.mass() * (dot(d, d) - dot(d, axis) ** 2);
    }
    return I;
  }

  /** Центр масс всей системы, мир. */
  systemCom(): V3 {
    const c = v3();
    let m = 0;
    for (const b of this.bodies) {
      addTo(c, scale(this.bodyCom(b), b.rb.mass()));
      m += b.rb.mass();
    }
    return scale(c, 1 / Math.max(m, 1e-12));
  }

  private noteForce(F: V3, at: V3) {
    addTo(this.extF, F);
    addTo(this.extM0, cross(at, F));
  }

  /** Перенести аппарат целиком, не меняя скоростей. */
  shift(d: V3) {
    for (const b of this.bodies) {
      const t = b.rb.translation();
      b.rb.setTranslation({ x: t.x + d.x, y: t.y + d.y, z: t.z + d.z }, true);
      b.mid = { ...b.mid, t: add(b.mid.t, d), c: add(b.mid.c, d) };
      if (b.prevT) b.prevT = add(b.prevT, d);
    }
  }

  /**
   * Что свободно у корпуса. level — движение вперёд и по высоте, без поворотов (курс и наклон
   * корпуса удерживаются). Запертые перемещения силы не меняют: корпус, которому задана скорость,
   * идёт равномерно.
   */
  lockRoot(mode: 'fixed' | 'vertical' | 'planar' | 'level' | 'free') {
    const b = this.root.b.rb;
    const [tx, ty, tz, rx, ry, rz] =
      mode === 'fixed' ? [false, false, false, false, false, false]
      : mode === 'vertical' ? [false, true, false, false, false, false]
      : mode === 'planar' ? [true, true, false, false, false, true]
      : mode === 'level' ? [true, true, false, false, false, false]
      : [true, true, true, true, true, true];
    b.setEnabledTranslations(tx, ty, tz, true);
    b.setEnabledRotations(rx, ry, rz, true);
  }

  private emptySample(): Sample {
    return {
      t: 0, altitude: 0, airspeed: 0, vz: 0, pitchDeg: 0, rollDeg: 0, headingDeg: 0, betaDeg: 0, liftToWeight: 0, loadFactor: 0, aeroForce: v3(), shaftPower: 0, shaftPowerNet: 0, tailRotorPower: 0, fuelFlow: 0, powerRecovered: 0,
      propPower: 0, propRpm: 0, propEfficiency: 0, power: 0, powerAvailable: this.powerAvailable, minMargin: Infinity, minMarginPart: '',
      minMarginMode: 'none', minMarginSpan: 0, minYieldMargin: Infinity, crewAccel: 0, crewAccelVec: v3(), maxMach: 0, stalledFrac: 0,
      wingAlphaDeg: 0, actuatorLagDeg: 0,
    };
  }

  free() {
    this.world.free();
  }
}

/** Собственные значения и собственные векторы симметричной матрицы 3×3 (метод Якоби); frame — поворот,
 *  столбцы матрицы которого — собственные векторы (правая тройка). */
export function symmetricEigen(M: number[][]): { values: [number, number, number]; frame: Q } {
  const A = M.map((r) => [...r]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    if (off < 1e-30 * (A[0][0] ** 2 + A[1][1] ** 2 + A[2][2] ** 2 + 1e-300)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = cs * akp - sn * akq;
        A[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = cs * apk - sn * aqk;
        A[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = cs * vkp - sn * vkq;
        V[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  // Правая тройка: третий столбец = первый × второй.
  const c0 = v3(V[0][0], V[1][0], V[2][0]);
  const c1 = v3(V[0][1], V[1][1], V[2][1]);
  const c2 = cross(c0, c1);
  const R = [[c0.x, c1.x, c2.x], [c0.y, c1.y, c2.y], [c0.z, c1.z, c2.z]];
  const tr = R[0][0] + R[1][1] + R[2][2];
  let q: Q;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    q = { w: 0.25 * S, x: (R[2][1] - R[1][2]) / S, y: (R[0][2] - R[2][0]) / S, z: (R[1][0] - R[0][1]) / S };
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const S = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
    q = { w: (R[2][1] - R[1][2]) / S, x: 0.25 * S, y: (R[0][1] + R[1][0]) / S, z: (R[0][2] + R[2][0]) / S };
  } else if (R[1][1] > R[2][2]) {
    const S = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
    q = { w: (R[0][2] - R[2][0]) / S, x: (R[0][1] + R[1][0]) / S, y: 0.25 * S, z: (R[1][2] + R[2][1]) / S };
  } else {
    const S = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
    q = { w: (R[1][0] - R[0][1]) / S, x: (R[0][2] + R[2][0]) / S, y: (R[1][2] + R[2][1]) / S, z: 0.25 * S };
  }
  // Собственное значение третьего столбца: c2 = ±(третий собственный вектор), значение то же.
  return { values: [A[0][0], A[1][1], A[2][2]], frame: q };
}

export class SpecError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`Спецификация отклонена:\n- ${errors.join('\n- ')}`);
    this.errors = errors;
  }
}

function wrapPi(a: number) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}
