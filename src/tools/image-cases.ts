// Проверочный набор этапа 5: 15 изображений с разметкой (ТЗ, раздел 11).
// Приёмка: ≥ 12 из 15 дают верный класс и верное число крыльев или винтов; пропорции основных
// деталей отличаются от разметки не больше чем на 25 %; изображение без транспорта отклоняется
// с объяснением. Изображения рисуются этим же кодом (src/tools/draw.ts), поэтому разметка точная.
import type { Drawable, ScaleRef, Style, View } from './draw.ts';
import type { Design } from '../core/design.ts';
import { getPath } from '../core/spec.ts';

export type RatioName = 'span/length' | 'chord/span' | 'rotorDiameter/length' | 'arm/radius' | 'wing/length' | 'chord/wing';

export interface ImageCase {
  id: string;
  title: string;
  draw: Drawable;
  view: View;
  style: Style;
  ref: ScaleRef;
  text?: string; // уточнение пользователя к картинке
  expect:
    | { inScope: false }
    | {
        inScope: true;
        class: Design['vehicleClass'];
        counts: Record<string, number>; // поле проекта → число
        ratios: Partial<Record<RatioName, number>>;
        sizes?: Record<string, number>; // поле проекта → метры, когда на картинке есть эталон масштаба
      };
}

const cessna: Drawable = { kind: 'fixed', length: 8.3, width: 1.1, height: 1.4, span: 11, rootChord: 1.63, tipChord: 1.25, highWing: true, tailSpan: 3.4, tailChord: 0.9, finHeight: 1.3, propellers: 1, propDiameter: 1.93, wingPos: 0.3 };
const r22: Drawable = { kind: 'heli', cabinLength: 3.2, cabinWidth: 1.1, cabinHeight: 1.6, boomLength: 3.3, radius: 3.835, blades: 2, tailRotorR: 0.53 };

export const IMAGE_CASES: ImageCase[] = [
  { id: 'cessna-top', title: 'Лёгкий самолёт, вид сверху, размерная линия', draw: cessna, view: 'top', style: 'line', ref: { kind: 'dimension', what: 'span', label: '11,0 м' },
    expect: { inScope: true, class: 'fixed-wing', counts: { 'fixedWing.propellerCount': 1 }, ratios: { 'span/length': 11 / 8.3, 'chord/span': 1.44 / 11 }, sizes: { 'fixedWing.span': 11 } } },
  { id: 'cessna-side', title: 'Лёгкий самолёт сбоку, рядом человек', draw: cessna, view: 'side', style: 'silhouette', ref: { kind: 'person' },
    expect: { inScope: true, class: 'fixed-wing', counts: { 'fixedWing.propellerCount': 1 }, ratios: {}, sizes: { 'fuselage.length': 8.3 } } },
  { id: 'twin-top', title: 'Двухмоторный высокоплан, чертёж на сетке', view: 'top', style: 'blueprint', ref: { kind: 'grid', stepM: 1, label: 'клетка 1 м' },
    draw: { kind: 'fixed', length: 11.5, width: 1.4, height: 1.6, span: 15, rootChord: 2.0, tipChord: 1.3, highWing: true, tailSpan: 5, tailChord: 1.2, finHeight: 1.8, propellers: 2, propDiameter: 2.2, wingPos: 0.32 },
    expect: { inScope: true, class: 'fixed-wing', counts: { 'fixedWing.propellerCount': 2 }, ratios: { 'span/length': 15 / 11.5, 'chord/span': 1.65 / 15 }, sizes: { 'fixedWing.span': 15 } } },
  { id: 'transport-top', title: 'Четырёхмоторный самолёт сверху, без масштаба', view: 'top', style: 'line', ref: { kind: 'none' },
    draw: { kind: 'fixed', length: 30, width: 3.5, height: 4, span: 40, rootChord: 6, tipChord: 2.5, highWing: true, tailSpan: 14, tailChord: 3.5, finHeight: 5, propellers: 4, propDiameter: 4.5, wingPos: 0.38 },
    expect: { inScope: true, class: 'fixed-wing', counts: { 'fixedWing.propellerCount': 4 }, ratios: { 'span/length': 40 / 30, 'chord/span': 4.25 / 40 } } },
  { id: 'r22-side', title: 'Лёгкий вертолёт сбоку, рядом человек', draw: r22, view: 'side', style: 'silhouette', ref: { kind: 'person' },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 1 }, ratios: { 'rotorDiameter/length': 7.67 / 3.2 }, sizes: { 'rotor.radius': 3.835 } } },
  { id: 'r22-top', title: 'Лёгкий вертолёт сверху, размер по диаметру винта', draw: r22, view: 'top', style: 'line', ref: { kind: 'dimension', what: 'rotor', label: '7,67 м' },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 1, 'rotor.bladeCount': 2 }, ratios: { 'rotorDiameter/length': 7.67 / 3.2 }, sizes: { 'rotor.radius': 3.835 } } },
  { id: 'big-heli-side', title: 'Крупный вертолёт сбоку, чертёж, рядом человек', view: 'side', style: 'blueprint', ref: { kind: 'person' },
    draw: { kind: 'heli', cabinLength: 11, cabinWidth: 2.5, cabinHeight: 3.6, boomLength: 7.4, radius: 10.65, blades: 5, tailRotorR: 1.95 },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 1 }, ratios: { 'rotorDiameter/length': 21.3 / 11 }, sizes: { 'rotor.radius': 10.65 } } },
  { id: 'heli3-top', title: 'Вертолёт с трёхлопастным винтом сверху, без масштаба', view: 'top', style: 'silhouette', ref: { kind: 'none' },
    draw: { kind: 'heli', cabinLength: 4.5, cabinWidth: 1.6, cabinHeight: 2, boomLength: 4, radius: 5.5, blades: 3, tailRotorR: 0.8 },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 1, 'rotor.bladeCount': 3 }, ratios: { 'rotorDiameter/length': 11 / 4.5 } } },
  { id: 'quad-top', title: 'Квадрокоптер сверху, масса в подписи', view: 'top', style: 'line', ref: { kind: 'none' }, text: 'Масса 1,4 кг.',
    draw: { kind: 'multi', body: 0.13, arm: 0.175, radius: 0.12, rotors: 4 },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 4 }, ratios: { 'arm/radius': 0.175 / 0.12 } } },
  { id: 'hexa-top', title: 'Гексакоптер сверху, размер между осями винтов', view: 'top', style: 'silhouette', ref: { kind: 'dimension', what: 'span', label: '1,10 м' },
    draw: { kind: 'multi', body: 0.35, arm: 0.55, radius: 0.2, rotors: 6 },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 6 }, ratios: { 'arm/radius': 0.55 / 0.2 }, sizes: { 'rotor.armLength': 0.55 } } },
  { id: 'octo-top', title: 'Грузовой октокоптер, чертёж на сетке', view: 'top', style: 'blueprint', ref: { kind: 'grid', stepM: 0.5, label: 'клетка 0,5 м' },
    draw: { kind: 'multi', body: 0.6, arm: 1.0, radius: 0.38, rotors: 8 },
    expect: { inScope: true, class: 'rotor', counts: { 'rotor.rotorCount': 8 }, ratios: { 'arm/radius': 1.0 / 0.38 }, sizes: { 'rotor.armLength': 1.0 } } },
  { id: 'ornithopter-top', title: 'Орнитоптер с четырьмя парами крыльев сверху', view: 'top', style: 'line', ref: { kind: 'dimension', what: 'length', label: '16 м' },
    draw: { kind: 'flap', length: 16, width: 3, height: 3, wingsPerSide: 4, span: 10, chord: 1.2 },
    expect: { inScope: true, class: 'flapping', counts: { 'flapping.wingsPerSide': 4 }, ratios: { 'wing/length': 10 / 16, 'chord/wing': 1.2 / 10 }, sizes: { 'flapping.span': 10 } } },
  { id: 'musclebird-front', title: 'Махолёт спереди, чертёж, рядом человек', view: 'front', style: 'blueprint', ref: { kind: 'person' }, text: 'Мускулолёт.',
    draw: { kind: 'flap', length: 2.5, width: 0.8, height: 1.2, wingsPerSide: 1, span: 15.6, chord: 1.5 },
    expect: { inScope: true, class: 'flapping', counts: { 'flapping.wingsPerSide': 1 }, ratios: {}, sizes: { 'flapping.span': 15.6 } } },
  { id: 'chair', title: 'Стул (не транспорт)', view: 'side', style: 'line', ref: { kind: 'none' }, draw: { kind: 'chair' }, expect: { inScope: false } },
  { id: 'house', title: 'Дом и дерево (не транспорт)', view: 'side', style: 'silhouette', ref: { kind: 'none' }, draw: { kind: 'house' }, expect: { inScope: false } },
];

export function ratioOf(d: Design, name: RatioName): number | null {
  const F = d.fuselage;
  if (name === 'span/length') return d.fixedWing ? d.fixedWing.span / F.length : null;
  if (name === 'chord/span') return d.fixedWing ? (d.fixedWing.rootChord + d.fixedWing.tipChord) / 2 / d.fixedWing.span : null;
  if (name === 'rotorDiameter/length') return d.rotor ? (2 * d.rotor.radius) / F.length : null;
  if (name === 'arm/radius') return d.rotor ? d.rotor.armLength / d.rotor.radius : null;
  if (name === 'wing/length') return d.flapping ? d.flapping.span / F.length : null;
  if (name === 'chord/wing') return d.flapping ? d.flapping.chord / d.flapping.span : null;
  return null;
}

export const TOLERANCE = 0.25;

export interface CaseScore {
  id: string;
  identified: boolean; // класс и число крыльев/винтов верны (или верно отклонено)
  rejectedWithReason?: boolean;
  problems: string[];
  ratios: { name: string; expected: number; got: number | null; dev: number | null; ok: boolean }[];
  sizes: { field: string; expected: number; got: number | null; dev: number | null; ok: boolean }[];
}

/** Сравнить ответ генерации с разметкой. error — текст отказа, если генерация не дала проекта;
 *  fromAi = false — ошибка запроса (сеть, ключ), а не решение ИИ: отказом с объяснением не считается. */
export function scoreCase(c: ImageCase, design: Design | null, error?: string, fromAi = true): CaseScore {
  const out: CaseScore = { id: c.id, identified: false, problems: [], ratios: [], sizes: [] };
  const e = c.expect;
  if (!fromAi) {
    out.problems.push(`ошибка запроса: ${error ?? '—'}`);
    return out;
  }
  if (!e.inScope) {
    out.rejectedWithReason = !design && !!error && error.length > 25;
    out.identified = !!out.rejectedWithReason;
    if (design) out.problems.push(`принято за аппарат «${design.name}»`);
    else if (!out.rejectedWithReason) out.problems.push(`отказ без объяснения: ${error ?? '—'}`);
    return out;
  }
  if (!design) {
    out.problems.push(error ?? 'нет проекта');
    return out;
  }
  let ok = design.vehicleClass === e.class;
  if (!ok) out.problems.push(`класс ${design.vehicleClass}, ожидался ${e.class}`);
  for (const [f, v] of Object.entries(e.counts)) {
    const got = getPath(design, f);
    if (got !== v) {
      ok = false;
      out.problems.push(`${f} = ${got}, ожидалось ${v}`);
    }
  }
  out.identified = ok;
  for (const [name, expected] of Object.entries(e.ratios) as [RatioName, number][]) {
    const got = ratioOf(design, name);
    const dev = got === null ? null : Math.abs(got / expected - 1);
    out.ratios.push({ name, expected, got, dev, ok: dev !== null && dev <= TOLERANCE });
  }
  for (const [field, expected] of Object.entries(e.sizes ?? {})) {
    const got = getPath(design, field);
    const g = typeof got === 'number' ? got : null;
    const dev = g === null ? null : Math.abs(g / expected - 1);
    out.sizes.push({ field, expected, got: g, dev, ok: dev !== null && dev <= TOLERANCE });
  }
  return out;
}
