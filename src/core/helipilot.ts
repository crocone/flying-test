// Автопилот вертолёта в свободном полёте — как лётчик, без «заглядывания» в модель: только то, что видно по приборам
// (высота, вертикальная скорость, скорость, углы, угловые скорости) и ручки управления.
//
// Контуры (все — ПИ или ПИД с ограничениями хода ручек):
// - общий шаг держит вертикальную скорость (высоту — через неё);
// - продольный циклический шаг держит тангаж; тангаж задаётся по скорости (быстрее нужного — нос вверх);
// - поперечный циклический шаг держит крен; крен задаётся по боковой скорости (снос вправо — крен влево) или явно;
// - педали держат курс; на скорости курс — по направлению полёта (скольжение — к нулю).
//
// Знаки — как у R22 в этом стенде: продольный «−» — диск вперёд (нос вниз), поперечный «+» — диск влево (крен влево),
// педали «+» — больше тяги хвостового винта (нос влево у винта, вращающегося против часовой стрелки сверху). Коэффициенты
// подобраны на висении R22 (устойчиво с запасом по фазе); у вертолёта с другим знаком вращения педали меняют знак сами.
import type { Sim } from './sim.ts';
import type { Control } from './spec.ts';
import { clamp, copy, unrotate } from './vec.ts';

export interface HeliCmd {
  h?: number; // высота (м над землёй) — общий шаг держит её
  vz?: number; // или вертикальную скорость, м/с
  collective?: number; // или общий шаг задан (авторотация, проверка)
  u?: number; // продольная скорость, м/с (воздушная, в осях корпуса)
  theta?: number; // или тангаж, °
  phi?: number; // крен, ° (без него — крен по боковой скорости)
  heading?: number; // курс, ° (без него на скорости — по полёту, на висении — держится текущий)
  lonFixed?: number; // ручки зажаты (испытание): заданные значения, контур выключен
  latFixed?: number;
  pedFixed?: number;
}

export class HeliPilot {
  private cI: number;
  private lonI = 0;
  private latI = 0;
  private pedI: number;
  private thI = 0;
  private phI = 0;
  private psiHold: number | null = null;
  readonly dirSign: number;
  private sim: Sim;
  private c: { col: Control; lon: Control; lat: Control; ped?: Control };
  constructor(sim: Sim, c: { col: Control; lon: Control; lat: Control; ped?: Control }, spinDirection = 1) {
    this.sim = sim;
    this.c = c;
    this.cI = sim.channels[c.col.channel] ?? c.col.initial;
    this.pedI = c.ped ? sim.channels[c.ped.channel] ?? c.ped.initial : 0;
    this.dirSign = spinDirection;
  }

  /** Угловые скорости в осях корпуса, °/с: p — крен (+ вправо), q — тангаж (+ нос вверх), r — курс (+ вправо). */
  rates() {
    const rb = this.sim.root.b.rb;
    const w = unrotate(rb.rotation(), copy(rb.angvel()));
    return { p: (w.x * 180) / Math.PI, q: (w.z * 180) / Math.PI, r: (-w.y * 180) / Math.PI };
  }
  /** Скорость относительно воздуха в осях корпуса: x — вперёд, z — вправо. */
  airBody() {
    const rb = this.sim.root.b.rb;
    const v = copy(rb.linvel());
    const w = this.sim.opts.wind;
    return unrotate(rb.rotation(), { x: v.x - w.x, y: v.y - w.y, z: v.z - w.z });
  }

  step(cmd: HeliCmd) {
    const sim = this.sim, s = sim.sample, dt = sim.dt, ch = sim.channels, C = this.c;
    const rb = sim.root.b.rb;
    const w = this.rates();
    const vb = this.airBody();
    // Общий шаг.
    if (cmd.collective !== undefined) {
      ch[C.col.channel] = clamp(cmd.collective, C.col.min, C.col.max);
      this.cI = ch[C.col.channel];
    } else {
      const vzCmd = cmd.vz ?? clamp(0.5 * ((cmd.h ?? rb.translation().y) - rb.translation().y), -4, 4);
      const e = vzCmd - rb.linvel().y;
      this.cI = clamp(this.cI + 0.8 * e * dt, C.col.min, C.col.max);
      ch[C.col.channel] = clamp(this.cI + 1.0 * e, C.col.min, C.col.max);
    }
    // Тангаж.
    let thCmd: number;
    if (cmd.theta !== undefined) thCmd = cmd.theta;
    else {
      const eu = vb.x - (cmd.u ?? 0);
      this.thI = clamp(this.thI + 0.15 * eu * dt, -15, 15);
      thCmd = clamp(this.thI + 2 * eu, -15, 15);
    }
    if (cmd.lonFixed !== undefined) { ch[C.lon.channel] = cmd.lonFixed; this.lonI = cmd.lonFixed; }
    else {
      const eth = thCmd - s.pitchDeg;
      this.lonI = clamp(this.lonI + 0.2 * eth * dt, C.lon.min, C.lon.max);
      ch[C.lon.channel] = clamp(this.lonI + 0.5 * eth - 0.5 * w.q, C.lon.min, C.lon.max);
    }
    // Крен.
    let phCmd: number;
    if (cmd.phi !== undefined) phCmd = cmd.phi;
    else {
      // На висении и малой скорости — против сноса; на скорости боковую скорость гасят педали (курс по полёту).
      const fast = Math.abs(vb.x) > 12;
      this.phI = fast ? this.phI * (1 - dt) : clamp(this.phI - 0.2 * vb.z * dt, -15, 15);
      phCmd = fast ? 0 : clamp(this.phI - 2 * vb.z, -15, 15);
    }
    if (cmd.latFixed !== undefined) { ch[C.lat.channel] = cmd.latFixed; this.latI = cmd.latFixed; }
    else {
      const eph = phCmd - s.rollDeg;
      this.latI = clamp(this.latI - 0.2 * eph * dt, C.lat.min, C.lat.max);
      ch[C.lat.channel] = clamp(this.latI - 0.3 * eph + 0.3 * w.p, C.lat.min, C.lat.max);
    }
    // Педали: курс. Больше тяги хвостового винта — нос против вращения несущего (у R22 — влево, курс уменьшается).
    if (C.ped) {
      if (cmd.pedFixed !== undefined) { ch[C.ped.channel] = cmd.pedFixed; this.pedI = cmd.pedFixed; this.psiHold = null; }
      else {
        const fast = Math.hypot(vb.x, vb.z) > 12;
        let psiCmd: number;
        if (cmd.heading !== undefined) { psiCmd = cmd.heading; this.psiHold = null; }
        else if (fast) { psiCmd = s.headingDeg + s.betaDeg; this.psiHold = null; }
        else psiCmd = this.psiHold ??= s.headingDeg;
        const eps = ((psiCmd - s.headingDeg + 540) % 360) - 180;
        const k = this.dirSign;
        this.pedI = clamp(this.pedI - k * 0.1 * eps * dt, C.ped.min, C.ped.max);
        ch[C.ped.channel] = clamp(this.pedI - k * (0.25 * eps - 0.2 * w.r), C.ped.min, C.ped.max);
      }
    }
  }
}
