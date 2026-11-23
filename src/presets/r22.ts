// Robinson R22 Beta II — эталон для несущего винта (ТЗ, раздел 12, уровень 2).
// Масса, диаметр и хорда винта, обороты, мощность — открытые данные (data/research.md).
// Масса лопастей, их силовой набор и доля мощности на хвостовой винт — оценки.
import type { Spec, Part } from '../core/spec.ts';
import { KORN_6SERIES } from '../core/aero.ts';
import { NACA0012, NACA632015 } from '../core/polar-data.ts';

const HUB_Y = 2.72; // втулка над землёй, вертолёт на полозьях: 107 in по трём видам POH (было 2,34 — оценка)
const ROOT = 0.45; // вырез у втулки
const R = 3.835;
const blade = (id: string, z: number, rot: number): Part => ({
  id, name: `Лопасть ${id.slice(-1)}`, kind: 'blade', position: [0, HUB_Y, z], rotation: [0, rot, 0], mass: 13,
  aero: {
    // Конусность (dihedralDeg) — построенная форма: лопасть на шарнире взмаха (flapping у винта), и в полёте конусность
    // устанавливается сама.
    side: 1, span: R - ROOT, rootChord: 0.183, tipChord: 0.183, incidenceDeg: 0, twistDeg: -8, dihedralDeg: 2, sections: 12,
    // M_dd — числа Корна для 6-й серии (aero.ts); сверены с винтом NACA 63₂-015 на вышке Langley (TN 3850), не с R22.
    // Поляра — табличная, по продувкам гладкого 63₂-015 (Report 824) при числе Рейнольдса сечения; числа ниже — сводка.
    airfoil: { name: 'NACA 63-015', cl0: 0, clAlpha: 5.9, clMax: 1.3, cd0: 0.008, k: 0.006, thickness: 0.15, dragRise: KORN_6SERIES, polar: NACA632015 },
    control: { channel: 'collective', deg: 1 },
  },
  // Стальной D-образный лонжерон в носке лопасти — как эквивалентная коробка 40 % хорды.
  structure: { section: 'box', material: 'steel4340', widthFrac: 0.4, heightFrac: 0.9, wall: 0.004, skinArealMass: 0, filled: true }, // за лонжероном — соты
});

export const r22: Spec = {
  schema: 1,
  meta: { name: 'Robinson R22 Beta II', class: 'rotor', source: 'preset', notes: 'Эталон для проверки мощности на висении.' },
  environment: { name: 'Земля, МСА', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
  parts: [
    // Кабина с двигателем: высота 69 in от низа полозьев (POH), ширина 44 in; центр — под осью винта (центровка).
    { id: 'fuselage', name: 'Кабина, двигатель, экипаж', kind: 'body', position: [0, 0.95, 0],
      shape: { type: 'ellipsoid', size: [3.2, 1.6, 1.1] }, mass: 550, dragArea: 0.59 },
    // Хвостовая балка — до оси хвостового винта (172 in от оси несущего); диаметр около 0,2 м и масса — оценки.
    { id: 'boom', name: 'Хвостовая балка', kind: 'body', position: [-2.8, 1.5, 0], shape: { type: 'ellipsoid', size: [3.2, 0.2, 0.2] },
      mass: 25, dragArea: 0.01, collides: false },
    { id: 'hub', name: 'Втулка', kind: 'hub', position: [0, HUB_Y, 0], shape: { type: 'cylinder', size: [0.4, 0.3, 0.4] }, mass: 20 },
    blade('blade1', ROOT, 0),
    blade('blade2', -ROOT, 180),
  ],
  joints: [
    { id: 'mast', type: 'revolute', parent: 'fuselage', child: 'hub', axis: [0, 1, 0] },
    { id: 'jboom', type: 'fixed', parent: 'fuselage', child: 'boom' },
    { id: 'jb1', type: 'fixed', parent: 'hub', child: 'blade1' },
    { id: 'jb2', type: 'fixed', parent: 'hub', child: 'blade2' },
  ],
  // Хвостовой винт — по POH (разд. 1, описание): 2 лопасти, диаметр 42 in, хорда 4 in постоянная, без крутки, концевая
  // скорость 622 ft/s при 104 % — 3394 об/мин. Плечо от оси несущего до оси хвостового — 172 in по трём видам POH
  // (радиус 151 in + половина диска хвостового 21 in), ±3 in. Профиль лопасти не опубликован: симметричный, как NACA 0012
  // при Re 1,3·10⁶ (оценка).
  // Втулка качающаяся (POH, разд. 1 и 7: лопасти на шарнирах конусности, втулка на общем горизонтальном шарнире) —
  // в модели качание диска как целого; конусность — постоянная (допущение). Вращение — против часовой стрелки, если
  // смотреть сверху (наступающая лопасть справа). Циклический шаг — от автомата перекоса; обгонная муфта — авторотация.
  actuators: [{ id: 'rotor', type: 'spinner', joint: 'mast', rpm: 530, direction: 1, rampTime: 4,
    flapping: true, cyclic: { cos: 'cyclicLat', sin: 'cyclicLon' }, freewheel: 'freewheel',
    tailRotor: { radius: 0.5334, blades: 2, chord: 0.1016, rpm: 3394, arm: 4.37, rootFrac: 0.2,
      airfoil: { name: 'симметричный, как NACA 0012', cl0: 0, clAlpha: 5.7, clMax: 1.2, cd0: 0.009, k: 0.006, thickness: 0.12, polar: NACA0012 } } }],
  // Двигатель дросселирован с 180 до 131 л. с. и держит эту мощность до высот висения — падения с высотой нет.
  // Мотор O-360-J2A дросселирован: разрешено 131 л. с. на взлёте. Полный газ у земли при 2700 об/мин — около 180 л. с.:
  // так ложится график Lycoming рис. 3-41 (145 л. с. до 5 800 ft, 133,9 на 8 000, 124,1 на 10 000 ft) при k = 1,10.
  // Поэтому 131 л. с. доступны примерно до 8 500 ft стандартной атмосферы, выше мощность падает.
  powerplant: { power: 97.7e3, losses: 0.05, lapse: 'piston', note: 'Lycoming O-360-J2A: взлётная 131 л. с. (5 мин), длительная 124 л. с.',
    engine: { type: 'piston', fullThrottleSL: 180 * 745.7, lapseK: 1.1, mixture: 1 } },
  crew: { part: 'fuselage', seats: [[0.6, 0.1, 0.3]] },
  controls: [
    { channel: 'collective', label: 'Общий шаг, °', role: 'lift', min: 0, max: 18, initial: 12, gain: 0.4 },
    { channel: 'cyclicLon', label: 'Продольный циклический шаг, ° (− — диск вперёд)', role: 'pitch', min: -12, max: 12, initial: 0 },
    { channel: 'cyclicLat', label: 'Поперечный циклический шаг, ° (+ — диск влево)', role: 'roll', min: -8, max: 8, initial: 0 },
  ],
  assumptions: [
    { path: 'powerplant.losses', value: 0.05, label: 'Потери в трансмиссии (ремни, главный и хвостовой редукторы), доля мощности', confidence: 'low', origin: 'estimated',
      reason: 'КПД трансмиссии вертолёта обычно 0,95–0,97; у R22 ещё клиновые ремни. Хвостовой винт теперь считается отдельно, по его размерам. Вентилятор охлаждения мотора не учтён.', min: 0, max: 0.2, step: 0.005 },
    { path: 'parts[blade1].aero.dihedralDeg', value: 2, unit: '°', label: 'Конусность лопастей', confidence: 'medium', origin: 'estimated',
      reason: 'Лопасти на шарнирах конусности: конусность в полёте устанавливается сама (центробежная сила против тяги). Число — только построенная форма, от которой отсчитывается взмах.', min: 0, max: 6, step: 0.1,
      linked: ['parts[blade2].aero.dihedralDeg'] },
    { path: 'parts[blade1].aero.airfoil.surface', value: 0.5, label: 'Поверхность лопастей: 0 — гладкая, как в трубе; 1 — со стандартной шероховатостью', confidence: 'low', origin: 'estimated',
      reason: 'Металлические клеёные лопасти; насколько их поверхность хуже гладкой модели в трубе — не измерено. От этого мощность висения меняется примерно на 12 %.', min: 0, max: 1, step: 0.05,
      linked: ['parts[blade2].aero.airfoil.surface'] },
    { path: 'parts[blade1].mass', value: 13, unit: 'кг', label: 'Масса лопасти', confidence: 'low', origin: 'estimated',
      reason: 'Стальной лонжерон с алюминиевой обшивкой длиной 3,4 м.', min: 5, max: 40, step: 0.5, linked: ['parts[blade2].mass'] },
  ],
};
