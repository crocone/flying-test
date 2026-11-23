// Квадрокоптер массой около 1,4 кг (по открытым данным DJI Phantom 4) — эталон
// для малых винтов. Геометрия лопасти и обороты — оценки; электрическая мощность
// пересчитывается из мощности на валах через КПД моторов и регуляторов.
import type { Spec, Part, Joint, Actuator } from '../core/spec.ts';

const BODY_Y = 0.2;
const ARM = 0.1237; // половина диагонали 350 мм по каждой оси
const blade = (id: string, hub: [number, number, number], z: number, side: 1 | -1, rot: number): Part => ({
  id, kind: 'blade', position: [hub[0], hub[1], hub[2] + z], rotation: [0, rot, 0], mass: 0.006,
  aero: {
    side, span: 0.1, rootChord: 0.028, tipChord: 0.014, incidenceDeg: 20, twistDeg: -12, sections: 8,
    // Профильное сопротивление — исходная оценка. Его временно поднимали до 0,03, когда
    // в модели винта не было поправки κ на неравномерный поток; с κ вернули 0,02.
    airfoil: { name: 'тонкий профиль малых чисел Re', cl0: 0.3, clAlpha: 5.0, clMax: 1.2, cd0: 0.02, k: 0.02, thickness: 0.1 },
  },
});

const rotors = [
  { id: 'fr', x: ARM, z: ARM, dir: 1 as const },
  { id: 'rl', x: -ARM, z: -ARM, dir: 1 as const },
  { id: 'fl', x: ARM, z: -ARM, dir: -1 as const },
  { id: 'rr', x: -ARM, z: ARM, dir: -1 as const },
];
const parts: Part[] = [
  { id: 'body', name: 'Корпус с батареей и камерой', kind: 'body', position: [0, BODY_Y, 0], shape: { type: 'box', size: [0.2, 0.08, 0.2] }, mass: 1.292, dragArea: 0.01 },
];
const joints: Joint[] = [];
const actuators: Actuator[] = [];
for (const r of rotors) {
  const hub: [number, number, number] = [r.x, BODY_Y + 0.05, r.z];
  parts.push({ id: `hub-${r.id}`, kind: 'hub', position: hub, shape: { type: 'cylinder', size: [0.03, 0.02, 0.03] }, mass: 0.01 });
  // Против часовой (dir = 1): передняя кромка по ходу вращения — обычная лопасть.
  // По часовой: зеркальная лопасть (side = −1, поворот на 180° вокруг вертикали).
  const b1 = r.dir === 1 ? blade(`b1-${r.id}`, hub, 0.02, 1, 0) : blade(`b1-${r.id}`, hub, 0.02, -1, 180);
  const b2 = r.dir === 1 ? blade(`b2-${r.id}`, hub, -0.02, 1, 180) : blade(`b2-${r.id}`, hub, -0.02, -1, 0);
  parts.push(b1, b2);
  joints.push(
    { id: `m-${r.id}`, type: 'revolute', parent: 'body', child: `hub-${r.id}`, axis: [0, 1, 0] },
    { id: `f1-${r.id}`, type: 'fixed', parent: `hub-${r.id}`, child: b1.id },
    { id: `f2-${r.id}`, type: 'fixed', parent: `hub-${r.id}`, child: b2.id },
  );
  actuators.push({ id: `motor-${r.id}`, type: 'spinner', joint: `m-${r.id}`, rpm: 6500, direction: r.dir, rampTime: 2, channel: 'rpm' });
}

export const quadcopter: Spec = {
  schema: 1,
  meta: { name: 'Квадрокоптер 1,4 кг (по данным DJI Phantom 4)', class: 'rotor', source: 'preset', notes: 'Эталон для проверки мощности висения малых винтов.' },
  environment: { name: 'Земля, МСА', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
  parts,
  joints,
  actuators,
  // Батарея — по руководству DJI Phantom 4 (v1.2, с. 60–61): LiPo 4S, 5350 мА·ч, 15,2 В, 81,3 Вт·ч, 462 г (входит в массу корпуса).
  powerplant: { power: 600, losses: 0.33, note: 'Электромоторы; losses — КПД моторов и регуляторов около 0,75',
    engine: { type: 'electric', batteryWh: 81.3, cells: 4, capacityAh: 5.35 } },
  crew: { part: 'body', seats: [[0, 0, 0]], unmanned: true },
  controls: [{ channel: 'rpm', label: 'Обороты моторов, доля от 6500', role: 'lift', min: 0.4, max: 1.4, initial: 0.9, gain: 0.03 }],
  assumptions: [
    { path: 'powerplant.losses', value: 0.33, label: 'Потери в моторах и регуляторах', confidence: 'medium', origin: 'estimated',
      reason: 'КПД бесколлекторного мотора с регулятором около 0,75.', min: 0, max: 1, step: 0.01 },
    { path: 'parts[b1-fr].aero.incidenceDeg', value: 20, unit: '°', label: 'Угол установки лопасти у корня', confidence: 'low', origin: 'estimated',
      reason: 'Шаг пропеллера около 4,5 дюйма.', min: 5, max: 35, step: 0.5,
      linked: rotors.flatMap((r) => [`parts[b1-${r.id}].aero.incidenceDeg`, `parts[b2-${r.id}].aero.incidenceDeg`]) },
  ],
};
