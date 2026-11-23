// Векторы и кватернионы. Без зависимостей: ядро работает и в браузере, и в Node.

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Q {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const fromArr = (a: readonly number[]): V3 => ({ x: a[0], y: a[1], z: a[2] });
export const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : v3();
};
export const addTo = (acc: V3, b: V3): void => {
  acc.x += b.x;
  acc.y += b.y;
  acc.z += b.z;
};

export const qIdentity = (): Q => ({ x: 0, y: 0, z: 0, w: 1 });
export const qConj = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qMul(a: Q, b: Q): Q {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
export function qAxisAngle(axis: V3, angle: number): Q {
  const n = norm(axis);
  const s = Math.sin(angle / 2);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(angle / 2) };
}
/** Углы Эйлера в градусах, порядок применения: сначала X, потом Y, потом Z (внешние оси). */
export function qEulerDeg(e: readonly number[] | undefined): Q {
  if (!e) return qIdentity();
  const r = Math.PI / 180;
  const qx = qAxisAngle(v3(1, 0, 0), e[0] * r);
  const qy = qAxisAngle(v3(0, 1, 0), e[1] * r);
  const qz = qAxisAngle(v3(0, 0, 1), e[2] * r);
  return qMul(qz, qMul(qy, qx));
}
export function rotate(q: Q, v: V3): V3 {
  const u = v3(q.x, q.y, q.z);
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}
export const unrotate = (q: Q, v: V3): V3 => rotate(qConj(q), v);

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const deg = Math.PI / 180;
