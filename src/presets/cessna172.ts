// Cessna 172S Skyhawk — эталон для самолётов (ТЗ, раздел 12, уровень 2).
// Аппарат собран по его настоящим данным (data/research.md, часть 8): геометрия — сертификат типа EASA IM.A.051 и
// справочник Jane's; массы агрегатов — перечень оборудования POH 172S (рис. 6-9); центровка пустого самолёта — пример
// взвешивания POH (рис. 6-5: 1642 lb на 38,1 in). Чего нет в открытых данных — оценки, вынесены в допущения.
//
// Оси: x — вперёд, y — вверх, z — вправо. Начало по x — центр масс при максимальной взлётной массе 2550 lb (станция
// 42,6 in за плоскостью отсчёта — передней стенкой моторного щита): x = (42,6 in − станция)·0,0254.
// Высота: ось фюзеляжа FY над землёй; крыло на 0,73 м выше, стабилизатор на 0,28 м (как в модели mscsim по чертежам).
import type { Spec, AeroSurface } from '../core/spec.ts';

const FY = 1.2; // ось фюзеляжа (и высота центра масс) над землёй, м
const IN = 0.0254;
const X = (station: number) => (42.6 - station) * IN;
const LB = 0.45359237;

// Эффективность закрылка (руля, элерона) по теории тонкого профиля: τ = 1 − (θf − sin θf)/π, θf = arccos(2·c_f/c − 1).
const tau = (cf: number) => {
  const t = Math.acos(2 * cf - 1);
  return 1 - (t - Math.sin(t)) / Math.PI;
};
// Элероны: 18,3 ft² на оба (Jane's), размах от 2,10 до 5,41 м от оси — хорда 0,257 м, c_f/c ≈ 0,185 (по средней хорде
// участка) → τ = 0,53. Отклонения (сертификат типа): вверх 20°, вниз 15° — дифференциальные, канал — угол поднятого элерона.
const TAU_A = tau(0.185);
// Руль высоты: 14,53 ft² из 36,09 ft² горизонтального оперения (Jane's), c_f/c ≈ 0,40 → τ = 0,75. Вверх 28°, вниз 23°.
const TAU_E = tau(14.53 / 36.09);
// Руль направления: 7,43 ft² из 18,67 ft² (киль 11,24 + руль, Jane's) → τ = 0,75. По 16° в каждую сторону (параллельно
// строительной горизонтали, сертификат типа).
const TAU_R = tau(7.43 / 18.67);
// Линейная теория: при больших отклонениях настоящий руль слабее (поток срывается с отклонённой части) — в модели нет.

const naca2412 = { name: 'NACA 2412', cl0: 0.23, clAlpha: 5.9, clMax: 1.55, cd0: 0.0075, k: 0.006, thickness: 0.12 };
const naca0009 = { name: 'NACA 0009', cl0: 0, clAlpha: 5.7, clMax: 1.1, cd0: 0.008, k: 0.008, thickness: 0.09 };

// Крыло: размах 11,0 м (36,08 ft), площадь 16,2 м² (174 ft²), хорда у корня 1,626 м (5 ft 4 in), у законцовки 1,130 м
// (3 ft 8,5 in), поперечное V 1,73° (1°44′), установка +1,5° у корня и −1,5° у законцовки (Jane's). Крыло прямоугольное до
// излома и трапециевидное за ним; излом там, где сходится площадь: 1,626·y + (5,5 − y)·1,378 = 8,1 → y = 2,10 м — там же
// начинаются элероны. Консоль — от оси самолёта (крыло высокоплана проходит над кабиной): 0,05…5,5 м.
// Удлинение — по всему крылу: b²/S = 11,0²/16,2 = 7,47. Лонжерон — эквивалентный коробчатый (у настоящего крыла есть подкос;
// устройство в открытых данных не описано), масса крыла — по весовой сводке Торенбека для 172 (236 lb на оба).
const WING_ROOT_Z = 0.05;
const WING_SPAN = 5.5 - WING_ROOT_Z;
const BREAK = (2.1 - WING_ROOT_Z) / WING_SPAN;
const wing = (side: 1 | -1): AeroSurface => ({
  side, span: WING_SPAN, rootChord: 1.626, tipChord: 1.13, planform: [[0, 1.626], [BREAK, 1.626], [1, 1.13]],
  incidenceDeg: 1.5, twistDeg: -3, dihedralDeg: 1.73, airfoil: naca2412, sections: 16, induced: 'wing', aspectRatio: 7.47, role: 'main',
  control: side === 1
    ? { channel: 'roll', deg: -TAU_A, degNeg: -TAU_A * 0.75, from: BREAK, to: (5.41 - WING_ROOT_Z) / WING_SPAN }
    : { channel: 'roll', deg: TAU_A * 0.75, degNeg: TAU_A, from: BREAK, to: (5.41 - WING_ROOT_Z) / WING_SPAN },
});
// Горизонтальное оперение: размах 3,45 м (11 ft 4 in), площадь 3,353 м² (21,56 + 14,53 ft², Jane's); хорды 1,2 и 0,8 м
// (оценка по чертежу, сходится с площадью); установка −3° (у Cessna 182 того же семейства, NASA CR-1975, рис. 82a).
// Плечо от фокуса крыла 4,79 м (JSBSim c172p: 15,7 ft).
const tail = (side: 1 | -1): AeroSurface => ({
  side, span: 1.675, rootChord: 1.2, tipChord: 0.8, incidenceDeg: -3, airfoil: naca0009,
  sections: 8, induced: 'wing', aspectRatio: 3.45 ** 2 / 3.353, role: 'tail', control: { channel: 'pitch', deg: -TAU_E },
});
// Киль с рулём: 1,734 м² (18,67 ft²); высота над хвостовой частью фюзеляжа 1,27 м (общая высота самолёта 2,72 м); хорды
// 1,85 и 0,88 м (сходится с площадью), стреловидность по четвертям хорд 28° (оценка по чертежу). Фюзеляж и стабилизатор
// у корня работают как стенка (зеркало): удлинение 2·b²/S = 1,86 — верхняя оценка, допущение.
const fin: AeroSurface = {
  side: 1, span: 1.27, rootChord: 1.85, tipChord: 0.88, sweepDeg: 28, incidenceDeg: 0, airfoil: naca0009,
  sections: 8, induced: 'wing', aspectRatio: (2 * 1.27 ** 2) / 1.734, role: 'tail', control: { channel: 'yaw', deg: TAU_R },
};

// Винт McCauley 1A170E/JHA7660: две лопасти, фиксированный шаг, D = 76 in (POH, стр. 1-4), шаг 60 in — по обозначению
// «7660» (диаметр 76, шаг 60 in; у McCauley шаг отсчитывается на 75 % радиуса). Геометрия лопасти не опубликована,
// поэтому всё остальное — оценки для кованой алюминиевой лопасти лёгкого самолёта, выбранные до сверки с POH и под неё
// не подбиравшиеся: шаг постоянный по радиусу; лопасть от 0,2R (обтекатель втулки); хорда 0,10 м у корня, 0,125 м
// на 0,4–0,6R, к концу 0,05 м (активность лопасти AF ≈ 80; у винтов лёгких самолётов обычно 80–100); профиль типа Clark Y,
// c_l0 0,36 от плоской стороны (нулевая подъёмная сила при −3,6°), наклон 5,7 на радиан, c_l,max 1,3, c_d0 0,008.
// Момент инерции винта с коленвалом — 1,5 кг·м² (оценка; на установившиеся режимы не влияет).
const prop = {
  blades: 2, pitch: 60 * 0.0254, hubFrac: 0.2,
  chord: [[0.2, 0.1], [0.4, 0.125], [0.6, 0.125], [0.8, 0.11], [0.95, 0.08], [1, 0.05]] as [number, number][],
  airfoil: { name: 'Clark Y (оценка)', cl0: 0.36, clAlpha: 5.7, clMax: 1.3, cd0: 0.008, k: 0.006, thickness: 0.09 },
  inertia: 1.5,
};

// Эквивалентный коробчатый лонжерон (оценка).
// Для флаттера — кессон и подкос. Всё это оценки: положения лонжеронов по хорде и толщины обшивки в открытых данных нет
// (руководство Cessna по ремонту конструкции SESR04 даёт только материалы: обшивка — 2024-T3), жёсткостей крыла и
// замеров частот нет. Передний лонжерон — на 20 % хорды, задний — на 65 % (обычно у двухлонжеронного крыла лёгкого
// самолёта), обшивка 0,020 in (у лёгких самолётов 0,016–0,025 in). Подкос — к переднему лонжерону на 2,6 м от оси
// самолёта (оценка по виду сбоку); корень крыла — шарнир (крыло держится на подкосе).
const spar = {
  section: 'box' as const, material: 'al7075', widthFrac: 0.08, heightFrac: 0.9, wall: 0.0055, skinArealMass: 4,
  sparAt: 0.2, torsionBox: { from: 0.2, to: 0.65, skin: 0.020 * 0.0254 }, strut: { at: (2.6 - 0.05) / 5.45, chordAt: 0.2 },
};

// Массы. Пустой самолёт — 1642 lb на станции 38,1 in (POH, рис. 6-5). Из перечня оборудования POH (рис. 6-9):
// мотор с установкой 297,8 lb на −18,6 in, винт 38,8 на −38,2, кок 1,8 на −41,0, генератор 10 на −29 → 348,4 lb на −21,2 in;
// аккумулятор 23,2 на −5; передние кресла 2×34,3 на 41,5, заднее 43,3 на 79,5; основные колёса с тормозами 34,4 на 57,8,
// обтекатели колёс 16,5 на 46,1; носовое колесо 9,5 на −6,8. По весовой сводке Торенбека для 172 (через McIver, 2003):
// крыло 236 lb, оперение 61, фюзеляж 253, шасси 122 (из них стойка с колесом носовой опоры — 32 lb, оценка).
// Оболочка фюзеляжа (253 lb) поделена по поверхности: носовая часть с кабиной 175 lb, хвостовая 78 lb (оценка).
// Остальное (470 lb: системы, приборы, отделка, капот, выхлоп, тяги управления, невырабатываемое топливо) — одним
// блоком на станции, при которой центровка пустого самолёта совпадает с POH; вместе с аккумулятором — 493,2 lb на 22,3 in.
// Крыло в модели несёт массу на линии четвертей хорд (станция 40,6 in), разница учтена в этом блоке.
// Нагрузка (POH, рис. 6-3): двое впереди — 340 lb на 37 in, сзади 250 lb на 73 in, топливо 53 галлона по 6 lb — на 48 in;
// всего 2550 lb на 42,6 in. Топливо — в баках крыла, центр бака по размаху 1,6 м от оси (оценка).
export const cessna172: Spec = {
  schema: 1,
  meta: { name: 'Cessna 172S Skyhawk', class: 'fixed-wing', source: 'preset', notes: 'Собран по настоящим данным: геометрия, рули, массы агрегатов. Эталон сваливания, крейсера, фугоиды и спирали.' },
  environment: { name: 'Земля, МСА', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
  parts: [
    // Носовая часть с кабиной: эллипсоид того же объёма, что капот и кабина (около 3,8 м³), от кока (станция −41 in) назад.
    // Землю касается только шасси.
    { id: 'fuselage', name: 'Фюзеляж: капот и кабина', kind: 'body', position: [X(-41) - 2.275, FY, 0],
      shape: { type: 'ellipsoid', size: [4.55, 1.33, 1.2] }, mass: 175 * LB, dragArea: 0.3, collides: false },
    { id: 'wingR', name: 'Правое крыло', kind: 'wing', position: [X(40.6), FY + 0.73, WING_ROOT_Z], aero: wing(1), structure: spar, mass: 118 * LB },
    { id: 'wingL', name: 'Левое крыло', kind: 'wing', position: [X(40.6), FY + 0.73, -WING_ROOT_Z], aero: wing(-1), structure: spar, mass: 118 * LB },
    { id: 'tailcone', name: 'Хвостовая часть фюзеляжа', kind: 'body', position: [-3.75, FY + 0.05, 0],
      shape: { type: 'ellipsoid', size: [4.7, 0.75, 0.6] }, mass: 78 * LB, dragArea: 0.06, collides: false },
    { id: 'tailR', name: 'Стабилизатор и руль высоты, правая половина', kind: 'wing', position: [X(40.6) - 4.79, FY + 0.28, 0.05], aero: tail(1), mass: 8.2 },
    { id: 'tailL', name: 'Стабилизатор и руль высоты, левая половина', kind: 'wing', position: [X(40.6) - 4.79, FY + 0.28, -0.05], aero: tail(-1), mass: 8.2 },
    { id: 'fin', name: 'Киль и руль направления', kind: 'wing', position: [-4.45, FY + 0.35, 0], rotation: [-90, 0, 0], aero: fin, mass: 11.3 },
    { id: 'engine', name: 'Мотор с винтом и генератором', kind: 'body', position: [X(-21.19), FY, 0], shape: { type: 'box', size: [0.8, 0.6, 0.85] }, mass: 348.4 * LB, collides: false },
    { id: 'systems', name: 'Системы, приборы, отделка, аккумулятор', kind: 'body', position: [X(22.35), FY - 0.1, 0], shape: { type: 'box', size: [1.4, 0.8, 1.0] }, mass: 493.2 * LB, collides: false },
    { id: 'seats', name: 'Кресла', kind: 'body', position: [X(56.2), FY - 0.3, 0], shape: { type: 'box', size: [1.4, 0.4, 1.0] }, mass: 111.9 * LB, collides: false },
    { id: 'occFront', name: 'Пилот и пассажир впереди', kind: 'body', position: [X(37), FY, 0], shape: { type: 'box', size: [0.5, 0.9, 0.9] }, mass: 340 * LB, collides: false },
    { id: 'occRear', name: 'Пассажиры сзади', kind: 'body', position: [X(73), FY, 0], shape: { type: 'box', size: [0.5, 0.9, 0.9] }, mass: 250 * LB, collides: false },
    { id: 'fuelR', name: 'Топливо в правом крыле', kind: 'body', position: [X(48), FY + 0.73, 1.6], shape: { type: 'box', size: [0.8, 0.15, 1.5] }, mass: 159 * LB, collides: false },
    { id: 'fuelL', name: 'Топливо в левом крыле', kind: 'body', position: [X(48), FY + 0.73, -1.6], shape: { type: 'box', size: [0.8, 0.15, 1.5] }, mass: 159 * LB, collides: false },
    { id: 'noseGear', kind: 'gear', position: [X(-6.8), 0.2, 0], shape: { type: 'sphere', size: [0.4, 0.4, 0.4] }, mass: 32 * LB, friction: 0.03 },
    // Колея основных опор 2,54 м (8 ft 4 in); стойки, колёса, тормоза и обтекатели — 106,5 lb на 56,0 in.
    { id: 'mainGearR', kind: 'gear', position: [X(56), 0.2, 1.27], shape: { type: 'sphere', size: [0.4, 0.4, 0.4] }, mass: 53.25 * LB, friction: 0.03 },
    { id: 'mainGearL', kind: 'gear', position: [X(56), 0.2, -1.27], shape: { type: 'sphere', size: [0.4, 0.4, 0.4] }, mass: 53.25 * LB, friction: 0.03 },
  ],
  joints: [
    { id: 'jwR', type: 'fixed', parent: 'fuselage', child: 'wingR' },
    { id: 'jwL', type: 'fixed', parent: 'fuselage', child: 'wingL' },
    { id: 'jtc', type: 'fixed', parent: 'fuselage', child: 'tailcone' },
    { id: 'jtR', type: 'fixed', parent: 'tailcone', child: 'tailR' },
    { id: 'jtL', type: 'fixed', parent: 'tailcone', child: 'tailL' },
    { id: 'jfin', type: 'fixed', parent: 'tailcone', child: 'fin' },
    { id: 'jeng', type: 'fixed', parent: 'fuselage', child: 'engine' },
    { id: 'jsys', type: 'fixed', parent: 'fuselage', child: 'systems' },
    { id: 'jseat', type: 'fixed', parent: 'fuselage', child: 'seats' },
    { id: 'jocF', type: 'fixed', parent: 'fuselage', child: 'occFront' },
    { id: 'jocR', type: 'fixed', parent: 'fuselage', child: 'occRear' },
    { id: 'jfuR', type: 'fixed', parent: 'wingR', child: 'fuelR' },
    { id: 'jfuL', type: 'fixed', parent: 'wingL', child: 'fuelL' },
    { id: 'jgN', type: 'fixed', parent: 'fuselage', child: 'noseGear' },
    { id: 'jgR', type: 'fixed', parent: 'fuselage', child: 'mainGearR' },
    { id: 'jgL', type: 'fixed', parent: 'fuselage', child: 'mainGearL' },
  ],
  actuators: [
    // Lycoming вращает винт по часовой стрелке, если смотреть из кабины: реактивный момент кренит самолёт влево.
    { id: 'prop', type: 'propeller', part: 'engine', axis: [1, 0, 0], diameter: 1.93, efficiency: 0.85, channel: 'throttle', fixedPitch: prop, spin: 1 },
  ],
  // Lycoming IO-360-L2A: сертификат типа EASA.IM.E.032 (Issue 03, 2022, разд. 6 «Ratings», полный газ у земли) —
  // 119 кВт (160 hp) при 2400 об/мин и 134 кВт (180 hp) при 2700 об/мин: момент одинаковый (474 Н·м).
  // Мотор — по руководству Lycoming (60297-12): 180 л. с. при 2700 об/мин на полном газе у земли; падение с высотой —
  // по графику рис. 3-25 (k = 1,04); удельный расход — рис. 3-9, смесь между наивыгоднейшей и наибольшей мощности (0,5 —
  // «recommended lean» POH лежит между ними). Топливо: 53 галлона, которые можно выработать (POH, разд. 2), по 6 lb/gal.
  powerplant: { power: 134e3, lapse: 'piston', ratedRpm: 2700, note: 'Lycoming IO-360-L2A, 180 л. с. при 2700 об/мин',
    engine: { type: 'piston', fullThrottleSL: 134.2e3, lapseK: 1.04, mixture: 0.5, fuelKg: 53 * 6 * LB } },
  // Кресло пилота — слева впереди (станция 37 in), в осях носовой части фюзеляжа.
  crew: { part: 'fuselage', seats: [[X(37) - (X(-41) - 2.275), 0, -0.28]] },
  controls: [
    { channel: 'throttle', label: 'Газ', role: 'throttle', min: 0, max: 1, initial: 0 },
    { channel: 'pitch', label: 'Руль высоты, ° (задняя кромка вверх — нос вверх, +)', role: 'pitch', min: -23, max: 28, initial: 0 },
    { channel: 'roll', label: 'Элероны, ° (правый вверх — крен вправо, +)', role: 'roll', min: -20, max: 20, initial: 0 },
    { channel: 'yaw', label: 'Руль направления, ° (вправо — нос вправо, +)', role: 'yaw', min: -16, max: 16, initial: 0 },
  ],
  limits: { loadFactor: 3.8 },
  assumptions: [
    { path: 'parts[fuselage].dragArea', value: 0.3, unit: 'м²', label: 'Вредное сопротивление носовой части, кабины и шасси', confidence: 'medium', origin: 'estimated',
      reason: 'Типичная эквивалентная площадь лёгкого самолёта с неубирающимся шасси (вместе с хвостовой частью 0,36 м²).', min: 0.08, max: 0.9, step: 0.01 },
    { path: 'parts[wingR].structure.wall', value: 0.0055, unit: 'м', label: 'Стенка лонжерона', confidence: 'low', origin: 'estimated',
      reason: 'Устройство крыла (с подкосом) в открытых данных не описано; лонжерон — эквивалентный консольный.', min: 0.001, max: 0.02, step: 0.0005, linked: ['parts[wingL].structure.wall'] },
    { path: 'parts[wingR].structure.torsionBox.skin', value: 0.020 * 0.0254, unit: 'м', label: 'Обшивка кессона крыла', confidence: 'low', origin: 'estimated',
      reason: 'Толщины обшивки в открытых данных нет; у лёгких самолётов — 0,016–0,025 in (2024-T3). Влияет на флаттер и дивергенцию.', min: 0.0003, max: 0.0008, step: 0.00005,
      linked: ['parts[wingL].structure.torsionBox.skin'] },
    { path: 'parts[wingR].structure.strut.at', value: (2.6 - 0.05) / 5.45, label: 'Крепление подкоса, доля размаха консоли', confidence: 'low', origin: 'estimated',
      reason: 'Оценка по виду сбоку: около 2,6 м от оси самолёта. Влияет на частоты крыла и флаттер.', min: 0.3, max: 0.7, step: 0.01,
      linked: ['parts[wingL].structure.strut.at'] },
    { path: 'parts[occFront].mass', value: 340 * LB, unit: 'кг', label: 'Пилот и пассажир впереди', confidence: 'high', origin: 'source',
      reason: 'Пример загрузки POH (рис. 6-5): 340 lb.', min: 0, max: 250, step: 1 },
    { path: 'parts[occRear].mass', value: 250 * LB, unit: 'кг', label: 'Пассажиры сзади', confidence: 'high', origin: 'source',
      reason: 'Пример загрузки POH (рис. 6-5): 250 lb — до максимальной взлётной массы 2550 lb.', min: 0, max: 200, step: 1 },
    { path: 'parts[fuelR].mass', value: 159 * LB, unit: 'кг', label: 'Топливо в одном крыле', confidence: 'high', origin: 'source',
      reason: '53 галлона на оба бака по 6 lb/gal (POH).', min: 0, max: 72.2, step: 0.5, linked: ['parts[fuelL].mass'] },
    { path: 'parts[tailR].aero.incidenceDeg', value: -3, unit: '°', label: 'Установка стабилизатора', confidence: 'medium', origin: 'source',
      reason: 'У Cessna 182 того же семейства −3° (NASA CR-1975); у 172 не опубликована.', min: -6, max: 0, step: 0.25, linked: ['parts[tailL].aero.incidenceDeg'] },
    { path: 'parts[fin].aero.aspectRatio', value: (2 * 1.27 ** 2) / 1.734, label: 'Действующее удлинение киля', confidence: 'low', origin: 'estimated',
      reason: 'Фюзеляж и стабилизатор у корня киля — как стенка (удвоенное удлинение); у настоящего самолёта меньше: стенка короткая.', min: 0.9, max: 1.9, step: 0.05 },
    { path: 'actuators[prop].fixedPitch.pitch', value: 60 * 0.0254, unit: 'м', label: 'Шаг винта', confidence: 'medium', origin: 'source',
      reason: 'По обозначению McCauley 1A170E/JHA7660: диаметр 76 in, шаг 60 in. Распределение шага по лопасти не опубликовано.', min: 1.2, max: 1.8, step: 0.01 },
    { path: 'actuators[prop].fixedPitch.airfoil.cl0', value: 0.36, label: 'Подъёмная сила профиля лопасти при нулевом угле', confidence: 'low', origin: 'estimated',
      reason: 'Профиль лопасти не опубликован; взят профиль типа Clark Y с отсчётом угла от плоской стороны.', min: 0.2, max: 0.5, step: 0.01 },
  ],
};
