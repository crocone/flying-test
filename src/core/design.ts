// «Проект аппарата» — то, что заполняет ИИ (ТЗ, раздел 6), и сборщик спецификации из него.
//
// ИИ не расставляет детали по координатам: это легко сделать неправильно. Он описывает
// аппарат крупными параметрами (класс, размеры, массы, материал, мощность), а детали,
// шарниры, приводы и органы управления раскладывает этот сборщик — так же, как собраны
// эталонные пресеты. Проект проверяется до сборки, спецификация — после.
import { z } from 'zod';
import type { Spec, Part, Joint, Actuator, Assumption, Airfoil } from './spec.ts';
import { validateSpec, getPath } from './spec.ts';
import { MATERIALS } from './materials.ts';

const MATERIAL_IDS = Object.keys(MATERIALS) as [string, ...string[]];

const airfoilSchema = z.object({
  cl0: z.number().describe('C_L при нулевом угле атаки (симметричный профиль — 0, обычный крыльевой — 0,2…0,3)'),
  clMax: z.number().describe('максимальный C_L профиля (обычно 1,1…1,6)'),
  cd0: z.number().describe('профильное сопротивление (0,006…0,03)'),
  thickness: z.number().describe('относительная толщина профиля (0,08…0,18)'),
});

export const designSchema = z.object({
  name: z.string().describe('короткое название аппарата'),
  vehicleClass: z.enum(['fixed-wing', 'rotor', 'flapping']),
  summary: z.string().describe('одна-две фразы: как устроен и откуда взяты размеры'),
  environment: z.object({
    name: z.string(),
    g: z.number().describe('м/с²'),
    rho: z.number().describe('плотность воздуха у поверхности, кг/м³'),
    soundSpeed: z.number().describe('м/с'),
  }),
  fuselage: z.object({
    length: z.number().describe('м; у вертолёта — кабина без хвостовой балки'),
    width: z.number().describe('м'),
    height: z.number().describe('м'),
    mass: z.number().describe('кг: всё, кроме крыльев/лопастей/оперения — конструкция корпуса, двигатели, топливо, экипаж, груз'),
    dragArea: z.number().describe('эквивалентная площадь вредного сопротивления C_D·S, м²'),
  }),
  material: z.enum(MATERIAL_IDS).describe('материал силового набора крыльев или лопастей'),
  sparWall: z.number().describe('толщина стенки силового лонжерона, м'),
  powerplant: z.object({
    power: z.number().describe('располагаемая мощность на валах, Вт'),
    lapse: z.enum(['piston', 'turbine', 'none']).describe('поршневой без наддува, турбина, электромотор или дросселированный двигатель'),
    losses: z.number().describe('доля сверх мощности на валах: хвостовой винт, трансмиссия, КПД электромоторов (0…0,5)'),
  }),
  crewSeats: z.number().int().describe('число мест экипажа и пассажиров (0 — беспилотный)'),
  fixedWing: z
    .object({
      span: z.number().describe('полный размах от законцовки до законцовки, м'),
      rootChord: z.number().describe('м'),
      tipChord: z.number().describe('м'),
      highWing: z.boolean().describe('высокоплан (true) или низкоплан (false)'),
      airfoil: airfoilSchema,
      tailArea: z.number().describe('площадь горизонтального оперения, м²'),
      tailArm: z.number().describe('расстояние от крыла до горизонтального оперения, м'),
      propellerDiameter: z.number().describe('диаметр одного воздушного винта, м'),
      propellerCount: z.number().int(),
      limitLoadFactor: z.number().describe('расчётная эксплуатационная перегрузка (лёгкий самолёт 3,8; пилотажный 6; транспортный 2,5)'),
    })
    .nullable()
    .describe('заполнить только для самолёта'),
  rotor: z
    .object({
      rotorCount: z.number().int().describe('1 — вертолёт с одним несущим винтом; 2 при armLength = 0 — соосная схема: два несущих винта один над другим на общей оси, вращаются навстречу (Ка-26, Ка-32, Ка-52); 4, 6, 8 — мультикоптер'),
      radius: z.number().describe('радиус одного винта, м'),
      bladeCount: z.number().int(),
      chord: z.number().describe('хорда лопасти, м'),
      rpm: z.number().describe('обороты винта, об/мин'),
      twistDeg: z.number().describe('крутка лопасти, градусы (обычно −8…−12; у пропеллеров мультикоптеров −10…−15)'),
      bladeMass: z.number().describe('масса одной лопасти, кг'),
      armLength: z.number().describe('для мультикоптера — расстояние от центра до оси винта, м; для вертолёта и соосной схемы 0'),
      airfoil: airfoilSchema,
    })
    .nullable()
    .describe('заполнить только для винтокрылого аппарата'),
  flapping: z
    .object({
      wingsPerSide: z.number().int(),
      span: z.number().describe('длина одного крыла от шарнира до законцовки, м'),
      chord: z.number().describe('м'),
      frequencyHz: z.number(),
      amplitudeDeg: z.number().describe('размах взмаха от горизонтали, градусы'),
      wingMass: z.number().describe('масса одного крыла, кг; 0 — посчитать по материалу'),
      cruiseSpeed: z.number().describe('скорость полёта вперёд, м/с — для аппарата, который летает как птица (корпус горизонтально, крылья дают и подъёмную силу, и тягу); 0 — для аппарата, который висит на месте или взлетает вертикально, как стрекоза, колибри или орнитоптер «Дюны»'),
      airfoil: airfoilSchema,
    })
    .nullable()
    .describe('заполнить только для машущего крыла'),
  assumptions: z
    .array(
      z.object({
        field: z.string().describe('путь к полю проекта, например fixedWing.span или fuselage.mass'),
        value: z.number(),
        unit: z.string(),
        label: z.string().describe('что это, по-русски'),
        confidence: z.enum(['high', 'medium', 'low']),
        origin: z.enum(['user', 'image', 'source', 'estimated']).describe('user — задано пользователем; image — снято с изображения через эталон масштаба; source — известно о реальной технике или из первоисточника; estimated — оценено'),
        reason: z.string().describe('одна фраза: на что опирается значение'),
      }),
    )
    .describe('ВСЕ числовые поля, которые не заданы пользователем явно: оценки и известные данные. Только числовые поля: material, highWing и другие нечисловые не включать'),
});

export type Design = z.infer<typeof designSchema>;

// ---------- проверка проекта ----------

/** Поля проекта, которые бывают только целыми: число винтов, лопастей, крыльев, мест. */
export const INTEGER_FIELDS = ['rotor.rotorCount', 'rotor.bladeCount', 'flapping.wingsPerSide', 'fixedWing.propellerCount', 'crewSeats'];

export function validateDesign(d: Design): string[] {
  const e: string[] = [];
  for (const f of INTEGER_FIELDS) {
    const v = getPath(d, f);
    if (typeof v === 'number' && !Number.isInteger(v)) e.push(`${f}: ${v} — нужно целое число`);
  }
  const range = (path: string, x: number | null | undefined, lo: number, hi: number) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) e.push(`${path}: нужно число`);
    else if (x < lo || x > hi) e.push(`${path}: ${x} вне диапазона ${lo}…${hi}`);
  };
  range('environment.g', d.environment.g, 0.1, 50);
  range('environment.rho', d.environment.rho, 1e-4, 100);
  range('environment.soundSpeed', d.environment.soundSpeed, 50, 2000);
  range('fuselage.length', d.fuselage.length, 0.05, 500);
  range('fuselage.width', d.fuselage.width, 0.02, 200);
  range('fuselage.height', d.fuselage.height, 0.02, 200);
  range('fuselage.mass', d.fuselage.mass, 0.01, 1e7);
  range('fuselage.dragArea', d.fuselage.dragArea, 0, 1000);
  range('sparWall', d.sparWall, 1e-5, 0.5);
  range('powerplant.power', d.powerplant.power, 0, 1e11);
  range('powerplant.losses', d.powerplant.losses, 0, 2);
  const sections = { 'fixed-wing': d.fixedWing, rotor: d.rotor, flapping: d.flapping };
  if (!sections[d.vehicleClass]) e.push(`vehicleClass = ${d.vehicleClass}, но соответствующий блок пуст`);
  for (const [k, v] of Object.entries(sections)) if (v && k !== d.vehicleClass) e.push(`блок для класса ${k} заполнен, хотя класс ${d.vehicleClass} — оставьте null`);
  const af = (p: string, a: Airfoil | { cl0: number; clMax: number; cd0: number; thickness: number }) => {
    range(`${p}.clMax`, a.clMax, 0.3, 3);
    range(`${p}.cd0`, a.cd0, 0.002, 0.2);
    range(`${p}.thickness`, a.thickness, 0.02, 0.4);
    range(`${p}.cl0`, a.cl0, -0.5, 1.5);
  };
  if (d.vehicleClass === 'fixed-wing' && d.fixedWing) {
    const w = d.fixedWing;
    range('fixedWing.span', w.span, 0.1, 500);
    range('fixedWing.rootChord', w.rootChord, 0.01, 100);
    range('fixedWing.tipChord', w.tipChord, 0.005, 100);
    range('fixedWing.tailArea', w.tailArea, 0.001, 2000);
    range('fixedWing.tailArm', w.tailArm, 0.05, 300);
    range('fixedWing.propellerDiameter', w.propellerDiameter, 0.02, 20);
    range('fixedWing.propellerCount', w.propellerCount, 1, 16);
    range('fixedWing.limitLoadFactor', w.limitLoadFactor, 1.5, 15);
    af('fixedWing.airfoil', w.airfoil);
    if (w.span <= d.fuselage.width) e.push('fixedWing.span: размах должен быть больше ширины фюзеляжа');
    if (w.tailArm > d.fuselage.length * 1.5) e.push('fixedWing.tailArm: оперение дальше полутора длин фюзеляжа');
  }
  if (d.vehicleClass === 'rotor' && d.rotor) {
    const r = d.rotor;
    range('rotor.rotorCount', r.rotorCount, 1, 16);
    range('rotor.radius', r.radius, 0.02, 30);
    range('rotor.bladeCount', r.bladeCount, 2, 8);
    range('rotor.chord', r.chord, 0.002, 3);
    range('rotor.rpm', r.rpm, 30, 60000);
    range('rotor.twistDeg', r.twistDeg, -30, 10);
    range('rotor.bladeMass', r.bladeMass, 1e-4, 2000);
    range('rotor.armLength', r.armLength, 0, 50);
    af('rotor.airfoil', r.airfoil);
    // Два винта с нулевым плечом — соосная схема; с плечом не меньше радиуса — два винта рядом.
    if (r.rotorCount === 2 && r.armLength > 0 && r.armLength < r.radius)
      e.push('rotor.armLength: два винта перекрываются — для соосной схемы (винты один над другим на общей оси) укажите armLength = 0, для винтов рядом — плечо не меньше радиуса');
    if (r.rotorCount > 2 && r.armLength === 0)
      e.push(`rotor.rotorCount: ${r.rotorCount} винта на одной оси не собрать — так стоит только соосная пара, один винт над другим (rotorCount = 2). Три и больше винтов ставятся по кругу: задайте плечо (rotor.armLength) не меньше радиуса винта, ${r.radius} м`);
    else if (r.rotorCount > 2 && r.armLength < r.radius)
      e.push(`rotor.armLength: винты перекрываются — плечо ${r.armLength} м меньше радиуса винта ${r.radius} м. Соосная схема собирается из двух винтов: rotorCount = 2, armLength = 0`);
    else if (r.rotorCount > 2) {
      // Винты стоят по кругу: между соседними осями 2·L·sin(π/N). Меньше диаметра — лопасти соседних винтов
      // встречаются. Допуск 5 %: у настоящих аппаратов диски иногда стоят почти вплотную.
      const gap = 2 * r.armLength * Math.sin(Math.PI / r.rotorCount);
      if (gap < 0.95 * 2 * r.radius)
        e.push(`rotor.rotorCount: ${r.rotorCount} винтов радиусом ${r.radius} м на плече ${r.armLength} м не помещаются — между соседними осями ${gap.toFixed(2)} м, а диаметр винта ${(2 * r.radius).toFixed(2)} м. Увеличьте плечо (armLength) или уменьшите радиус`);
    }
    const tip = (r.rpm * 2 * Math.PI * r.radius) / 60;
    if (tip > 1.2 * d.environment.soundSpeed) e.push(`rotor.rpm: окружная скорость конца лопасти ${tip.toFixed(0)} м/с — сверхзвук, проверьте обороты и радиус`);
  }
  if (d.vehicleClass === 'flapping' && d.flapping) {
    const f = d.flapping;
    range('flapping.wingsPerSide', f.wingsPerSide, 1, 6);
    range('flapping.span', f.span, 0.02, 100);
    range('flapping.chord', f.chord, 0.005, 30);
    range('flapping.frequencyHz', f.frequencyHz, 0.1, 500);
    range('flapping.amplitudeDeg', f.amplitudeDeg, 2, 80);
    if (f.wingMass) range('flapping.wingMass', f.wingMass, 1e-5, 1e5); // 0 (в старых ссылках — null) — посчитать по материалу
    if (f.cruiseSpeed !== undefined && f.cruiseSpeed !== null) range('flapping.cruiseSpeed', f.cruiseSpeed, 0, 400);
    af('flapping.airfoil', f.airfoil);
  }
  for (const a of d.assumptions) {
    const v = getPath(d, a.field);
    if (typeof v !== 'number') e.push(`assumptions: поля «${a.field}» нет в проекте или оно не числовое`);
  }
  return e;
}

// ---------- сборщик ----------

const deg = Math.PI / 180;

/**
 * Во сколько раз индуктивная мощность соосной пары больше, чем у двух таких же винтов по отдельности с половинной тягой
 * (κ_int по Leishman & Syal, JAHS 53(3), 2008; M. Syal, дисс. UMD 2008, ур. 2.12–2.14 и табл. 2.1). Импульсная теория:
 * 1,281 — нижний винт в полностью сжатой струе верхнего (наименьшее возможное), 1,414 — винты в одной плоскости.
 * С 1,28 Leishman & Syal сопоставляют оба ротора Харрингтона (NACA TN 2318). Независимый замер — Cameron, Karpatne,
 * Sirohi, J. Aircraft 53(3), 2016: разнос 13,8 % R, верхний винт +18 %, нижний +49 % → в среднем 1,33.
 * Раньше было 1,16 (форум, пересказ учебника) — меньше теоретического минимума; сверка — src/cli/validation.ts (Харрингтон).
 */
export const COAXIAL_INTERFERENCE = 1.28;

export function buildSpec(d: Design): Spec {
  const F = d.fuselage;
  const parts: Part[] = [];
  const joints: Joint[] = [];
  const actuators: Actuator[] = [];
  const spec: Spec = {
    schema: 1,
    meta: { name: d.name, class: d.vehicleClass, source: 'text', notes: d.summary },
    environment: { ...d.environment },
    parts,
    joints,
    actuators,
    powerplant: { power: d.powerplant.power, losses: d.powerplant.losses, lapse: d.powerplant.lapse },
    crew: { part: 'fuselage', seats: [[F.length * 0.25, 0, 0]] },
    controls: [],
    assumptions: [],
  };
  const airfoil = (a: { cl0: number; clMax: number; cd0: number; thickness: number }): Airfoil => ({
    cl0: a.cl0, clMax: a.clMax, cd0: a.cd0, thickness: a.thickness, clAlpha: 5.9, k: 0.006,
  });
  const structure = { section: 'box' as const, material: d.material, wall: d.sparWall, skinArealMass: 0 };

  if (d.vehicleClass === 'fixed-wing' && d.fixedWing) {
    const w = d.fixedWing;
    const wheelR = Math.max(0.05, F.height * 0.14);
    const FY = 2 * wheelR + F.height / 2;
    parts.push({ id: 'fuselage', name: 'Фюзеляж', kind: 'body', position: [0, FY, 0], shape: { type: 'ellipsoid', size: [F.length, F.height, F.width] },
      mass: F.mass * 0.95, dragArea: F.dragArea, collides: false });
    const half = (w.span - F.width) / 2;
    const meanChord = (w.rootChord + w.tipChord) / 2;
    const AR = (w.span * w.span) / (w.span * meanChord);
    const wy = FY + (w.highWing ? 0.4 : -0.35) * F.height;
    for (const side of [1, -1] as const) {
      const id = side > 0 ? 'wingR' : 'wingL';
      parts.push({
        id, name: side > 0 ? 'Правое крыло' : 'Левое крыло', kind: 'wing', position: [0, wy, (side * F.width) / 2],
        aero: { side, span: half, rootChord: w.rootChord, tipChord: w.tipChord, incidenceDeg: 1.5, twistDeg: -3, dihedralDeg: w.highWing ? 1.5 : 4,
          airfoil: airfoil(w.airfoil), sections: 12, induced: 'wing', aspectRatio: AR, role: 'main' },
        structure: { ...structure, widthFrac: 0.08, heightFrac: 0.9, skinArealMass: Math.max(0.5, 4 * Math.min(1, meanChord / 1.5)) },
      });
      joints.push({ id: `j-${id}`, type: 'fixed', parent: 'fuselage', child: id });
    }
    const tailSpan = Math.sqrt(w.tailArea * 3.4) / 2;
    const tailChord = w.tailArea / (2 * tailSpan);
    for (const side of [1, -1] as const) {
      const id = side > 0 ? 'tailR' : 'tailL';
      parts.push({
        id, name: 'Стабилизатор', kind: 'wing', position: [-w.tailArm, FY + 0.1 * F.height, side * 0.05 * F.width],
        aero: { side, span: tailSpan, rootChord: tailChord * 1.1, tipChord: tailChord * 0.9, incidenceDeg: -2.5,
          airfoil: { cl0: 0, clAlpha: 5.7, clMax: 1.1, cd0: 0.008, k: 0.008, thickness: 0.09 },
          sections: 6, induced: 'wing', aspectRatio: 3.4, role: 'tail', control: { channel: 'pitch', deg: -1 } },
        mass: Math.max(0.01, w.tailArea * 6),
      });
      joints.push({ id: `j-${id}`, type: 'fixed', parent: 'fuselage', child: id });
    }
    const gm = F.mass * 0.05;
    for (const [id, x, z] of [['noseGear', F.length * 0.2, 0], ['mainGearR', -0.04 * F.length, F.width * 1.1], ['mainGearL', -0.04 * F.length, -F.width * 1.1]] as const) {
      parts.push({ id, kind: 'gear', position: [x, wheelR, z], shape: { type: 'sphere', size: [2 * wheelR, 2 * wheelR, 2 * wheelR] }, mass: gm / 3, friction: 0.03 });
      joints.push({ id: `j-${id}`, type: 'fixed', parent: 'fuselage', child: id });
    }
    // Несколько винтов — один эквивалентный диск той же площади.
    actuators.push({ id: 'prop', type: 'propeller', part: 'fuselage', axis: [1, 0, 0], diameter: w.propellerDiameter * Math.sqrt(w.propellerCount), efficiency: 0.85, channel: 'throttle' });
    spec.controls = [
      { channel: 'throttle', label: 'Газ', role: 'throttle', min: 0, max: 1, initial: 0 },
      { channel: 'pitch', label: 'Руль высоты (нос вверх +)', role: 'pitch', min: -15, max: 25, initial: 0 },
    ];
    spec.limits = { loadFactor: w.limitLoadFactor };
    spec.crew.seats = [[F.length * 0.15, 0.1 * F.height, 0]];
  }

  if (d.vehicleClass === 'rotor' && d.rotor) {
    const r = d.rotor;
    // Соосная схема — вертолёт, а не мультикоптер: управляется общим шагом, лопасти с лонжероном.
    const coax = r.rotorCount === 2 && r.armLength === 0;
    const multi = r.rotorCount > 1 && !coax;
    const bodyY = multi ? F.height / 2 + 0.25 * r.radius : 0.8 * (F.height / 2);
    parts.push({ id: 'fuselage', name: 'Корпус', kind: 'body', position: [0, bodyY, 0],
      shape: { type: multi ? 'box' : 'ellipsoid', size: [F.length, F.height, F.width] }, mass: F.mass, dragArea: F.dragArea });
    const root = Math.max(0.15 * r.radius, 0.005);
    const span = r.radius - root;
    const g = d.environment.g;
    const total = F.mass + r.rotorCount * r.bladeCount * r.bladeMass;
    const omega = (r.rpm * 2 * Math.PI) / 60;
    // Конусность лопасти: центробежная сила уравновешивает изгиб от тяги на висении.
    const thrustPerBlade = (total * g) / (r.rotorCount * r.bladeCount);
    const rCg = root + span / 2;
    const I = r.bladeMass * (rCg * rCg + (span * span) / 12);
    const precone = multi ? 0 : Math.atan((thrustPerBlade * (root + 0.7 * span)) / Math.max(1e-9, omega * omega * I)) / deg;
    const hubs: { x: number; z: number; dy: number; dir: 1 | -1; id: string }[] = [];
    if (coax) {
      // Винты разнесены по высоте на 0,2 радиуса (Ка-26: 1,17 м при радиусе 6,5 м) и вращаются навстречу.
      hubs.push({ x: 0, z: 0, dy: 0, dir: 1, id: 'lower' }, { x: 0, z: 0, dy: 0.2 * r.radius, dir: -1, id: 'upper' });
    } else if (!multi) hubs.push({ x: 0, z: 0, dy: 0, dir: 1, id: 'main' });
    else for (let k = 0; k < r.rotorCount; k++) {
      const a = (2 * Math.PI * k) / r.rotorCount + Math.PI / r.rotorCount;
      hubs.push({ x: r.armLength * Math.cos(a), z: r.armLength * Math.sin(a), dy: 0, dir: k % 2 === 0 ? 1 : -1, id: `r${k + 1}` });
    }
    const hubY0 = multi ? bodyY + F.height / 2 + 0.02 : bodyY + F.height / 2 + Math.max(0.3, 0.2 * r.radius);
    for (const h of hubs) {
      const hubY = hubY0 + h.dy;
      const hubId = `hub-${h.id}`;
      parts.push({ id: hubId, kind: 'hub', position: [h.x, hubY, h.z], shape: { type: 'cylinder', size: [2 * root, 0.3 * root, 2 * root] }, mass: Math.max(1e-3, 0.5 * r.bladeMass) });
      joints.push({ id: `m-${h.id}`, type: 'revolute', parent: 'fuselage', child: hubId, axis: [0, 1, 0] });
      for (let b = 0; b < r.bladeCount; b++) {
        const th = (360 * b) / r.bladeCount;
        // Против часовой — обычная лопасть; по часовой — зеркальная (side −1, разворот на 180°).
        // Угол держим в пределах оборота: у третьей лопасти зеркального винта 240° + 180° = 420° — спецификация такое отклоняет.
        const rot = (h.dir === 1 ? th : th + 180) % 360;
        const side = h.dir === 1 ? 1 : -1;
        const id = `b${b + 1}-${h.id}`;
        parts.push({
          id, kind: 'blade', position: [h.x + root * Math.sin(th * deg), hubY, h.z + root * Math.cos(th * deg)], rotation: [0, rot, 0], mass: r.bladeMass,
          aero: { side: side as 1 | -1, span, rootChord: r.chord, tipChord: r.chord * (multi ? 0.6 : 1), incidenceDeg: multi ? 18 : 0, twistDeg: r.twistDeg,
            dihedralDeg: precone, sections: multi ? 6 : 12, airfoil: { ...airfoil(r.airfoil), clAlpha: 5.7 },
            ...(multi ? {} : { control: { channel: 'collective', deg: 1 } }) },
          // Лопасть вертолёта — не пустотелая коробка: за лонжероном сотовый или пенный заполнитель, стенки подкреплены.
          ...(multi ? {} : { structure: { ...structure, widthFrac: 0.4, heightFrac: 0.9, filled: true } }),
        });
        joints.push({ id: `f-${id}`, type: 'fixed', parent: hubId, child: id });
      }
      // Соосные винты мешают друг другу: нижний работает в струе верхнего. Индуктивная мощность пары выше,
      // чем у двух таких же винтов по отдельности, в κ_int раз (см. COAXIAL_INTERFERENCE): импульсная теория даёт
      // 1,28 (нижний винт в сжатой струе верхнего) и 1,41 (винты в одной плоскости), замер Cameron et al. (2016) — 1,33.
      actuators.push({ id: `rot-${h.id}`, type: 'spinner', joint: `m-${h.id}`, rpm: r.rpm, direction: h.dir, rampTime: multi ? 2 : 4,
        ...(multi ? { channel: 'rpm' } : {}), ...(coax ? { inducedFactor: 1.15 * COAXIAL_INTERFERENCE } : {}) });
    }
    // Начальный общий шаг — шаг висения по элементарной теории винта:
    // θ₀,₇₅ = 6·C_T/(σ·a) + 1,5·√(C_T/2). Тогда на раскрутке изгиб от тяги и центробежный
    // момент от конусности растут вместе и уравновешивают друг друга.
    const A = Math.PI * r.radius * r.radius;
    const ct = (total * g) / r.rotorCount / (d.environment.rho * A * (omega * r.radius) ** 2); // на один винт
    const sigma = (r.bladeCount * r.chord) / (Math.PI * r.radius);
    const theta75 = ((6 * ct) / (sigma * 5.7) + 1.5 * Math.sqrt(ct / 2)) / deg;
    const twistAt75 = (r.twistDeg * (0.75 * r.radius - root)) / span;
    const collective0 = Math.min(18, Math.max(0, theta75 - twistAt75));
    spec.controls = multi
      ? [{ channel: 'rpm', label: 'Обороты, доля от номинала', role: 'lift', min: 0.4, max: 1.4, initial: 0.9, gain: 0.03 }]
      : [{ channel: 'collective', label: 'Общий шаг, °', role: 'lift', min: 0, max: 18, initial: Math.round(collective0 * 10) / 10, gain: 0.4 }];
  }

  if (d.vehicleClass === 'flapping' && d.flapping) {
    const f = d.flapping;
    const FY = f.span * Math.sin(f.amplitudeDeg * deg) + F.height / 2 + 1;
    parts.push({ id: 'fuselage', name: 'Корпус', kind: 'body', position: [0, FY, 0], shape: { type: 'ellipsoid', size: [F.length, F.height, F.width] }, mass: F.mass, dragArea: F.dragArea });
    const ids: string[] = [];
    // Два устройства машущего крыла. «Птица» (задана скорость полёта вперёд): крыло работает в набегающем
    // потоке, средний угол установки — орган балансировки, на взмахе крыло закручивается к законцовке;
    // так же собраны эталоны SmartBird и Snowbird. «Стрекоза» (скорость 0): аппарат висит, крыло
    // поворачивается на обратном ходе. В старых ссылках поля скорости нет — это «стрекоза», как и раньше.
    const V = f.cruiseSpeed ?? 0;
    const forward = V > 0;
    // Чтобы законцовка шла по потоку, её нужно закручивать на угол потока: arctg(скорость законцовки / V).
    const tipSpeed = 2 * Math.PI * f.frequencyHz * f.span * f.amplitudeDeg * deg;
    const twistLimit = forward ? Math.min(60, Math.max(15, (1.2 * Math.atan2(tipSpeed, V)) / deg)) : 0;
    const fullSpan = 2 * f.span + F.width;
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < f.wingsPerSide; k++) {
        const x = f.wingsPerSide === 1 ? 0 : F.length * (0.3 - (0.6 * k) / (f.wingsPerSide - 1));
        const id = `${side < 0 ? 'L' : 'R'}${k + 1}`;
        ids.push(id);
        parts.push({
          id, name: `Крыло ${side < 0 ? 'Л' : 'П'}${k + 1}`, kind: 'wing', position: [x, FY + 0.2 * F.height, (side * F.width) / 2],
          aero: forward
            ? { side, span: f.span, rootChord: f.chord, tipChord: f.chord, incidenceDeg: 0, sections: 12, induced: 'wing',
                aspectRatio: (fullSpan * fullSpan) / (2 * f.span * f.chord), addedMass: true, unsteady: true,
                airfoil: { ...airfoil(f.airfoil), k: 0.02 }, control: { channel: 'pitch', deg: 1 },
                feathering: { channel: 'feather', maxDeg: 2 * twistLimit, actuator: 'flap', mode: 'sine', distribution: 'linear' } }
            : { side, span: f.span, rootChord: f.chord, tipChord: f.chord, incidenceDeg: 0, sections: 12, induced: 'none', addedMass: true,
                airfoil: { ...airfoil(f.airfoil), k: 0.02 }, feathering: { channel: 'feather', maxDeg: 90, actuator: 'flap' } },
          // Обшивка: у «стрекозы» — как у орнитоптера «Дюны» (10 кг/м² при хорде 1,2 м); у «птицы» — лёгкая,
          // около 1 кг/м² на метр хорды (SmartBird: 0,2 кг/м² при хорде 0,25 м; Snowbird: 1 кг/м² при 0,94 м).
          // Лонжерон «птицы» — узкая коробка, как у эталонов SmartBird и Snowbird; у «стрекозы» — прежняя, широкая.
          structure: forward
            ? { ...structure, widthFrac: 0.12, heightFrac: 0.85, skinArealMass: f.chord }
            : { ...structure, widthFrac: 0.25, heightFrac: 1, skinArealMass: 10 * Math.min(1, f.chord / 1.2) },
          ...(f.wingMass ? { mass: f.wingMass } : {}),
        });
        joints.push({ id: `hinge-${id}`, type: 'revolute', parent: 'fuselage', child: id, axis: [1, 0, 0] });
      }
    }
    actuators.push({ id: 'flap', type: 'oscillator', freqHz: f.frequencyHz, amplitudeDeg: f.amplitudeDeg, rampTime: forward ? 2 / f.frequencyHz : 3,
      joints: ids.map((id) => ({ joint: `hinge-${id}`, sign: (id.startsWith('R') ? -1 : 1) as 1 | -1 })) });
    if (forward) {
      spec.controls = [
        { channel: 'pitch', label: 'Средний угол установки крыльев, °', role: 'pitch', min: -10, max: 15, initial: 3 },
        { channel: 'feather', label: 'Закручивание на взмахе, доля от наибольшего', role: 'lift', min: 0, max: 1, initial: 0.6, gain: 0.005 },
      ];
      spec.limits = { cruiseSpeed: V };
    } else spec.controls = [{ channel: 'feather', label: 'Поворот крыла на обратном ходе', role: 'lift', min: 0, max: 1, initial: 0.5, gain: 0.005 }];
  }

  spec.crew.seats = d.crewSeats > 0 ? spec.crew.seats : [[0, 0, 0]];
  if (d.crewSeats <= 0) spec.crew.unmanned = true;
  // Допущения проекта — ползунки на стенде правят проект, а спецификация пересобирается.
  spec.assumptions = d.assumptions.map((a): Assumption => {
    const base = { path: `design.${a.field}`, value: a.value, unit: a.unit, label: a.label, confidence: a.confidence, origin: a.origin, reason: a.reason };
    // Число винтов, лопастей, крыльев и мест — только целое: ползунок ходит с шагом 1.
    if (INTEGER_FIELDS.includes(a.field)) {
      const lo = a.field === 'crewSeats' ? 0 : 1;
      return { ...base, min: Math.max(lo, Math.floor(a.value / 3)), max: Math.max(a.value + 2, Math.round(a.value * 3)), step: 1 };
    }
    if (a.value === 0) {
      // Ноль: «в 3 раза больше или меньше» даёт пустой ползунок. Плечо винтов — до трёх радиусов, остальное — до 1.
      const top = a.field === 'rotor.armLength' ? 3 * (d.rotor?.radius ?? 1) : 1;
      return { ...base, min: 0, max: top, step: top / 100 };
    }
    return { ...base, min: a.value > 0 ? a.value / 3 : a.value * 3, max: a.value > 0 ? a.value * 3 : a.value / 3, step: Math.abs(a.value) / 100 || 0.01 };
  });
  return spec;
}

/** Убрать из допущений записи о нечисловых полях (материал, highWing): ползунка у них нет,
 *  а отклонять из-за них весь проект и гонять ИИ на исправление — лишние 15–20 с. */
export function normalizeDesign(d: Design): { design: Design; dropped: string[] } {
  const dropped = d.assumptions.filter((a) => typeof getPath(d, a.field) !== 'number').map((a) => a.field);
  if (!dropped.length) return { design: d, dropped };
  return { design: { ...d, assumptions: d.assumptions.filter((a) => typeof getPath(d, a.field) === 'number') }, dropped };
}

/** Проверить проект и собранную из него спецификацию. Пустой список — всё в порядке. */
export function checkDesign(d: Design): { errors: string[]; spec: Spec | null } {
  const errors = validateDesign(d);
  if (errors.length) return { errors, spec: null };
  const spec = buildSpec(d);
  // Пути допущений ведут в проект: в спецификации их нет, поэтому проверяем без них.
  const val = validateSpec({ ...spec, assumptions: [] }, Object.keys(MATERIALS));
  return { errors: val.errors, spec: val.ok ? spec : null };
}

/** Применить значение допущения к копии проекта. */
export function setDesignField(d: Design, field: string, value: number): Design {
  const copy = structuredClone(d);
  const keys = field.split('.');
  let cur: any = copy;
  for (const k of keys.slice(0, -1)) cur = cur?.[k];
  if (cur && typeof cur[keys[keys.length - 1]] === 'number') cur[keys[keys.length - 1]] = value;
  const a = copy.assumptions.find((x) => x.field === field);
  if (a) a.value = value;
  return copy;
}
