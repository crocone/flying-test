// Потоки воздуха на картинке: тонкие полупрозрачные белые линии тока вокруг аппарата.
// Только визуализация — в расчёт ничего не возвращается. Поле скорости воздуха строится в системе аппарата:
// набегающий поток (ветер минус скорость корпуса) плюс индуктивный поток от каждого несущего «диска» —
// диска несущего винта (его индуктивная скорость берётся из модели) и каждой несущей поверхности вне винтов
// (индуктивная скорость — по импульсной теории из её аэродинамической силы). Струя за диском разгоняется
// вдвое и сужается в √2 раз, у земли растекается в стороны.
import * as THREE from 'three';
import type { PartModel, Sim } from '../core/sim.ts';
import { add, rotate, type V3 } from '../core/vec.ts';

interface Disk {
  c: V3; // центр, мир
  n: V3; // направление силы (воздух отбрасывается против него)
  w: V3; // ось струи: куда уходит воздух за диском
  R: number;
  vi: number; // индуктивная скорость в плоскости диска, м/с
}

const N = 380; // линий тока
const K = 12; // точек в линии

export class Airflow {
  readonly object: THREE.LineSegments;
  private pos = new Float32Array(N * (K - 1) * 2 * 3);
  private col = new Float32Array(N * (K - 1) * 2 * 4);
  private geo = new THREE.BufferGeometry();
  // Голова линии — в осях, перенесённых вместе с корнем аппарата (без поворота).
  private head = new Float32Array(N * 3);
  private age = new Float32Array(N);
  private life = new Float32Array(N);
  private disks: Disk[] = [];
  private smooth = new Map<PartModel, V3>();
  private fs: V3 = { x: 0, y: 0, z: 0 }; // набегающий поток в системе аппарата
  private anchor: V3 = { x: 0, y: 0, z: 0 };
  private D = 3; // полуразмер области
  private uRef = 1;
  private viMax = 0;
  private sim: Sim | null = null;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.object = new THREE.LineSegments(
      this.geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
    this.object.visible = false;
  }

  /** Новый аппарат: всё заново. */
  reset() {
    this.sim = null;
    this.smooth.clear();
    this.age.fill(0);
    this.life.fill(0);
    this.object.visible = false;
  }

  /**
   * dtModel — сколько модельного времени прошло с прошлого кадра (в паузе 0: линии замирают).
   * sizeR — характерный размер аппарата, м.
   */
  update(sim: Sim, dtModel: number, sizeR: number, enabled: boolean) {
    if (!enabled) {
      this.object.visible = false;
      return;
    }
    if (sim !== this.sim) {
      this.reset();
      this.sim = sim;
    }
    const rt = sim.root.b.rb.translation();
    const lv = sim.root.b.rb.linvel();
    const wind = sim.opts.wind;
    this.anchor = { x: rt.x, y: rt.y, z: rt.z };
    this.fs = { x: wind.x - lv.x, y: wind.y - lv.y, z: wind.z - lv.z };
    this.D = Math.max(1.5, sizeR * 2.2);
    this.collectDisks(sim, Math.max(0, dtModel));

    const fsV = Math.hypot(this.fs.x, this.fs.y, this.fs.z);
    let maxV = fsV;
    this.viMax = 0;
    for (const d of this.disks) {
      maxV = Math.max(maxV, 2 * d.vi);
      this.viMax = Math.max(this.viMax, d.vi);
    }
    // Опорная скорость меняется плавно, иначе длина штрихов дёргается от взмаха к взмаху.
    this.uRef += (Math.max(maxV, 0.3) - this.uRef) * 0.08;
    if (maxV < 0.05) {
      this.object.visible = false;
      return;
    }

    const lenMax = sizeR * 0.9;
    const D = this.D;
    const u: V3 = { x: 0, y: 0, z: 0 };
    const p: V3 = { x: 0, y: 0, z: 0 };
    let vtx = 0;
    for (let i = 0; i < N; i++) {
      let hx = this.head[3 * i], hy = this.head[3 * i + 1], hz = this.head[3 * i + 2];
      // Шаг частицы вместе с воздухом: модельное время, поэтому в замедлении поток тоже замедлен.
      if (this.life[i] > 0 && dtModel > 0) {
        const sub = Math.min(4, Math.max(1, Math.ceil(dtModel * this.uRef / (0.05 * D))));
        const h = dtModel / sub;
        for (let s = 0; s < sub; s++) {
          p.x = this.anchor.x + hx; p.y = this.anchor.y + hy; p.z = this.anchor.z + hz;
          this.field(p, u);
          hx += u.x * h; hy += u.y * h; hz += u.z * h;
        }
        this.age[i] += dtModel;
      }
      const out = Math.abs(hx) > D * 1.15 || Math.abs(hz) > D * 1.15 || Math.abs(hy) > D * 1.15 || this.anchor.y + hy < 0;
      if (this.life[i] <= 0 || this.age[i] > this.life[i] || out || dtModel * this.uRef > D) {
        const first = this.life[i] <= 0;
        [hx, hy, hz] = this.spawn(i);
        // Первое рождение — вразнобой по возрасту, иначе все линии потом гаснут и рождаются разом.
        if (first) this.age[i] = Math.random() * this.life[i];
      }
      this.head[3 * i] = hx; this.head[3 * i + 1] = hy; this.head[3 * i + 2] = hz;

      // Хвост — линия тока назад от головы: направление поля, длина пропорциональна скорости.
      p.x = this.anchor.x + hx; p.y = this.anchor.y + hy; p.z = this.anchor.z + hz;
      this.field(p, u);
      const sp = Math.hypot(u.x, u.y, u.z);
      // Частица в почти неподвижном воздухе не видна — пусть быстрее уступит место новой.
      if (sp < 0.06 * this.uRef) this.age[i] += dtModel * 6;
      const L = lenMax * Math.min(1, sp / this.uRef);
      const env = Math.sin(Math.PI * Math.min(1, this.age[i] / this.life[i]));
      // Струи от винтов и крыльев ярче ровного набегающего потока: он — фон, они — то, что делает аппарат.
      const ind = Math.hypot(u.x - this.fs.x, u.y - this.fs.y, u.z - this.fs.z);
      const a0 = env * Math.min(1, (sp / this.uRef) * 3) * (0.3 + 0.35 * Math.min(1, ind / (this.viMax + 1e-6)));
      if (L < sizeR * 0.01 || a0 < 0.01) {
        // Неподвижный воздух — линии нет: схлопнуть сегменты.
        for (let j = 0; j < K - 1; j++) {
          for (let e = 0; e < 2; e++) {
            this.pos.set([p.x, p.y, p.z], vtx * 3);
            this.col.set([0, 0, 0, 0], vtx * 4);
            vtx++;
          }
        }
        continue;
      }
      const step = L / (K - 1);
      let qx = p.x, qy = p.y, qz = p.z;
      let ux = u.x / sp, uy = u.y / sp, uz = u.z / sp;
      for (let j = 0; j < K - 1; j++) {
        const nx = qx - ux * step, ny = Math.max(0.01, qy - uy * step), nz = qz - uz * step;
        const aA = a0 * (1 - j / (K - 1)) ** 1.4;
        const aB = a0 * (1 - (j + 1) / (K - 1)) ** 1.4;
        this.pos.set([qx, qy, qz, nx, ny, nz], vtx * 3);
        this.col.set([1, 1, 1, aA, 1, 1, 1, aB], vtx * 4);
        vtx += 2;
        qx = nx; qy = ny; qz = nz;
        p.x = qx; p.y = qy; p.z = qz;
        this.field(p, u);
        const s2 = Math.hypot(u.x, u.y, u.z);
        if (s2 > 1e-6) { ux = u.x / s2; uy = u.y / s2; uz = u.z / s2; }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.object.visible = true;
  }

  /** Новая частица: чаще — у несущих дисков (на входе в струю), иначе — где угодно в области. */
  private spawn(i: number): [number, number, number] {
    const D = this.D;
    const a = this.anchor;
    let x: number, y: number, z: number;
    const fsV = Math.hypot(this.fs.x, this.fs.y, this.fs.z);
    // Без набегающего потока (висение) воздух движется только в струях — почти все линии рождаются у дисков.
    const nearDisk = fsV > 0.3 * this.uRef ? 0.6 : 0.9;
    if (this.disks.length && Math.random() < nearDisk) {
      // Вес диска — по расходу воздуха через него.
      let tot = 0;
      for (const d of this.disks) tot += d.vi * d.R * d.R;
      let r = Math.random() * tot;
      let d = this.disks[0];
      for (const k of this.disks) if ((r -= k.vi * k.R * k.R) <= 0) { d = k; break; }
      // Точка на диске (равномерно по площади), сдвинутая немного вверх по течению.
      const ref = Math.abs(d.w.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const e1 = norm(cross(d.w, ref)), e2 = cross(d.w, e1);
      const rr = d.R * Math.sqrt(Math.random()) * 0.98, th = Math.random() * 2 * Math.PI;
      const s = -d.R * (0.1 + 0.9 * Math.random());
      x = d.c.x + e1.x * rr * Math.cos(th) + e2.x * rr * Math.sin(th) + d.w.x * s - a.x;
      y = d.c.y + e1.y * rr * Math.cos(th) + e2.y * rr * Math.sin(th) + d.w.y * s - a.y;
      z = d.c.z + e1.z * rr * Math.cos(th) + e2.z * rr * Math.sin(th) + d.w.z * s - a.z;
      this.life[i] = Math.min(6, (3 * d.R) / Math.max(d.vi, 0.3)) * (0.6 + 0.8 * Math.random());
    } else {
      x = (Math.random() * 2 - 1) * D;
      y = Math.max(-a.y + 0.02, (Math.random() * 2 - 1) * D);
      z = (Math.random() * 2 - 1) * D;
      // В набегающем потоке частица рождается на входе в область и проходит её насквозь.
      if (fsV > 0.05) {
        const fx = this.fs.x / fsV, fy = this.fs.y / fsV, fz = this.fs.z / fsV;
        const along = x * fx + y * fy + z * fz;
        const back = -D - along + Math.random() * 0.6 * D;
        x += fx * back; y += fy * back; z += fz * back;
        y = Math.max(-a.y + 0.02, y);
      }
      this.life[i] = Math.min(8, (2.4 * D) / Math.max(fsV, this.uRef * 0.5, 0.3)) * (0.7 + 0.6 * Math.random());
    }
    this.age[i] = 0;
    return [x, y, z];
  }

  /** Несущие диски: винты целиком и несущие поверхности вне винтов. */
  private collectDisks(sim: Sim, dt: number) {
    const disks: Disk[] = [];
    const rho = sim.rho || 1.225;
    const fs = this.fs;
    const tau = 0.06;
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
    for (const r of sim.rotors) {
      if (r.hub.broken || !(r.inflow > 0.01)) continue;
      const c = sim.pose(r.hub).t;
      const n = r.axisW;
      disks.push(this.disk(c, n, r.radius, r.inflow, fs));
    }
    for (const p of sim.parts) {
      if (p.broken || p.rotor || !p.elements.length || !p.spec.aero) continue;
      const prev = this.smooth.get(p) ?? { x: 0, y: 0, z: 0 };
      const F = p.aeroForce;
      const f = { x: prev.x + (F.x - prev.x) * k, y: prev.y + (F.y - prev.y) * k, z: prev.z + (F.z - prev.z) * k };
      this.smooth.set(p, f);
      const T = Math.hypot(f.x, f.y, f.z);
      if (T < 1e-6) continue;
      const { t, q } = sim.pose(p);
      const pts = p.elements.map((e) => add(t, rotate(q, e.r)));
      const c = pts.reduce((s, x) => ({ x: s.x + x.x / pts.length, y: s.y + x.y / pts.length, z: s.z + x.z / pts.length }), { x: 0, y: 0, z: 0 });
      let R = 0;
      for (const x of pts) R = Math.max(R, Math.hypot(x.x - c.x, x.y - c.y, x.z - c.z));
      R = Math.max(R + 0.5 * (p.elements[p.elements.length - 1].dr || 0), 0.05);
      const n = { x: f.x / T, y: f.y / T, z: f.z / T };
      // Импульсная теория с набегающим потоком: vᵢ = T / (2ρA·√(V² + vᵢ²)).
      const A = Math.PI * R * R;
      const V2 = fs.x * fs.x + fs.y * fs.y + fs.z * fs.z;
      let vi = Math.sqrt(T / (2 * rho * A));
      for (let it = 0; it < 6; it++) vi = T / (2 * rho * A * Math.sqrt(V2 + vi * vi));
      disks.push(this.disk(c, n, R, vi, fs));
    }
    this.disks = disks;
  }

  private disk(c: V3, n: V3, R: number, vi: number, fs: V3): Disk {
    const wx = fs.x - n.x * vi, wy = fs.y - n.y * vi, wz = fs.z - n.z * vi;
    const wl = Math.hypot(wx, wy, wz) || 1;
    return { c: { x: c.x, y: c.y, z: c.z }, n, w: { x: wx / wl, y: wy / wl, z: wz / wl }, R, vi };
  }

  /** Скорость воздуха относительно аппарата в точке p (мир). */
  private field(p: V3, out: V3) {
    out.x = this.fs.x; out.y = this.fs.y; out.z = this.fs.z;
    for (const d of this.disks) {
      const dx = p.x - d.c.x, dy = p.y - d.c.y, dz = p.z - d.c.z;
      const s = dx * d.w.x + dy * d.w.y + dz * d.w.z; // вниз по струе
      const rx = dx - s * d.w.x, ry = dy - s * d.w.y, rz = dz - s * d.w.z;
      const r = Math.hypot(rx, ry, rz);
      const R = d.R;
      // Осевой профиль идеального диска: 0 далеко впереди, 1 в плоскости, 2 далеко позади.
      const kAx = 1 + s / Math.sqrt(s * s + R * R);
      // Сужение струи до R/√2.
      const Rw = s <= 0 ? R * (1 + 0.25 * Math.min(1, -s / R)) : R * (0.7071 + 0.2929 * Math.exp(-s / R));
      const q = r / Rw;
      const fall = 1 / (1 + q ** (s > 0 ? 10 : 4));
      if (fall < 1e-3) continue;
      const v = d.vi * kAx * fall;
      out.x -= d.n.x * v; out.y -= d.n.y * v; out.z -= d.n.z * v;
      // Подтекание к оси у входа в диск — линии сходятся.
      if (r > 1e-6) {
        const conv = 0.35 * d.vi * (r / R) * Math.exp(-((s / R + 0.3) ** 2) * 2) * fall;
        out.x -= (rx / r) * conv; out.y -= (ry / r) * conv; out.z -= (rz / r) * conv;
      }
    }
    // Земля: вертикальная составляющая у поверхности переходит в растекание.
    const hg = Math.max(0.3, this.D * 0.18);
    if (p.y < hg && out.y < 0) {
      const b = 1 - Math.max(0, p.y) / hg;
      const down = -out.y * b;
      out.y += down;
      // От ближайшего диска — радиально наружу.
      let best: Disk | null = null, bd = Infinity;
      for (const d of this.disks) {
        const dd = (p.x - d.c.x) ** 2 + (p.z - d.c.z) ** 2;
        if (dd < bd) { bd = dd; best = d; }
      }
      const ox = best ? p.x - best.c.x : 1, oz = best ? p.z - best.c.z : 0;
      const ol = Math.hypot(ox, oz) || 1;
      out.x += (ox / ol) * down;
      out.z += (oz / ol) * down;
    }
  }
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(a: V3): V3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
