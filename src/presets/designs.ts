// Эталонные «проекты» — так должен выглядеть ответ ИИ. Нужны для проверки сборщика
// без обращения к ИИ: из них должны собираться летающие аппараты.
import type { Design } from '../core/design.ts';

const earth = { name: 'Земля, МСА', g: 9.81, rho: 1.225, soundSpeed: 340.3 };
const est = (field: string, value: number, unit: string, label: string, reason: string, confidence: 'high' | 'medium' | 'low' = 'medium') =>
  ({ field, value, unit, label, confidence, origin: 'estimated' as const, reason });
const src = (field: string, value: number, unit: string, label: string, reason: string) =>
  ({ field, value, unit, label, confidence: 'high' as const, origin: 'source' as const, reason });

export const DESIGNS: Record<string, Design> = {
  cessna: {
    name: 'Cessna 172S (проект)', vehicleClass: 'fixed-wing', summary: 'Лёгкий четырёхместный высокоплан.',
    environment: earth,
    fuselage: { length: 8.3, width: 1.1, height: 1.4, mass: 990, dragArea: 0.36 },
    material: 'al7075', sparWall: 0.0055,
    powerplant: { power: 134e3, lapse: 'piston', losses: 0 },
    crewSeats: 4,
    fixedWing: { span: 11, rootChord: 1.63, tipChord: 1.25, highWing: true,
      airfoil: { cl0: 0.23, clMax: 1.55, cd0: 0.0075, thickness: 0.12 },
      tailArea: 3.0, tailArm: 4.6, propellerDiameter: 1.93, propellerCount: 1, limitLoadFactor: 3.8 },
    rotor: null, flapping: null,
    assumptions: [
      src('fixedWing.span', 11, 'м', 'Размах', 'TCDS: 36,08 ft'),
      src('fuselage.mass', 990, 'кг', 'Масса без крыльев и оперения', 'Взлётная 1157 кг минус крылья и оперение'),
      est('fuselage.dragArea', 0.36, 'м²', 'Вредное сопротивление', 'Типично для лёгкого самолёта с неубирающимся шасси'),
      est('sparWall', 0.0055, 'м', 'Стенка лонжерона', 'Подобрана под разрушающую перегрузку 5,7', 'low'),
    ],
  },
  r22: {
    name: 'Robinson R22 (проект)', vehicleClass: 'rotor', summary: 'Лёгкий двухместный вертолёт.',
    environment: earth,
    fuselage: { length: 3.2, width: 1.1, height: 1.6, mass: 575, dragArea: 0.6 },
    material: 'steel4340', sparWall: 0.004,
    powerplant: { power: 97.7e3, lapse: 'none', losses: 0.15 },
    crewSeats: 2,
    fixedWing: null,
    rotor: { rotorCount: 1, radius: 3.835, bladeCount: 2, chord: 0.183, rpm: 530, twistDeg: -8, bladeMass: 13, armLength: 0,
      airfoil: { cl0: 0, clMax: 1.3, cd0: 0.008, thickness: 0.15 } },
    flapping: null,
    assumptions: [
      src('rotor.radius', 3.835, 'м', 'Радиус винта', 'Диаметр 25 ft 2 in'),
      est('rotor.bladeMass', 13, 'кг', 'Масса лопасти', 'Стальной лонжерон длиной 3,4 м', 'low'),
      est('powerplant.losses', 0.15, '', 'Хвостовой винт и трансмиссия', 'Обычно 8–12 % плюс трансмиссия'),
    ],
  },
  quad: {
    name: 'Квадрокоптер 1,4 кг (проект)', vehicleClass: 'rotor', summary: 'Съёмочный квадрокоптер.',
    environment: earth,
    fuselage: { length: 0.2, width: 0.2, height: 0.08, mass: 1.292, dragArea: 0.01 },
    material: 'cfrp', sparWall: 0.001,
    powerplant: { power: 600, lapse: 'none', losses: 0.33 },
    crewSeats: 0,
    fixedWing: null,
    rotor: { rotorCount: 4, radius: 0.12, bladeCount: 2, chord: 0.024, rpm: 6500, twistDeg: -12, bladeMass: 0.006, armLength: 0.175,
      airfoil: { cl0: 0.3, clMax: 1.2, cd0: 0.02, thickness: 0.1 } },
    flapping: null,
    assumptions: [est('powerplant.losses', 0.33, '', 'Потери в моторах и регуляторах', 'КПД около 0,75')],
  },
  ornithopter: {
    name: 'Орнитоптер (проект)', vehicleClass: 'flapping', summary: 'Восемь крыльев, корпус 16 м.',
    environment: earth,
    fuselage: { length: 16, width: 3, height: 3, mass: 8000, dragArea: 4 },
    material: 'cfrp', sparWall: 0.01,
    powerplant: { power: 5e6, lapse: 'turbine', losses: 0 },
    crewSeats: 2,
    fixedWing: null, rotor: null,
    flapping: { wingsPerSide: 4, span: 10, chord: 1.2, frequencyHz: 20, amplitudeDeg: 30, wingMass: 0, cruiseSpeed: 0,
      airfoil: { cl0: 0.1, clMax: 1.1, cd0: 0.02, thickness: 0.12 } },
    assumptions: [est('flapping.frequencyHz', 20, 'Гц', 'Частота взмахов', 'Крылья смазаны в кадре', 'low')],
  },
  // Соосный вертолёт: два трёхлопастных винта на одной оси. Размах винтов, масса и мощность — Ка-26
  // (data/research.md); хорда, обороты и масса лопасти — оценки.
  ka26: {
    name: 'Ка-26 (проект)', vehicleClass: 'rotor', summary: 'Соосный вертолёт: два трёхлопастных винта диаметром 13 м, два поршневых мотора.',
    environment: earth,
    fuselage: { length: 7.75, width: 1.3, height: 2.2, mass: 3100, dragArea: 1.5 },
    material: 'gfrp', sparWall: 0.009,
    powerplant: { power: 478e3, lapse: 'piston', losses: 0.05 },
    crewSeats: 7,
    fixedWing: null,
    rotor: { rotorCount: 2, radius: 6.5, bladeCount: 3, chord: 0.25, rpm: 294, twistDeg: -8, bladeMass: 25, armLength: 0,
      airfoil: { cl0: 0, clMax: 1.3, cd0: 0.009, thickness: 0.12 } },
    flapping: null,
    assumptions: [
      src('rotor.radius', 6.5, 'м', 'Радиус винта', 'Диаметр каждого винта 13,00 м'),
      src('powerplant.power', 478e3, 'Вт', 'Мощность', 'Два мотора М-14В-26 по 325 л. с. (239 кВт)'),
      src('fuselage.mass', 3100, 'кг', 'Масса без лопастей', 'Взлётная 3250 кг минус шесть лопастей'),
      est('rotor.rpm', 294, 'об/мин', 'Обороты винтов', 'Окружная скорость концов лопастей около 200 м/с', 'low'),
      est('rotor.chord', 0.25, 'м', 'Хорда лопасти', 'Типично для винта такого диаметра', 'low'),
      est('rotor.bladeMass', 25, 'кг', 'Масса лопасти', 'Стеклопластиковая лопасть длиной 5,5 м', 'low'),
      est('powerplant.losses', 0.05, '', 'Потери в трансмиссии', 'Хвостового винта нет: только редуктор'),
      est('sparWall', 0.009, 'м', 'Стенка лонжерона лопасти', 'Подобрана так, чтобы лопасть держала нагрузки при взлёте с запасом около 1,9', 'low'),
    ],
  },
  // Махолёт, летающий вперёд, как птица: числа — Festo SmartBird.
  gull: {
    name: 'Робот-чайка (проект)', vehicleClass: 'flapping', summary: 'Робот-птица: два крыла, размах 2 м, 0,48 кг.',
    environment: earth,
    fuselage: { length: 1.07, width: 0.1, height: 0.08, mass: 0.38, dragArea: 0.01 },
    material: 'cfrp', sparWall: 0.0006,
    powerplant: { power: 50, lapse: 'none', losses: 0.67 },
    crewSeats: 0,
    fixedWing: null, rotor: null,
    flapping: { wingsPerSide: 1, span: 0.95, chord: 0.25, frequencyHz: 2, amplitudeDeg: 25, wingMass: 0.05, cruiseSpeed: 5,
      airfoil: { cl0: 0.3, clMax: 1.1, cd0: 0.04, thickness: 0.08 } },
    assumptions: [
      src('flapping.cruiseSpeed', 5, 'м/с', 'Скорость полёта', 'Festo: около 5 м/с'),
      est('flapping.amplitudeDeg', 25, '°', 'Размах взмаха', 'По видео — около ±25°', 'low'),
      est('fuselage.dragArea', 0.01, 'м²', 'Вредное сопротивление', 'Под опубликованное качество L/D ≈ 7', 'low'),
    ],
  },
};
