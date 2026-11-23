// Параметрические рисунки аппаратов для проверочного набора этапа 5: чертежи и силуэты
// в виде сбоку, сверху и спереди, с эталоном масштаба (человек, размерная линия, сетка) или без.
// Размеры заданы в метрах, поэтому разметка (класс, число крыльев и винтов, пропорции) точная.

export type View = 'side' | 'top' | 'front';
export type Style = 'line' | 'silhouette' | 'blueprint';
export type ScaleRef = { kind: 'person' } | { kind: 'dimension'; what: 'length' | 'span' | 'rotor'; label: string } | { kind: 'grid'; stepM: number; label: string } | { kind: 'none' };

export type Drawable =
  | { kind: 'fixed'; length: number; width: number; height: number; span: number; rootChord: number; tipChord: number; highWing: boolean;
      tailSpan: number; tailChord: number; finHeight: number; propellers: number; propDiameter: number; wingPos: number }
  | { kind: 'heli'; cabinLength: number; cabinWidth: number; cabinHeight: number; boomLength: number; radius: number; blades: number; tailRotorR: number }
  | { kind: 'multi'; body: number; arm: number; radius: number; rotors: number }
  | { kind: 'flap'; length: number; width: number; height: number; wingsPerSide: number; span: number; chord: number }
  | { kind: 'chair' }
  | { kind: 'house' };

type Pt = [number, number];
type Shape =
  | { t: 'poly'; pts: Pt[]; fill?: boolean; close?: boolean; w?: number; dash?: boolean }
  | { t: 'circle'; c: Pt; r: number; fill?: boolean; w?: number; dash?: boolean }
  | { t: 'text'; at: Pt; s: string; size: number; anchor?: 'start' | 'middle' | 'end' };

const rect = (x0: number, y0: number, x1: number, y1: number, fill = true): Shape => ({ t: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, close: true });
const line = (a: Pt, b: Pt, w = 1, dash = false): Shape => ({ t: 'poly', pts: [a, b], w, dash });
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 48): Shape => ({
  t: 'poly', close: true, fill: true, pts: Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as Pt),
});
// Ось y в метрах — вверх; в SVG она будет перевёрнута.

function person(x: number): Shape[] {
  const h = 1.8;
  return [
    { t: 'circle', c: [x, h - 0.12], r: 0.12, fill: true },
    { t: 'poly', fill: true, close: true, pts: [[x - 0.21, h - 0.26], [x + 0.21, h - 0.26], [x + 0.17, 0.85], [x + 0.12, 0.85], [x + 0.1, 0], [x + 0.02, 0], [x, 0.7], [x - 0.02, 0], [x - 0.1, 0], [x - 0.12, 0.85], [x - 0.17, 0.85]] },
  ];
}

function trapezoidWing(side: 1 | -1, rootX: number, leY: number, cr: number, ct: number, b: number): Shape {
  // Вид сверху, нос вверх: размах вдоль x, хорда вдоль −y; четверть хорды без стреловидности.
  const sweep = 0.25 * (cr - ct);
  return { t: 'poly', fill: true, close: true, pts: [[rootX, leY], [rootX + side * b, leY - sweep], [rootX + side * b, leY - sweep - ct], [rootX, leY - cr]] };
}

/** Фигуры аппарата в метрах и опорные точки для размерной линии. */
function shapes(d: Drawable, view: View): { s: Shape[]; dims: Record<string, [Pt, Pt]>; ground: number | null } {
  const s: Shape[] = [];
  const dims: Record<string, [Pt, Pt]> = {};
  if (d.kind === 'fixed') {
    const L = d.length, W = d.width, H = d.height;
    if (view === 'top') {
      // Нос вверху (y = L), хвост внизу (y = 0).
      const body: Pt[] = [[0, L], [W * 0.35, L * 0.97], [W / 2, L * 0.85], [W / 2, L * 0.5], [W * 0.15, L * 0.02], [-W * 0.15, L * 0.02], [-W / 2, L * 0.5], [-W / 2, L * 0.85], [-W * 0.35, L * 0.97]];
      const le = L * (1 - d.wingPos);
      for (const side of [1, -1] as const) s.push(trapezoidWing(side, 0, le, d.rootChord, d.tipChord, d.span / 2));
      for (const side of [1, -1] as const) s.push(trapezoidWing(side, 0, d.tailChord * 1.1, d.tailChord * 1.1, d.tailChord * 0.8, d.tailSpan / 2));
      s.push({ t: 'poly', pts: body, fill: true, close: true });
      const D = d.propDiameter;
      if (d.propellers === 1) s.push(line([-D / 2, L + 0.08], [D / 2, L + 0.08], 3));
      else {
        const k = d.propellers / 2;
        for (const side of [1, -1] as const)
          for (let i = 0; i < k; i++) {
            const x = side * (d.span / 2) * (k === 1 ? 0.35 : 0.25 + (0.45 * i) / (k - 1));
            s.push(rect(x - 0.06 * D - 0.2, le + 0.4 * D, x + 0.06 * D + 0.2, le - d.rootChord * 0.8));
            s.push(line([x - D / 2, le + 0.45 * D], [x + D / 2, le + 0.45 * D], 3));
          }
      }
      dims.span = [[-d.span / 2, -0.12 * L], [d.span / 2, -0.12 * L]]; // ниже хвоста, ничего не пересекает
      dims.length = [[-d.span / 2 - 1.2, 0], [-d.span / 2 - 1.2, L]];
      return { s, dims, ground: null };
    }
    // Вид сбоку: нос слева (x = 0), хвост справа (x = L).
    const r = Math.max(0.2, H * 0.14);
    const yb = 2 * r; // низ фюзеляжа
    const top = yb + H;
    const body: Pt[] = [[0, yb + H * 0.45], [L * 0.08, yb + H * 0.85], [L * 0.22, top], [L * 0.45, top], [L * 0.75, yb + H * 0.75], [L, yb + H * 0.7], [L, yb + H * 0.5], [L * 0.6, yb + H * 0.15], [L * 0.3, yb], [L * 0.08, yb + H * 0.1]];
    s.push({ t: 'poly', pts: body, fill: true, close: true });
    const wy = d.highWing ? top + 0.05 : yb + 0.15;
    const wx = L * d.wingPos;
    s.push(rect(wx, wy, wx + d.rootChord, wy + 0.12 * d.rootChord));
    if (d.highWing) s.push(line([wx + 0.5 * d.rootChord, wy], [wx + 0.3 * d.rootChord, yb + 0.25], 3));
    s.push({ t: 'poly', fill: true, close: true, pts: [[L * 0.82, yb + H * 0.72], [L * 0.93, yb + H * 0.72 + d.finHeight], [L * 1.02, yb + H * 0.72 + d.finHeight], [L, yb + H * 0.6]] });
    s.push(rect(L * 0.86, yb + H * 0.6, L * 1.0, yb + H * 0.66));
    for (const x of [L * 0.12, L * 0.4]) {
      s.push(line([x, yb + 0.1], [x, r], 3));
      s.push({ t: 'circle', c: [x, r], r, fill: true });
    }
    s.push(line([-0.08, yb + H * 0.45 - d.propDiameter / 2], [-0.08, yb + H * 0.45 + d.propDiameter / 2], 4));
    dims.length = [[0, -0.5], [L, -0.5]];
    return { s, dims, ground: 0 };
  }
  if (d.kind === 'heli') {
    const Lc = d.cabinLength, Hc = d.cabinHeight, Wc = d.cabinWidth, R = d.radius;
    if (view === 'top') {
      s.push(ellipse(0, 0, Wc / 2, Lc / 2)); // кабина, нос вверх
      s.push({ t: 'poly', fill: true, close: true, pts: [[-0.18 * Wc, -Lc / 2 + 0.1], [0.18 * Wc, -Lc / 2 + 0.1], [0.06 * Wc, -Lc / 2 - d.boomLength], [-0.06 * Wc, -Lc / 2 - d.boomLength]] });
      s.push(line([0.06 * Wc + 0.05, -Lc / 2 - d.boomLength + 0.1], [0.06 * Wc + 0.05, -Lc / 2 - d.boomLength + 0.1 + 2 * d.tailRotorR * 0.2], 3));
      const c = Math.max(0.06 * R, 0.15);
      for (let k = 0; k < d.blades; k++) {
        const a = (2 * Math.PI * k) / d.blades + 0.35;
        const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
        s.push({ t: 'poly', fill: true, close: true, pts: [[0.15 * ux + nx * c / 2, 0.15 * uy + ny * c / 2], [R * ux + nx * c / 2, R * uy + ny * c / 2], [R * ux - nx * c / 2, R * uy - ny * c / 2], [0.15 * ux - nx * c / 2, 0.15 * uy - ny * c / 2]] });
      }
      s.push({ t: 'circle', c: [0, 0], r: R, w: 1, dash: true });
      s.push({ t: 'circle', c: [0, 0], r: 0.25, fill: true });
      dims.rotor = [[-R, R + 0.8], [R, R + 0.8]];
      return { s, dims, ground: null };
    }
    // Сбоку: нос слева.
    const sk = 0.35; // высота полозьев
    const yb = sk + 0.1;
    const cab: Pt[] = Array.from({ length: 40 }, (_, i) => {
      const a = (2 * Math.PI * i) / 40;
      const x = Lc / 2 + (Lc / 2) * Math.cos(a);
      const y = yb + Hc / 2 + (Hc / 2) * Math.sin(a) * (Math.cos(a) > 0 ? 0.85 : 1);
      return [x, y];
    });
    s.push({ t: 'poly', pts: cab, fill: true, close: true });
    s.push({ t: 'poly', fill: true, close: true, pts: [[Lc * 0.85, yb + Hc * 0.65], [Lc + d.boomLength, yb + Hc * 0.62], [Lc + d.boomLength, yb + Hc * 0.52], [Lc * 0.85, yb + Hc * 0.3]] });
    s.push({ t: 'poly', fill: true, close: true, pts: [[Lc + d.boomLength - 0.5, yb + Hc * 0.6], [Lc + d.boomLength - 0.1, yb + Hc * 0.6 + 2 * d.tailRotorR], [Lc + d.boomLength + 0.1, yb + Hc * 0.6 + 2 * d.tailRotorR], [Lc + d.boomLength + 0.05, yb + Hc * 0.55]] });
    s.push({ t: 'circle', c: [Lc + d.boomLength - 0.05, yb + Hc * 0.6 + d.tailRotorR], r: d.tailRotorR, w: 1, dash: true });
    s.push(line([-0.1 * Lc, 0.05], [Lc * 1.05, 0.05], 4));
    for (const x of [Lc * 0.2, Lc * 0.75]) s.push(line([x, 0.05], [x + 0.1, yb + 0.05], 3));
    const mastY = yb + Hc + 0.35;
    s.push(line([Lc * 0.5, yb + Hc - 0.05], [Lc * 0.5, mastY], 4));
    s.push(rect(Lc * 0.5 - R, mastY - 0.05, Lc * 0.5 + R, mastY + 0.05));
    dims.rotor = [[Lc * 0.5 - R, mastY + 0.8], [Lc * 0.5 + R, mastY + 0.8]];
    dims.length = [[0, -0.5], [Lc, -0.5]];
    return { s, dims, ground: 0 };
  }
  if (d.kind === 'multi') {
    const B = d.body;
    for (let k = 0; k < d.rotors; k++) {
      const a = (2 * Math.PI * k) / d.rotors + Math.PI / d.rotors;
      const x = d.arm * Math.cos(a), y = d.arm * Math.sin(a);
      const w = Math.max(0.012, d.arm * 0.06); // полуширина луча
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      s.push({ t: 'poly', fill: true, close: true, pts: [[nx, ny], [x + nx, y + ny], [x - nx, y - ny], [-nx, -ny]] });
      s.push({ t: 'circle', c: [x, y], r: d.radius, w: 1, dash: true });
      const b = a + 0.6;
      s.push(line([x - d.radius * Math.cos(b), y - d.radius * Math.sin(b)], [x + d.radius * Math.cos(b), y + d.radius * Math.sin(b)], 3));
      s.push({ t: 'circle', c: [x, y], r: Math.max(0.015, d.radius * 0.12), fill: true });
    }
    s.push(rect(-B / 2, -B / 2, B / 2, B / 2));
    // Размерная линия — между осями двух противоположных винтов (2 × плечо), ниже аппарата.
    const yLow = -d.arm - d.radius * 1.4;
    dims.span = [[-d.arm, yLow], [d.arm, yLow]];
    return { s, dims, ground: null };
  }
  if (d.kind === 'flap') {
    const L = d.length, W = d.width, H = d.height;
    if (view === 'top') {
      for (const side of [1, -1] as const)
        for (let k = 0; k < d.wingsPerSide; k++) {
          const yc = d.wingsPerSide === 1 ? L * 0.55 : L / 2 + L * (0.3 - (0.6 * k) / (d.wingsPerSide - 1));
          const x0 = side * W * 0.45, x1 = side * (W * 0.45 + d.span);
          s.push({ t: 'poly', fill: true, close: true, pts: [[x0, yc + d.chord / 2], [x1, yc + d.chord * 0.35], [x1, yc - d.chord * 0.45], [x0, yc - d.chord / 2]] });
        }
      s.push(ellipse(0, L / 2, W / 2, L / 2));
      dims.length = [[-W * 0.45 - d.span - 1, 0], [-W * 0.45 - d.span - 1, L]];
      dims.span = [[-W * 0.45 - d.span, L + 0.08 * L], [W * 0.45 + d.span, L + 0.08 * L]];
      return { s, dims, ground: null };
    }
    // Спереди: крылья с небольшим поперечным V.
    const yc = 0.4 + H / 2 + 0.6;
    const dih = 6 * Math.PI / 180;
    for (const side of [1, -1] as const) {
      const x0 = side * W * 0.45, x1 = x0 + side * d.span * Math.cos(dih), y1 = yc + 0.25 * H + d.span * Math.sin(dih);
      s.push({ t: 'poly', fill: true, close: true, pts: [[x0, yc + 0.25 * H], [x1, y1], [x1, y1 - 0.06], [x0, yc + 0.25 * H - 0.12]] });
    }
    s.push(ellipse(0, yc, W / 2, H / 2));
    s.push(line([0, yc - H / 2], [0, 0.05], 3));
    s.push({ t: 'circle', c: [0, 0.3], r: 0.3, w: 2 });
    dims.span = [[-W * 0.45 - d.span, yc + d.span * Math.sin(dih) + 1], [W * 0.45 + d.span, yc + d.span * Math.sin(dih) + 1]];
    return { s, dims, ground: 0 };
  }
  if (d.kind === 'chair') {
    s.push(rect(0, 0.45, 0.45, 0.5));
    s.push(rect(0.4, 0.5, 0.45, 1.0));
    for (const x of [0.02, 0.4]) s.push(rect(x, 0, x + 0.04, 0.45));
    return { s, dims, ground: 0 };
  }
  // Дом и дерево.
  s.push(rect(0, 0, 8, 5));
  s.push({ t: 'poly', fill: true, close: true, pts: [[-0.5, 5], [4, 8.5], [8.5, 5]] });
  s.push(rect(1, 0, 2.2, 2.4, false));
  s.push(rect(4.5, 2.2, 6.5, 3.8, false));
  s.push(rect(11, 0, 11.6, 3));
  s.push({ t: 'circle', c: [11.3, 5], r: 2.6, fill: true });
  return { s, dims, ground: 0 };
}

const PALETTE: Record<Style, { bg: string; ink: string; fill: string; grid: string; text: string }> = {
  line: { bg: '#ffffff', ink: '#1b1b1b', fill: '#e6e6e6', grid: '#d0d0d0', text: '#1b1b1b' },
  silhouette: { bg: '#cfe3f3', ink: '#22262c', fill: '#2b3038', grid: '#a8c4dc', text: '#22262c' },
  blueprint: { bg: '#1d4e89', ink: '#f2f6ff', fill: '#2c64a6', grid: '#3c6fae', text: '#f2f6ff' },
};

export function drawSvg(d: Drawable, view: View, style: Style, ref: ScaleRef, W = 1400, H = 900): string {
  const { s, dims, ground } = shapes(d, view);
  if (ref.kind === 'person' && ground !== null) {
    let maxX = -Infinity;
    for (const sh of s) if (sh.t === 'poly') for (const p of sh.pts) maxX = Math.max(maxX, p[0]); else if (sh.t === 'circle') maxX = Math.max(maxX, sh.c[0] + sh.r);
    s.push(...person(maxX + 1.2));
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (p: Pt, r = 0) => { x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r); y0 = Math.min(y0, p[1] - r); y1 = Math.max(y1, p[1] + r); };
  for (const sh of s) if (sh.t === 'poly') sh.pts.forEach((p) => grow(p)); else if (sh.t === 'circle') grow(sh.c, sh.r);
  if (ref.kind === 'dimension') { const [a, b] = dims[ref.what]; grow(a); grow(b); }
  const margin = 90;
  const k = Math.min((W - 2 * margin) / (x1 - x0), (H - 2 * margin) / (y1 - y0));
  const ox = (W - k * (x1 - x0)) / 2 - k * x0;
  const oy = (H + k * (y1 - y0)) / 2 + k * y0;
  const P = (p: Pt) => `${(ox + k * p[0]).toFixed(1)},${(oy - k * p[1]).toFixed(1)}`;
  const c = PALETTE[style];
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="${c.bg}"/>`];
  if (ref.kind === 'grid') {
    const st = ref.stepM * k;
    for (let gx = ox % st; gx < W; gx += st) out.push(`<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${H}" stroke="${c.grid}" stroke-width="1"/>`);
    for (let gy = oy % st; gy < H; gy += st) out.push(`<line x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}" stroke="${c.grid}" stroke-width="1"/>`);
    out.push(`<rect x="24" y="${H - 64}" width="${Math.max(170, st + 140)}" height="44" fill="${c.bg}" opacity="0.85"/>`);
    out.push(`<line x1="36" y1="${H - 42}" x2="${(36 + st).toFixed(1)}" y2="${H - 42}" stroke="${c.ink}" stroke-width="3"/>`);
    out.push(`<text x="${(48 + st).toFixed(1)}" y="${H - 35}" font-family="Arial" font-size="22" fill="${c.text}">${ref.label}</text>`);
  }
  if (ground !== null) out.push(`<line x1="0" y1="${(oy - k * ground).toFixed(1)}" x2="${W}" y2="${(oy - k * ground).toFixed(1)}" stroke="${c.ink}" stroke-width="2" opacity="0.5"/>`);
  for (const sh of s) {
    if (sh.t === 'poly') {
      const tag = sh.close ? 'polygon' : 'polyline';
      const fill = sh.fill ? c.fill : 'none';
      out.push(`<${tag} points="${sh.pts.map(P).join(' ')}" fill="${fill}" stroke="${c.ink}" stroke-width="${(sh.w ?? 1) * 2}" stroke-linejoin="round"${sh.dash ? ' stroke-dasharray="10 8"' : ''}/>`);
    } else if (sh.t === 'circle') {
      const [cx, cy] = P(sh.c).split(',');
      out.push(`<circle cx="${cx}" cy="${cy}" r="${(sh.r * k).toFixed(1)}" fill="${sh.fill ? c.fill : 'none'}" stroke="${c.ink}" stroke-width="${(sh.w ?? 1) * 2}"${sh.dash ? ' stroke-dasharray="10 8"' : ''}/>`);
    }
  }
  if (ref.kind === 'dimension') {
    const [a, b] = dims[ref.what];
    const [ax, ay] = P(a).split(',').map(Number), [bx, by] = P(b).split(',').map(Number);
    const ang = Math.atan2(by - ay, bx - ax);
    const tick = (x: number, y: number) => `<line x1="${(x - 12 * Math.sin(ang)).toFixed(1)}" y1="${(y + 12 * Math.cos(ang)).toFixed(1)}" x2="${(x + 12 * Math.sin(ang)).toFixed(1)}" y2="${(y - 12 * Math.cos(ang)).toFixed(1)}" stroke="${c.ink}" stroke-width="2"/>`;
    out.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${c.ink}" stroke-width="2"/>`, tick(ax, ay), tick(bx, by));
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const vertical = Math.abs(Math.sin(ang)) > 0.7;
    out.push(`<text x="${(mx + (vertical ? -14 : 0)).toFixed(1)}" y="${(my - (vertical ? 0 : 12)).toFixed(1)}" font-family="Arial" font-size="26" fill="${c.text}" text-anchor="middle"${vertical ? ` transform="rotate(-90 ${(mx - 14).toFixed(1)} ${my.toFixed(1)})"` : ''}>${ref.label}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
