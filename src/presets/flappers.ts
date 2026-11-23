// Реальные махолёты — эталоны для машущего крыла (ТЗ, раздел 12, уровень 2).
// Открытые данные — data/research.md; остальное вынесено в допущения.
import type { Spec, Part, Joint, AeroSurface, Airfoil } from '../core/spec.ts';

interface FlapperParams {
  name: string;
  notes: string;
  bodyMass: number;
  body: [number, number, number];
  dragArea: number;
  halfSpan: number;
  rootChord: number;
  tipChord: number;
  wingMass: number;
  airfoil: Airfoil;
  freqHz: number;
  amplitudeDeg: number;
  twistLimitDeg: number; // наибольшее закручивание законцовки на взмахе, ± от среднего угла
  wall?: number; // стенка лонжерона; не задана — прочность не проверяется
  power: number;
  losses: number;
  cruiseSpeed: number;
  seats: number;
  // Неподвижная внутренняя часть крыла (м от борта корпуса): машет только внешняя панель, шарнир — на её корне.
  // amplitudeDeg тогда — размах внешней панели. Без поля машет всё крыло от корпуса.
  innerSpan?: number;
}

function flapper(p: FlapperParams, assumptions: Spec['assumptions']): Spec {
  const inner = p.innerSpan ?? 0;
  const FY = (p.halfSpan - inner) * Math.sin((p.amplitudeDeg * Math.PI) / 180) + p.body[1] / 2 + 0.5;
  const chordAt = (y: number) => p.rootChord + ((p.tipChord - p.rootChord) * y) / p.halfSpan;
  const areaOf = (a: number, b: number) => ((b - a) * (chordAt(a) + chordAt(b))) / 2;
  const span = 2 * p.halfSpan + p.body[2];
  const area = 2 * p.halfSpan * ((p.rootChord + p.tipChord) / 2);
  const parts: Part[] = [
    { id: 'body', name: 'Корпус', kind: 'body', position: [0, FY, 0], shape: { type: 'ellipsoid', size: p.body }, mass: p.bodyMass, dragArea: p.dragArea },
  ];
  const joints: Joint[] = [];
  for (const side of [-1, 1] as const) {
    const id = side < 0 ? 'wingL' : 'wingR';
    if (inner > 0) {
      const iid = side < 0 ? 'innerL' : 'innerR';
      parts.push({ id: iid, name: side < 0 ? 'Левый центроплан' : 'Правый центроплан', kind: 'wing', position: [0, FY, (side * p.body[2]) / 2],
        mass: (p.wingMass * areaOf(0, inner)) / areaOf(0, p.halfSpan),
        aero: { side, span: inner, rootChord: p.rootChord, tipChord: chordAt(inner), incidenceDeg: 0, sections: 6, induced: 'wing',
          aspectRatio: (span * span) / area, unsteady: true, airfoil: p.airfoil, control: { channel: 'pitch', deg: 1 } } });
      joints.push({ id: `fix-${iid}`, type: 'fixed', parent: 'body', child: iid });
    }
    const aero: AeroSurface = {
      side, span: p.halfSpan - inner, rootChord: chordAt(inner), tipChord: p.tipChord,
      // Средний угол — канал pitch (балансировка). Закручивание — в фазе со скоростью взмаха:
      // на ходе вниз нос опускается, подъёмная сила наклоняется вперёд — получается тяга.
      // Канал feather — доля от наибольшего закручивания; нужную долю подбирает программа «труба».
      incidenceDeg: 0, sections: 10, induced: 'wing', aspectRatio: (span * span) / area, addedMass: true, unsteady: true,
      airfoil: p.airfoil, control: { channel: 'pitch', deg: 1 },
      feathering: { channel: 'feather', maxDeg: 2 * p.twistLimitDeg, actuator: 'flap', mode: 'sine', distribution: 'linear' },
    };
    parts.push({ id, name: inner > 0 ? (side < 0 ? 'Левая машущая консоль' : 'Правая машущая консоль') : side < 0 ? 'Левое крыло' : 'Правое крыло', kind: 'wing',
      position: [0, FY, side * (p.body[2] / 2 + inner)], aero, mass: (p.wingMass * areaOf(inner, p.halfSpan)) / areaOf(0, p.halfSpan),
      ...(p.wall ? { structure: { section: 'box' as const, material: 'cfrp', widthFrac: 0.12, heightFrac: 0.85, wall: p.wall, skinArealMass: 0 } } : {}) });
    joints.push({ id: `hinge-${id}`, type: 'revolute', parent: 'body', child: id, axis: [1, 0, 0] });
  }
  return {
    schema: 1,
    meta: { name: p.name, class: 'flapping', source: 'preset', notes: p.notes },
    environment: { name: 'Земля, МСА', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
    parts,
    joints,
    actuators: [{ id: 'flap', type: 'oscillator', freqHz: p.freqHz, amplitudeDeg: p.amplitudeDeg, rampTime: 2 / p.freqHz,
      joints: [{ joint: 'hinge-wingL', sign: 1 }, { joint: 'hinge-wingR', sign: -1 }] }],
    powerplant: { power: p.power, losses: p.losses, lapse: 'none' },
    crew: { part: 'body', seats: [[0, 0, 0]], ...(p.seats === 0 ? { unmanned: true } : {}) },
    controls: [
      { channel: 'pitch', label: 'Средний угол установки крыльев, °', role: 'pitch', min: -10, max: 15, initial: 3 },
      { channel: 'feather', label: 'Закручивание на взмахе, доля от наибольшего', role: 'lift', min: 0, max: 1, initial: 0.6, gain: 0.005 },
    ],
    limits: { cruiseSpeed: p.cruiseSpeed },
    assumptions,
  };
}

export const smartbird: Spec = flapper(
  {
    name: 'Festo SmartBird', notes: 'Робот-чайка с активным закручиванием крыла: 0,48 кг, размах 2 м, 2 Гц.',
    // Сопротивление (профиль и корпус) подобрано под опубликованное качество L/D ≈ 7: тяга в полёте 0,7 Н.
    bodyMass: 0.38, body: [0.6, 0.08, 0.1], dragArea: 0.01, halfSpan: 0.95, rootChord: 0.3, tipChord: 0.2, wingMass: 0.05,
    airfoil: { name: 'тонкий профиль с изгибом', cl0: 0.3, clAlpha: 5.0, clMax: 1.1, cd0: 0.04, k: 0.03, thickness: 0.08 },
    freqHz: 2, amplitudeDeg: 25, twistLimitDeg: 50, wall: 0.0006, power: 50, losses: 1.94, cruiseSpeed: 5, seats: 0,
  },
  [
    { path: 'actuators[flap].amplitudeDeg', value: 25, unit: '°', label: 'Размах взмаха', confidence: 'low', origin: 'estimated',
      reason: 'В открытых данных нет; по видео — около ±25°.', min: 5, max: 50, step: 1 },
    { path: 'parts[wingR].aero.feathering.maxDeg', value: 100, unit: '°', label: 'Наибольшее закручивание законцовки (полный ход)', confidence: 'low', origin: 'estimated',
      reason: 'Крыло закручивает сервопривод; предел не опубликован. Чтобы законцовка шла по потоку, нужно около ±46°: при ±25° и 2 Гц она движется со скоростью полёта.', min: 0, max: 140, step: 2, linked: ['parts[wingL].aero.feathering.maxDeg'] },
    { path: 'parts[body].dragArea', value: 0.01, unit: 'м²', label: 'Сопротивление корпуса, головы и хвоста', confidence: 'low', origin: 'source',
      reason: 'Вместе с сопротивлением крыла подобрано под опубликованное качество L/D ≈ 7 (тяга в полёте 0,7 Н).', min: 0.002, max: 0.04, step: 0.001 },
    { path: 'powerplant.losses', value: 1.94, label: 'Потери в моторе, редукторе и кривошипе', confidence: 'medium', origin: 'source',
      reason: 'КПД электропривода 0,34 — замер тормозом Прони в привязанном полёте (Send et al., ICAS 2012, рис. 5); в брошюре Festo — «около 45 %». Прежде было 0,6 — оценка.', min: 0, max: 3, step: 0.01 },
    { path: 'parts[wingR].mass', value: 0.05, unit: 'кг', label: 'Масса крыла', confidence: 'low', origin: 'estimated',
      reason: 'Углепластиковый лонжерон с плёнкой; общая масса 0,48 кг.', min: 0.01, max: 0.2, step: 0.005, linked: ['parts[wingL].mass'] },
  ],
);

// Ход законцовки ±1,0 м (Reichert 2011, рис. 12.17, расчёт для крыла «как построено») при полуразмахе 15,6 м.
// Машет внешняя панель от 6 м (у настоящего аппарата — изгибом лонжерона, здесь — на шарнире), ход законцовки тот же.
const SNOW_INNER = 6; // тяговые панели — от 6 м: там крепятся неподвижные растяжки (Reichert 2011, с. 148, 152)
const SNOW_AMP = (Math.asin(1.0 / (15.6 - SNOW_INNER)) * 180) / Math.PI;

export const snowbird: Spec = flapper(
  {
    // Силовой набор не задан. Устройство лонжерона не опубликовано, а крыло настоящего аппарата
    // поддерживают приводные тросы от фюзеляжа; модель же считает лонжерон консольным. Прежняя догадка
    // (коробка из однонаправленного углепластика со стенкой 4 мм) весила бы 43 кг на крыло — как весь
    // аппарат — и после исправления расчёта устойчивости всё равно оказалась на пределе.
    name: 'UTIAS Snowbird', notes: 'Махолёт на мускульной тяге: 43 кг, размах 32 м, крыло 29,2 м²; полёт 19,3 с со скоростью 7,1 м/с, 0,65 Гц; машут консоли от 6 м. Прочность не проверяется: устройство лонжерона не опубликовано, а крыло поддерживают приводные тросы, которых в модели нет.',
    bodyMass: 86.7, body: [3, 1.5, 0.8], dragArea: 0.12, halfSpan: 15.6, rootChord: 1.2, tipChord: 0.672, wingMass: 13.8,
    // c_l,max 1,55 — DT-HPO1 при ранней турбулизации (Reichert 2011, рис. 12.13); по XFOIL без неё 1,86. Остальное — оценки.
    airfoil: { name: 'профиль мускулолёта', cl0: 0.5, clAlpha: 5.7, clMax: 1.55, cd0: 0.012, k: 0.01, thickness: 0.13 },
    freqHz: 0.65, amplitudeDeg: SNOW_AMP, twistLimitDeg: 7, power: 650, losses: 0.05, cruiseSpeed: 7.1, seats: 1, innerSpan: SNOW_INNER,
  },
  [
    { path: 'parts[body].mass', value: 86.7, unit: 'кг', label: 'Пилот и гондола', confidence: 'high', origin: 'source',
      reason: 'Полётная масса 114,3 кг минус крыло 27,6 кг (Reichert 2011, табл. 12.1 и 12.3): пилот 70,8 кг, фюзеляж 14,7 кг, оперение 2,5 кг.', min: 50, max: 150, step: 0.1 },
    { path: 'parts[innerR].aero.rootChord', value: 1.2, unit: 'м', label: 'Корневая хорда', confidence: 'medium', origin: 'source',
      reason: 'Площадь крыла 29,2 м² при размахе 32 м: средняя хорда 0,94 м; сужение крыла — оценка.', min: 0.5, max: 2.5, step: 0.05, linked: ['parts[innerL].aero.rootChord'] },
    { path: 'actuators[flap].freqHz', value: 0.65, unit: 'Гц', label: 'Частота взмахов', confidence: 'high', origin: 'source',
      reason: 'Reichert 2011, табл. 12.1: 0,65 Гц, «что и наблюдалось в полёте». Прежние 0,83 Гц были пересказом из новостей («16 взмахов за 19,3 с»).', min: 0.2, max: 2, step: 0.01 },
    { path: 'actuators[flap].amplitudeDeg', value: +SNOW_AMP.toFixed(2), unit: '°', label: 'Размах взмаха', confidence: 'medium', origin: 'source',
      reason: 'Ход законцовки ±1,0 м (Reichert 2011, рис. 12.17, расчёт для построенного крыла). Машет внешняя панель от 6 м — у настоящего аппарата изгибом лонжерона, здесь на шарнире: ±1,0 м на 9,6 м — это ±6,0°. Прежде крыло махало целиком от корня, а размах (±4°) подбирался под оценку мощности пилота.', min: 0.5, max: 10, step: 0.05 },
    { path: 'parts[wingR].aero.feathering.maxDeg', value: 14, unit: '°', label: 'Наибольшее закручивание законцовки (полный ход)', confidence: 'medium', origin: 'source',
      reason: 'Reichert 2011, разд. 12.5.1: закрутка законцовки на взмахе ограничена ±7° (складки обшивки и устойчивость лонжерона). Прежде было ±45° — «с запасом над углом потока».', min: 0, max: 120, step: 1, linked: ['parts[wingL].aero.feathering.maxDeg'] },
    { path: 'powerplant.power', value: 650, unit: 'Вт', label: 'Мощность пилота на рабочем ходе', confidence: 'medium', origin: 'source',
      reason: 'Оценка самого пилота: 600–700 Вт на каждом рабочем ходе; в среднем за цикл меньше.', min: 100, max: 1000, step: 10 },
  ],
);
