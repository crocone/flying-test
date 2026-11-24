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
  // Изгиб в плоскости крыла при заданном кессоне: его несёт весь кессон (лонжерон, обшивка сверху и снизу, задняя
  // стенка), а не один лонжерон. iLag — тогда момент инерции кессона, lagArm — расстояние от его нейтральной оси
  // до дальнего волокна лонжерона, lagQ — статический момент части сечения за лонжероном (срез).
  lagArm?: number;
  lagQ?: number;
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
  const area = b * h - bi * hi;
  const iLag = (h * b ** 3 - hi * bi ** 3) / 12;
  const out: SectionProps = {
    kind: 'box',
    b,
    h,
    t,
    area,
    iFlap: (b * h ** 3 - bi * hi ** 3) / 12,
    iLag,
    enclosed: (b - t) * (h - t),
    flangeWidth: Math.max(b - t, 1e-9),
    webHeight: Math.max(h - t, 1e-9),
    filled: !!s.filled,
  };
  const tb = s.torsionBox;
  if (tb && tb.to > tb.from) {
    // Кессон в плоскости крыла: обшивка сверху и снизу шириной w, лонжерон (вся коробка) у передней стенки,
    // задняя стенка — высотой профиля в этом месте, толщиной как обшивка (толщины задней стенки в спецификации нет).
    // Обшивка считается работающей целиком: под сжатием тонкая обшивка теряет устойчивость раньше, это завышает
    // жёсткость и прочность в плоскости — но изгиб в плоскости у крыла самолёта и так далёк от расчётного.
    const w = (tb.to - tb.from) * chord;
    const ts = tb.skin;
    const xSp = clamp01(((s.sparAt ?? 0.3) - tb.from) * chord, w);
    const hR = nacaThickness(tb.to) * thickness * chord;
    const parts = [
      { A: area, x: xSp, I: iLag },
      { A: 2 * ts * w, x: w / 2, I: (2 * ts * w ** 3) / 12 },
      { A: ts * hR, x: w, I: 0 },
    ];
    const At = parts.reduce((q, p) => q + p.A, 0);
    const xc = parts.reduce((q, p) => q + p.A * p.x, 0) / At;
    const I = parts.reduce((q, p) => q + p.I + p.A * (p.x - xc) ** 2, 0);
    if (I > iLag) {
      out.iLag = I;
      out.lagArm = Math.abs(xSp - xc) + b / 2;
      out.lagQ = area * Math.abs(xSp - xc);
    }
  }
  return out;
}

const clamp01 = (x: number, w: number) => Math.min(Math.max(x, 0), w);
/** Полная толщина четырёхзначного профиля NACA на доле хорды x, в долях наибольшей. */
function nacaThickness(x: number): number {
  return 5 * 2 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
}
