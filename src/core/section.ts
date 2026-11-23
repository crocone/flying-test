// Геометрия сечения лонжерона в данной точке размаха.
import type { Structure } from './spec.ts';

export interface SectionProps {
  kind: 'box' | 'tube';
  b: number; // ширина (вдоль хорды), м
  h: number; // высота (по нормали), м
  t: number; // стенка, м
  area: number; // площадь материала, м²
  iFlap: number; // момент инерции при изгибе взмаха (вокруг оси хорды), м⁴
  iLag: number; // при изгибе в плоскости крыла (вокруг нормали), м⁴
  enclosed: number; // площадь, охватываемая средней линией стенки (кручение), м²
  flangeWidth: number; // свободная ширина сжатой полки (потеря устойчивости), м
  webHeight: number; // высота стенки, м
  filled: boolean; // стенки подкреплены заполнителем: местная потеря устойчивости не грозит
}

/** chord и thickness — хорда и относительная толщина профиля в этом сечении. */
export function sectionAt(s: Structure, chord: number, thickness: number): SectionProps {
  if (s.section === 'tube') {
    const D = s.diameter ?? chord * thickness;
    const t = Math.min(s.wall, D / 2);
    const d = D - 2 * t;
    const I = (Math.PI * (D ** 4 - d ** 4)) / 64;
    return {
      kind: 'tube',
      b: D,
      h: D,
      t,
      area: (Math.PI * (D * D - d * d)) / 4,
      iFlap: I,
      iLag: I,
      enclosed: (Math.PI * (D - t) ** 2) / 4,
      flangeWidth: D, // для трубы устойчивость считается по оболочке, см. strength.ts
      webHeight: D,
      filled: !!s.filled,
    };
  }
  const b = (s.widthFrac ?? 0.25) * chord;
  const h = (s.heightFrac ?? 1) * thickness * chord;
  const t = Math.min(s.wall, b / 2, h / 2);
  const bi = b - 2 * t;
  const hi = h - 2 * t;
  return {
    kind: 'box',
    b,
    h,
    t,
    area: b * h - bi * hi,
    iFlap: (b * h ** 3 - bi * hi ** 3) / 12,
    iLag: (h * b ** 3 - hi * bi ** 3) / 12,
    enclosed: (b - t) * (h - t),
    flangeWidth: Math.max(b - t, 1e-9),
    webHeight: Math.max(h - t, 1e-9),
    filled: !!s.filled,
  };
}
