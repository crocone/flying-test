// Орнитоптер «в масштабе фильма». Все размеры и массы — оценки: в первоисточнике
// их нет, поэтому каждая вынесена в допущения и правится ползунками.
import type { Spec, Part, Joint } from '../core/spec.ts';

const FUSE_Y = 7;
const roots = [
  { x: 4.5, n: 1, group: 'front' },
  { x: 2.8, n: 2, group: 'front' },
  { x: -2.8, n: 3, group: 'rear' },
  { x: -4.5, n: 4, group: 'rear' },
];

const parts: Part[] = [
  {
    id: 'fuselage', name: 'Корпус', kind: 'body', position: [0, FUSE_Y, 0],
    shape: { type: 'ellipsoid', size: [16, 3, 3] }, mass: 8000, dragArea: 4,
  },
];
const joints: Joint[] = [];
const wingIds: string[] = [];
for (const side of [-1, 1] as const) {
  for (const r of roots) {
    const id = `${side < 0 ? 'L' : 'R'}${r.n}`;
    wingIds.push(id);
    parts.push({
      id, name: `Крыло ${side < 0 ? 'Л' : 'П'}${r.n}`, kind: 'wing', position: [r.x, FUSE_Y + 0.6, side * 1.5],
      aero: {
        side, span: 10, rootChord: 1.2, tipChord: 1.2, incidenceDeg: 0, sections: 12, induced: 'none', addedMass: true,
        airfoil: { name: 'тонкая пластина с изгибом', cl0: 0.1, clMax: 1.1, cd0: 0.02, k: 0.02, thickness: 0.12 },
        feathering: { channel: 'feather', maxDeg: 90, actuator: 'flap' },
      },
      structure: { section: 'box', material: 'cfrp', widthFrac: 0.25, heightFrac: 1, wall: 0.01, skinArealMass: 10 },
    });
    joints.push({ id: `hinge-${id}`, type: 'revolute', parent: 'fuselage', child: id, axis: [1, 0, 0] });
  }
}

const allWings = (field: string) => wingIds.map((w) => `parts[${w}].${field}`);

export const ornithopter: Spec = {
  schema: 1,
  meta: {
    name: 'Орнитоптер (по мотивам «Дюны»)',
    class: 'flapping',
    source: 'preset',
    notes: 'Восемь крыльев по четыре на борт, корпус около 16 м. Размеры и массы оценены по кадрам, точных данных нет.',
  },
  environment: { name: 'Земля, уровень моря', g: 9.81, rho: 1.225, soundSpeed: 340.3 },
  parts,
  joints,
  actuators: [
    {
      id: 'flap', type: 'oscillator', freqHz: 20, amplitudeDeg: 30, rampTime: 3,
      joints: wingIds.map((w) => ({ joint: `hinge-${w}`, sign: (w.startsWith('R') ? -1 : 1) as 1 | -1 })),
      groupPhase: Object.fromEntries(wingIds.filter((w) => /[34]$/.test(w)).map((w) => [`hinge-${w}`, 0])),
    },
  ],
  powerplant: { power: 5e6, note: 'неизвестна; оценка на уровне крупного вертолёта' },
  crew: { part: 'fuselage', seats: [[7, 0.3, 0], [6, 0.3, 0.8]] },
  controls: [
    // Подъёмную силу даёт поворот крыла «ребром» на обратном ходе: 0 — без поворота, 1 — на 90°.
    { channel: 'feather', label: 'Поворот крыла на обратном ходе', role: 'lift', min: 0, max: 1, initial: 0.5, gain: 0.005 },
  ],
  assumptions: [
    { path: 'actuators[flap].freqHz', value: 20, unit: 'Гц', label: 'Частота взмахов', confidence: 'low', origin: 'estimated',
      reason: 'В фильме крылья смазаны в движении — десятки герц.', min: 0.5, max: 40, step: 0.5 },
    { path: 'actuators[flap].amplitudeDeg', value: 30, unit: '°', label: 'Размах взмаха', confidence: 'medium', origin: 'image',
      reason: 'По кадрам: крылья ходят примерно на ±30° от горизонтали.', min: 5, max: 60, step: 1 },
    { path: 'parts[R1].aero.span', value: 10, unit: 'м', label: 'Длина крыла', confidence: 'medium', origin: 'image',
      reason: 'Крыло заметно длиннее половины корпуса.', min: 2, max: 20, step: 0.5, linked: allWings('aero.span') },
    { path: 'parts[R1].aero.rootChord', value: 1.2, unit: 'м', label: 'Хорда крыла', confidence: 'low', origin: 'image',
      reason: 'Узкие стрекозиные крылья.', min: 0.3, max: 4, step: 0.1, linked: [...allWings('aero.rootChord'), ...allWings('aero.tipChord')] },
    { path: 'parts[R1].structure.wall', value: 0.01, unit: 'м', label: 'Стенка лонжерона', confidence: 'low', origin: 'estimated',
      reason: 'Типично для силовой коробки такого размера.', min: 0.002, max: 0.07, step: 0.001, linked: allWings('structure.wall') },
    { path: 'parts[fuselage].mass', value: 8000, unit: 'кг', label: 'Масса корпуса', confidence: 'low', origin: 'estimated',
      reason: 'Как у среднего вертолёта с экипажем.', min: 1000, max: 40000, step: 500 },
    { path: 'powerplant.power', value: 5e6, unit: 'Вт', label: 'Мощность силовой установки', confidence: 'low', origin: 'estimated',
      reason: 'В первоисточнике не указана; взята на уровне крупного вертолёта.', min: 1e5, max: 1e9, step: 1e5 },
  ],
};
