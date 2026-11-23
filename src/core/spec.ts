// Спецификация аппарата (ТЗ, раздел 5) и её проверка до сборки модели.
// Все величины в СИ. Оси: x — вперёд, y — вверх, z — вправо.

export type Vec3 = [number, number, number];

export const SCHEMA_VERSION = 1;

export interface Spec {
  schema: number;
  meta: {
    name: string;
    class: 'fixed-wing' | 'rotor' | 'flapping';
    source: 'text' | 'image' | 'preset';
    notes?: string;
  };
  environment: Environment;
  parts: Part[];
  joints: Joint[];
  actuators: Actuator[];
  // power — располагаемая мощность; losses — доля сверх мощности на валах
  // (хвостовой винт, трансмиссия, КПД электромоторов), напр. 0,15.
  // lapse — как мощность падает с высотой: поршневой мотор, турбина, без изменения.
  // ratedRpm — обороты, на которых мотор на полном газе даёт power; нужен винту фиксированного шага. На полном
  // газе момент мотора считается постоянным (power / ω_ном): мощность пропорциональна оборотам.
  // engine — модель двигателя по данным производителя (engine.ts): мощность на высоте, расход топлива, батарея.
  // Без неё — по lapse: поршневой — закон Lycoming с k = 1,04, турбина — δ/√θ, «none» — без изменения.
  powerplant: { power: number; losses?: number; lapse?: 'piston' | 'turbine' | 'none'; ratedRpm?: number; note?: string; engine?: import('./engine.ts').EngineSpec };
  // unmanned — людей на борту нет: ускорения в точке seats считаются для сведения, на вердикт не влияют.
  crew: { part: string; seats: Vec3[]; unmanned?: boolean };
  controls?: Control[];
  // Расчётная эксплуатационная перегрузка для манёвра в максимальном режиме
  // (нормальная категория самолётов — 3,8). Конструкция должна выдержать её с запасом 1,5.
  // cruiseSpeed — скорость набегающего потока в программе «полёт в трубе», м/с.
  limits?: { loadFactor?: number; cruiseSpeed?: number };
  assumptions: Assumption[];
}

/** Органы управления, которыми пользуется автопилот программ испытаний. */
export interface Control {
  channel: string;
  label: string;
  role: 'lift' | 'pitch' | 'throttle' | 'roll' | 'yaw';
  min: number;
  max: number;
  initial: number;
  gain?: number; // для 'lift': изменение канала в секунду на 1 м/с² ошибки ускорения
}

export interface Environment {
  name: string;
  g: number; // м/с²
  rho: number; // плотность воздуха у земли, кг/м³
  soundSpeed: number; // м/с
}

/** Табличная поляра профиля по числу Рейнольдса (продувки): α в градусах, у симметричного профиля — от 0 до 180. */
export interface PolarSet {
  name: string;
  source: string;
  symmetric: boolean;
  tables: { re: number; note?: string; alpha: number[]; cl: number[]; cd: number[] }[];
  // Тот же профиль с шероховатостью у передней кромки (стандартная шероховатость NACA, полоса зерна) — где измерено.
  rough?: { re: number; note?: string; alpha: number[]; cl: number[]; cd: number[] }[];
}

export interface Airfoil {
  name?: string;
  // Табличная поляра по числу Рейнольдса. Если есть, расчёт берёт c_l и c_d из неё (с поправкой на сжимаемость),
  // а числа ниже (cl0, clMax, cd0, k) — только сводка для оценок и отчёта.
  polar?: PolarSet;
  // Состояние поверхности: 0 — гладкий профиль, как в трубе; 1 — со стандартной шероховатостью у передней кромки; между ними —
  // линейно по c_l и c_d. Свойство самого крыла или лопасти (краска, заклёпки, эрозия, насекомые). Работает при табличной поляре
  // с шероховатым вариантом. По умолчанию 0,5 — настоящая поверхность неизвестна (оценка).
  surface?: number;
  cl0: number; // C_L при нулевом угле атаки
  clAlpha?: number; // наклон, 1/рад (по умолчанию 2π·0,9)
  clMax: number; // максимальный C_L профиля
  clMin?: number; // минимальный (по умолчанию 2·cl0 − clMax: срыв симметричен относительно C_L0)
  cd0: number; // профильное сопротивление
  k?: number; // C_D = cd0 + k·C_L²
  thickness: number; // относительная толщина профиля
  // Число Маха расходимости M_dd = κ_A − t/c − s·|c_l| (aero.ts, DRAG_RISE). По умолчанию — NACA 0012 (4-значные профили);
  // для 6-й серии — KORN_6SERIES.
  dragRise?: { kappaA: number; clSlope: number };
}

export interface AeroSurface {
  side: 1 | -1; // размах вдоль +z или −z
  span: number;
  rootChord: number;
  tipChord: number;
  sweepDeg?: number;
  dihedralDeg?: number;
  incidenceDeg: number;
  twistDeg?: number; // законцовка минус корень
  airfoil: Airfoil;
  sections?: number;
  induced?: 'wing' | 'rotor' | 'none';
  role?: 'main' | 'tail'; // основное крыло — для оценки скорости сваливания
  aspectRatio?: number; // для induced: 'wing'; по умолчанию 2·span/средняя хорда
  // Хорда по размаху, если крыло не трапеция: (доля размаха от корня, хорда, м), доли по возрастанию от 0 до 1.
  // Например, у Cessna 172 крыло прямоугольное до излома и трапециевидное за ним.
  planform?: [number, number][];
  // Управление: incidence += channel·deg (при channel < 0 — channel·degNeg, если задано: разные отклонения вверх и вниз,
  // как у дифференциальных элеронов). from…to — участок размаха (доли от корня), где стоит рулевая поверхность.
  // Для закрылка (руля, элерона) deg — отклонение, умноженное на эффективность τ (теория тонкого профиля,
  // τ = 1 − (θf − sin θf)/π, θf = arccos(2·c_f/c − 1)).
  control?: { channel: string; deg: number; degNeg?: number; from?: number; to?: number };
  feathering?: { channel: string; maxDeg: number; actuator: string; phaseDeg?: number; mode?: 'paddle' | 'sine'; distribution?: 'uniform' | 'linear' };
  addedMass?: boolean; // нестационарная присоединённая масса воздуха (машущее крыло)
  // Нестационарное обтекание: подъёмная сила отстаёт от угла атаки (функция Вагнера).
  // Для машущего крыла в полёте вперёд; без этого тяга взмаха завышается.
  unsteady?: boolean;
}

export interface Structure {
  section: 'box' | 'tube';
  material: string;
  widthFrac?: number; // ширина коробки как доля хорды (box)
  heightFrac?: number; // высота как доля толщины профиля (box)
  wall: number; // толщина стенки, м
  diameter?: number; // для tube, м
  skinArealMass: number; // обшивка и нервюры, кг/м² площади крыла
  // Сечение заполнено (сотовый или пенный заполнитель, как у лопастей винтов): стенки подкреплены,
  // местная потеря устойчивости для них не проверяется. Остальные виды разрушения проверяются как обычно.
  filled?: boolean;
  // Укладка композита: доли слоёв 0° (вдоль размаха), ±45° и 90°. Задана — материал считается ламинатом
  // (src/core/laminate.ts); не задана — однонаправленным, все волокна вдоль размаха.
  layup?: import('./laminate.ts').Layup;
  // Положение лонжерона (центра коробки или трубы) по хорде, доля от передней кромки; по умолчанию 0,3.
  sparAt?: number;
  // Кессон, работающий на кручение: замкнутый контур из обшивки и стенок лонжеронов между долями хорды from…to,
  // толщина обшивки skin, м. Не задан — на кручение работает только сам лонжерон (флаттер тогда не проверяется:
  // жёсткость на кручение не известна).
  torsionBox?: { from: number; to: number; skin: number };
  // Подкос (крыло с подкосом): крепится к крылу на доле размаха at (от корня), в точке хорды chordAt (доля от передней
  // кромки, обычно на переднем лонжероне). Задан — в расчёте флаттера корень — шарнир, подкос — опора по вертикали.
  // На прочность лонжерона пока не влияет: она считается как у эквивалентной консоли.
  strut?: { at: number; chordAt: number };
}

export interface Part {
  id: string;
  name?: string;
  kind: 'body' | 'wing' | 'blade' | 'boom' | 'hub' | 'gear';
  position: Vec3; // корень детали в мировых координатах при t = 0
  rotation?: Vec3; // углы Эйлера, градусы
  shape?: { type: 'ellipsoid' | 'box' | 'sphere' | 'cylinder'; size: Vec3 };
  mass?: number; // для крыльев и лопастей — переопределение массы из конструкции
  aero?: AeroSurface;
  structure?: Structure;
  dragArea?: number; // C_D·S для ненесущих деталей, м² — вдоль продольной оси детали (лобовое)
  // C_D поперечного обтекания (поток поперёк продольной оси, отнесённый к площади проекции формы на плоскость, поперёк
  // потока). По принципу поперечного обтекания (Аллен — Перкинс): сила поперёк корпуса от поперечной составляющей
  // скорости, независимо от продольной. Не задано — по форме (Хёрнер, Fluid-Dynamic Drag, гл. 3, с поправкой на конечную
  // длину): эллипсоид 0,7, коробка 1,2, шар 0,47. Только у деталей с формой и с dragArea.
  crossflowCd?: number;
  collides?: boolean; // касается земли
  friction?: number;
}

export interface Joint {
  id: string;
  type: 'fixed' | 'revolute';
  parent: string;
  child: string;
  axis?: Vec3; // для revolute, в осях родителя
}

export type Actuator =
  | {
      id: string;
      type: 'oscillator';
      joints: { joint: string; sign: 1 | -1 }[];
      freqHz: number;
      amplitudeDeg: number;
      phaseDeg?: number;
      offsetDeg?: number;
      rampTime?: number;
      groupPhase?: Record<string, number>; // сдвиг фазы по суставу, градусы
    }
  | {
      id: string;
      type: 'spinner';
      joint: string;
      rpm: number;
      direction: 1 | -1;
      rampTime?: number;
      channel?: string; // множитель оборотов (квадрокоптер)
      inducedFactor?: number; // κ, поправка индуктивной мощности (по умолчанию 1,15)
      // Хвостовой винт, парирующий реактивный момент этого винта: размеры и обороты. Его мощность считается
      // по моменту несущего винта (src/core/tailrotor.ts) и прибавляется к нужной мощности.
      tailRotor?: import('./tailrotor.ts').TailRotorSpec;
      // Лопасти машут свободно на шарнирах у оси винта: качающаяся втулка с шарнирами конусности (R22) или шарнирная
      // втулка с малым разносом. Диск наклоняется, конусность устанавливается сама, момента на вал шарниры не передают.
      // Без этого лопасти закреплены на втулке жёстко (с постоянной конусностью dihedralDeg).
      flapping?: boolean;
      // Циклический шаг, °: угол установки лопасти += cos·cos ψ + sin·sin ψ; ψ — азимут лопасти, отсчитанный от хвоста
      // по направлению вращения (ψ = 90° — наступающая лопасть). Значения — в каналах управления.
      cyclic?: { cos: string; sin: string };
      // Канал обгонной муфты: > 0,5 — мотор отключён, винт вращается только от потока (авторотация).
      freewheel?: string;
    }
  | {
      id: string;
      type: 'propeller';
      part: string;
      axis: Vec3; // направление тяги в осях детали
      diameter: number;
      efficiency: number; // профильный КПД лопастей (без индуктивных потерь), обычно 0,85; при fixedPitch не используется
      powerShare?: number; // доля от силовой установки
      channel: string; // газ 0…1
      // Винт фиксированного шага (src/core/propeller.ts): тяга и момент по элементам лопасти, обороты — из равновесия
      // момента мотора и момента винта. Без этого блока — импульсный диск с КПД efficiency (как винт постоянных оборотов).
      fixedPitch?: FixedPitchSpec;
      // Направление вращения: 1 — правое вращение вокруг оси тяги (по часовой стрелке, если смотреть сзади, как у
      // Lycoming), −1 — левое. Задано — на корпус действует реактивный момент мотора −spin·Q вдоль оси.
      spin?: 1 | -1;
    };

export interface FixedPitchSpec {
  blades: number;
  pitch: number; // геометрический шаг по плоской стороне лопасти, м (постоянный по радиусу)
  betaDeg?: [number, number][]; // (r/R, угол установки, °) — если задан, вместо постоянного шага
  hubFrac: number; // r/R начала лопасти
  chord: [number, number][]; // (r/R, хорда, м)
  airfoil: Airfoil; // c_l0 — относительно плоской стороны лопасти
  inertia: number; // момент инерции вращающихся частей (винт, коленвал), кг·м²
}

export interface Assumption {
  path: string; // путь к полю, напр. "parts[wingR].aero.span"
  value: number;
  unit?: string;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  origin: 'user' | 'image' | 'source' | 'estimated';
  reason: string;
  min?: number;
  max?: number;
  step?: number;
  linked?: string[]; // другие пути, которые меняются вместе (левое и правое крыло)
}

// ---------- проверка ----------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  totalMass?: number;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateSpec(spec: Spec, knownMaterials: string[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const range = (path: string, x: unknown, lo: number, hi: number) => {
    if (!finite(x)) errors.push(`${path}: должно быть числом, получено ${JSON.stringify(x)}`);
    else if (x < lo || x > hi) errors.push(`${path}: ${x} вне допустимого диапазона ${lo}…${hi}`);
  };
  const vec = (path: string, v: unknown, lo: number, hi: number) => {
    if (!Array.isArray(v) || v.length !== 3) errors.push(`${path}: нужен вектор из трёх чисел`);
    else v.forEach((x, i) => range(`${path}[${i}]`, x, lo, hi));
  };

  if (spec.schema !== SCHEMA_VERSION) errors.push(`schema: версия ${spec.schema}, ожидается ${SCHEMA_VERSION}`);
  if (!spec.meta?.name) errors.push('meta.name: пустое название');
  if (!['fixed-wing', 'rotor', 'flapping'].includes(spec.meta?.class)) errors.push(`meta.class: неизвестный класс ${spec.meta?.class}`);

  const env = spec.environment;
  if (!env) errors.push('environment: нет блока среды');
  else {
    range('environment.g', env.g, 0.1, 50);
    range('environment.rho', env.rho, 1e-4, 100);
    range('environment.soundSpeed', env.soundSpeed, 50, 2000);
  }

  const ids = new Set<string>();
  if (!Array.isArray(spec.parts) || spec.parts.length === 0) errors.push('parts: нет ни одной детали');
  for (const [i, p] of (spec.parts ?? []).entries()) {
    const at = `parts[${p.id ?? i}]`;
    if (!p.id) errors.push(`${at}: нет id`);
    else if (ids.has(p.id)) errors.push(`${at}: повторяющийся id`);
    else ids.add(p.id);
    vec(`${at}.position`, p.position, -1000, 1000);
    if (p.rotation) vec(`${at}.rotation`, p.rotation, -360, 360);
    if (p.mass !== undefined) range(`${at}.mass`, p.mass, 1e-4, 1e7);
    if (p.shape) vec(`${at}.shape.size`, p.shape.size, 1e-3, 500);
    if (p.dragArea !== undefined) range(`${at}.dragArea`, p.dragArea, 0, 1000);
    if (p.crossflowCd !== undefined) range(`${at}.crossflowCd`, p.crossflowCd, 0, 3);
    const lifting = p.kind === 'wing' || p.kind === 'blade';
    if (lifting && !p.aero) errors.push(`${at}: у крыла или лопасти нет блока aero`);
    if (!lifting && !p.shape) errors.push(`${at}: у детали без aero нужна форма shape`);
    if (!lifting && p.mass === undefined) errors.push(`${at}: у детали без aero нужна масса`);
    if (p.aero) {
      const a = p.aero;
      if (a.side !== 1 && a.side !== -1) errors.push(`${at}.aero.side: должно быть 1 или −1`);
      range(`${at}.aero.span`, a.span, 0.01, 500);
      range(`${at}.aero.rootChord`, a.rootChord, 0.001, 100);
      range(`${at}.aero.tipChord`, a.tipChord, 0.001, 100);
      range(`${at}.aero.incidenceDeg`, a.incidenceDeg, -90, 90);
      if (a.sections !== undefined) range(`${at}.aero.sections`, a.sections, 4, 40);
      range(`${at}.aero.airfoil.clMax`, a.airfoil?.clMax, 0.2, 3.5);
      range(`${at}.aero.airfoil.cd0`, a.airfoil?.cd0, 0.001, 0.5);
      range(`${at}.aero.airfoil.thickness`, a.airfoil?.thickness, 0.01, 0.5);
      if (a.planform) {
        const pf = a.planform;
        if (!Array.isArray(pf) || pf.length < 2 || pf[0][0] !== 0 || pf[pf.length - 1][0] !== 1 || pf.some((r, i) => i > 0 && !(r[0] > pf[i - 1][0])))
          errors.push(`${at}.aero.planform: доли размаха — по возрастанию от 0 до 1`);
        pf.forEach((r, i) => range(`${at}.aero.planform[${i}]`, r?.[1], 0.001, 100));
      }
      if (a.control) {
        const c = a.control;
        if (c.from !== undefined) range(`${at}.aero.control.from`, c.from, 0, 1);
        if (c.to !== undefined) range(`${at}.aero.control.to`, c.to, 0, 1);
        if ((c.from ?? 0) >= (c.to ?? 1)) errors.push(`${at}.aero.control: from должно быть меньше to`);
      }
      if (finite(a.span) && finite(a.rootChord) && a.rootChord > a.span * 2)
        warnings.push(`${at}.aero: хорда больше двух размахов — проверьте размеры`);
    }
    if (p.structure) {
      const s = p.structure;
      if (!knownMaterials.includes(s.material)) errors.push(`${at}.structure.material: неизвестный материал «${s.material}»`);
      range(`${at}.structure.wall`, s.wall, 1e-5, 1);
      range(`${at}.structure.skinArealMass`, s.skinArealMass, 0, 500);
      if (s.section === 'box') {
        if (s.widthFrac !== undefined) range(`${at}.structure.widthFrac`, s.widthFrac, 0.02, 1);
        if (s.heightFrac !== undefined) range(`${at}.structure.heightFrac`, s.heightFrac, 0.1, 1);
      } else if (s.section === 'tube') range(`${at}.structure.diameter`, s.diameter, 1e-3, 20);
      else errors.push(`${at}.structure.section: неизвестный тип сечения`);
    } else if (p.kind === 'wing' || p.kind === 'blade' || p.kind === 'boom') {
      if (p.mass === undefined) errors.push(`${at}: нет ни конструкции structure, ни массы`);
      else warnings.push(`${at}: нет силового набора — прочность не проверяется`);
    }
  }

  // Дерево соединений: ровно один корень, у каждой детали ровно один родитель, без циклов.
  const parentOf = new Map<string, string>();
  const jointIds = new Set<string>();
  for (const [i, j] of (spec.joints ?? []).entries()) {
    const at = `joints[${j.id ?? i}]`;
    if (!j.id || jointIds.has(j.id)) errors.push(`${at}: нет id или он повторяется`);
    jointIds.add(j.id);
    if (!ids.has(j.parent)) errors.push(`${at}.parent: нет детали «${j.parent}»`);
    if (!ids.has(j.child)) errors.push(`${at}.child: нет детали «${j.child}»`);
    if (j.parent === j.child) errors.push(`${at}: деталь соединена сама с собой`);
    if (parentOf.has(j.child)) errors.push(`${at}: у детали «${j.child}» второй родитель`);
    parentOf.set(j.child, j.parent);
    if (j.type === 'revolute') {
      vec(`${at}.axis`, j.axis, -1, 1);
      if (j.axis && Math.abs(Math.hypot(...j.axis) - 1) > 1e-3) errors.push(`${at}.axis: ось должна быть единичной`);
      const child = spec.parts.find((p) => p.id === j.child);
      const parent = spec.parts.find((p) => p.id === j.parent);
      if (child && parent && j.axis) {
        // Rapier задаёт ось шарнира одинаково в осях обоих тел: поворот ребёнка
        // относительно родителя допускается только вокруг самой оси.
        const rc = child.rotation ?? [0, 0, 0];
        const rp = parent.rotation ?? [0, 0, 0];
        const diff = rc.map((x, k) => x - rp[k]);
        const off = diff.some((d, k) => Math.abs(d) > 1e-9 && Math.abs(j.axis![k]) < 0.999);
        if (off) errors.push(`${at}: поворот детали «${j.child}» должен быть только вокруг оси шарнира`);
      }
    } else if (j.type !== 'fixed') errors.push(`${at}.type: неизвестный тип соединения`);
  }
  const roots = (spec.parts ?? []).filter((p) => !parentOf.has(p.id));
  if (roots.length !== 1)
    errors.push(`joints: должна быть ровно одна корневая деталь (корпус), найдено ${roots.length}: ${roots.map((r) => r.id).join(', ')}`);
  for (const id of ids) {
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && parentOf.has(cur)) {
      if (seen.has(cur)) {
        errors.push(`joints: цикл соединений через «${cur}»`);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  const actIds = new Set<string>();
  for (const [i, a] of (spec.actuators ?? []).entries()) {
    const at = `actuators[${a.id ?? i}]`;
    actIds.add(a.id);
    if (a.type === 'oscillator') {
      range(`${at}.freqHz`, a.freqHz, 0.01, 1000);
      range(`${at}.amplitudeDeg`, a.amplitudeDeg, 0, 90);
      for (const j of a.joints) {
        const jj = spec.joints.find((x) => x.id === j.joint);
        if (!jj) errors.push(`${at}: нет шарнира «${j.joint}»`);
        else if (jj.type !== 'revolute') errors.push(`${at}: «${j.joint}» не шарнир`);
      }
    } else if (a.type === 'spinner') {
      range(`${at}.rpm`, a.rpm, 1, 100000);
      const jj = spec.joints.find((x) => x.id === a.joint);
      if (!jj || jj.type !== 'revolute') errors.push(`${at}: нет шарнира «${a.joint}»`);
      if (a.tailRotor) {
        const t = a.tailRotor;
        range(`${at}.tailRotor.radius`, t.radius, 0.02, 10);
        range(`${at}.tailRotor.blades`, t.blades, 2, 12);
        range(`${at}.tailRotor.chord`, t.chord, 0.005, 2);
        range(`${at}.tailRotor.rpm`, t.rpm, 10, 60000);
        range(`${at}.tailRotor.arm`, t.arm, 0.05, 50);
      }
    } else if (a.type === 'propeller') {
      if (!ids.has(a.part)) errors.push(`${at}.part: нет детали «${a.part}»`);
      range(`${at}.diameter`, a.diameter, 0.01, 20);
      range(`${at}.efficiency`, a.efficiency, 0.1, 0.95);
      if (a.fixedPitch) {
        const f = a.fixedPitch;
        range(`${at}.fixedPitch.blades`, f.blades, 1, 12);
        range(`${at}.fixedPitch.pitch`, f.pitch, 0.01, 50);
        range(`${at}.fixedPitch.hubFrac`, f.hubFrac, 0.02, 0.6);
        range(`${at}.fixedPitch.inertia`, f.inertia, 1e-7, 1e5);
        if (!Array.isArray(f.chord) || f.chord.length < 2) errors.push(`${at}.fixedPitch.chord: нужно не меньше двух точек (r/R, хорда)`);
        else f.chord.forEach(([x, c], i) => { range(`${at}.fixedPitch.chord[${i}][0]`, x, 0, 1); range(`${at}.fixedPitch.chord[${i}][1]`, c, 1e-4, 0.5 * a.diameter); });
        if (!finite(spec.powerplant?.ratedRpm)) errors.push(`${at}.fixedPitch: нужен powerplant.ratedRpm — обороты номинальной мощности мотора`);
        else range('powerplant.ratedRpm', spec.powerplant.ratedRpm, 10, 100000);
      }
    } else errors.push(`${at}.type: неизвестный привод`);
  }
  for (const p of spec.parts ?? []) {
    const f = p.aero?.feathering;
    if (f && !actIds.has(f.actuator)) errors.push(`parts[${p.id}].aero.feathering.actuator: нет привода «${f.actuator}»`);
  }

  for (const c of spec.controls ?? []) {
    const at = `controls[${c.channel}]`;
    if (!(c.min < c.max)) errors.push(`${at}: min должно быть меньше max`);
    if (!(c.initial >= c.min && c.initial <= c.max)) errors.push(`${at}: начальное значение вне диапазона`);
  }
  range('powerplant.power', spec.powerplant?.power, 0, 1e12);
  if (!ids.has(spec.crew?.part)) errors.push(`crew.part: нет детали «${spec.crew?.part}»`);

  for (const a of spec.assumptions ?? []) {
    if (a.path.startsWith('design.')) continue; // допущение проекта, а не спецификации
    if (!['high', 'medium', 'low'].includes(a.confidence)) errors.push(`assumptions[${a.path}]: неизвестная уверенность`);
    if (getPath(spec, a.path) === undefined) errors.push(`assumptions[${a.path}]: такого поля нет в спецификации`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------- пути вида parts[wingR].aero.span ----------

function tokens(path: string): (string | { id: string })[] {
  const out: (string | { id: string })[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[([^\]]+)\]/g)) {
    if (m[1] !== undefined) out.push(m[1]);
    else out.push({ id: m[2] });
  }
  return out;
}

function step(obj: any, t: string | { id: string }): any {
  if (obj == null) return undefined;
  if (typeof t === 'string') return obj[t];
  if (Array.isArray(obj)) {
    const byId = obj.find((x) => x && x.id === t.id);
    if (byId) return byId;
    const n = Number(t.id);
    return Number.isInteger(n) ? obj[n] : undefined;
  }
  return obj[t.id];
}

export function getPath(spec: unknown, path: string): any {
  let cur: any = spec;
  for (const t of tokens(path)) cur = step(cur, t);
  return cur;
}

export function setPath(spec: unknown, path: string, value: unknown): boolean {
  const ts = tokens(path);
  let cur: any = spec;
  for (const t of ts.slice(0, -1)) cur = step(cur, t);
  const last = ts[ts.length - 1];
  if (cur == null) return false;
  if (typeof last === 'string') cur[last] = value;
  else if (Array.isArray(cur)) {
    const i = cur.findIndex((x) => x && x.id === last.id);
    if (i < 0) return false;
    cur[i] = value;
  } else cur[last.id] = value;
  return true;
}

/** Применить значения допущений (с учётом связанных путей) к копии спецификации. */
export function applyAssumptions(spec: Spec, overrides: Record<string, number> = {}): Spec {
  const s: Spec = structuredClone(spec);
  for (const a of s.assumptions) {
    if (a.path.startsWith('design.')) continue; // правится в проекте и пересобирается
    const v = overrides[a.path] ?? a.value;
    a.value = v;
    setPath(s, a.path, v);
    for (const l of a.linked ?? []) setPath(s, l, v);
  }
  return s;
}

/** Хорда поверхности на доле размаха f (0 — корень, 1 — законцовка), м. */
export function chordAtFrac(a: AeroSurface, f: number): number {
  const pf = a.planform;
  if (!pf || pf.length < 2) return a.rootChord + (a.tipChord - a.rootChord) * f;
  if (f <= pf[0][0]) return pf[0][1];
  for (let i = 1; i < pf.length; i++)
    if (f <= pf[i][0]) return pf[i - 1][1] + ((f - pf[i - 1][0]) / (pf[i][0] - pf[i - 1][0])) * (pf[i][1] - pf[i - 1][1]);
  return pf[pf.length - 1][1];
}

/** Площадь поверхности в плане (по проекции размаха), м². */
export function surfaceArea(a: AeroSurface): number {
  const pf = a.planform;
  if (!pf || pf.length < 2) return ((a.rootChord + a.tipChord) / 2) * a.span;
  let s = 0;
  for (let i = 1; i < pf.length; i++) s += ((pf[i][1] + pf[i - 1][1]) / 2) * (pf[i][0] - pf[i - 1][0]);
  return s * a.span;
}
