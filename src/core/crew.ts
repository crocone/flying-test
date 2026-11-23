// Пороги переносимости ускорений для экипажа (ТЗ, раздел 7.5). Источник — data/research.md.
//
// Смертельных уровней в открытых первоисточниках не нашлось. Поэтому верхний уровень
// здесь — «выход из строя»: при длительной перегрузке выше 6 g без защиты человек теряет
// сознание (G-LOC), и аппаратом некому управлять.
export const CREW_LIMITS = {
  // Длительная перегрузка (среднее за 1 с), g. NASA OCHMO-TB-024: 2–2,5 g — тяжело;
  // 4–6 g — потеря зрения, затем сознания; выше 6 g без защиты не переносится.
  sustained: { hard: 2.5, injurious: 4, lethal: 6 },
  // Удар (десятки миллисекунд), g. Низкий риск по модели Брикли: +Gz 15,2 g;
  // наибольший импульс сертификации кресел лёгких самолётов (14 CFR 23.562): 26 g.
  // Смертельный уровень — нет данных.
  impact: { hard: 15.2, injurious: 26, lethal: Infinity },
  // Вибрация, м/с² с.к.з. (ISO 2631-1): 1,25–2,5 — очень некомфортно;
  // 3–6 м/с² — зона осторожности для здоровья при воздействии до 10 мин.
  // Наша вибрация не взвешена фильтром Wk — это приближение.
  vibration: { hard: 1.25, injurious: 3 },
  // Вибрация считается по вектору ускорения в осях корпуса (ISO 2631-1, суммарное значение по трём осям
  // с весами 1 — оценка комфорта на сиденье): каждая составляющая проходит полосу 2–16 Гц.
  sources: [
    'https://www.nasa.gov/sites/default/files/atoms/files/acceleration_technical_brief_ochmo.pdf',
    'https://ntrs.nasa.gov/api/citations/20205003915/downloads/Lunar%20Transient%20Acceleration%20White%20Paper%20FINAL.pdf',
    'https://www.govinfo.gov/content/pkg/CFR-2012-title14-vol1/xml/CFR-2012-title14-vol1-sec23-562.xml',
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8125624/fullTextXML',
    'https://cdn.standards.iteh.ai/samples/45604/6c5aa7b485ec4a6b87724196d73bd02b/ISO-2631-1-1997-Amd-1-2010.pdf',
  ],
};

/**
 * Вибрация в кресле, м/с² (с.к.з.): каждая составляющая ускорения в осях корпуса проходит полосу 2–16 Гц
 * (два фильтра первого порядка: что медленнее 2 Гц — манёвр, что быстрее 16 Гц — почти не ощущается),
 * затем берётся с.к.з. модуля вектора за окно.
 * Раньше в полосу пропускался модуль ускорения |a − g|: продольная и боковая тряска меняют его лишь
 * во втором порядке (|g + a| ≈ g + a²/2g) и были почти не видны — тряска 2 м/с² вдоль корпуса
 * давала около 0,07 м/с².
 */
export class VibrationMeter {
  private hi: number[] = [];
  private lo: number[] = [];
  private buf: number[] = [];
  private i = 0;
  private sum = 0;
  private readonly kHi: number;
  private readonly kLo: number;
  private readonly n: number;
  constructor(dt: number, windowSeconds = 2) {
    // Коэффициент 1 − e^(−2πf·dt) устойчив при любом шаге.
    this.kHi = 1 - Math.exp(-2 * Math.PI * 16 * dt);
    this.kLo = 1 - Math.exp(-2 * Math.PI * 2 * dt);
    this.n = Math.max(1, Math.round(windowSeconds / dt));
  }
  /** a — ускорение кресла без тяжести (a − g), м/с², любые оси, связанные с корпусом. */
  push(a: readonly number[]): void {
    let s2 = 0;
    for (let k = 0; k < 3; k++) {
      if (this.hi[k] === undefined) {
        this.hi[k] = a[k];
        this.lo[k] = a[k];
      }
      this.hi[k] += this.kHi * (a[k] - this.hi[k]);
      this.lo[k] += this.kLo * (a[k] - this.lo[k]);
      s2 += (this.hi[k] - this.lo[k]) ** 2;
    }
    if (this.buf.length < this.n) this.buf.push(s2);
    else {
      this.sum -= this.buf[this.i];
      this.buf[this.i] = s2;
      this.i = (this.i + 1) % this.n;
    }
    this.sum += s2;
  }
  get full(): boolean {
    return this.buf.length >= this.n;
  }
  get rms(): number {
    return this.buf.length ? Math.sqrt(Math.max(0, this.sum / this.buf.length)) : 0;
  }
}

// ---------- Перегрузки по осям тела и длительности (data/research.md, часть 11) ----------
// Оси тела сидящего лицом вперёд человека — по осям корпуса аппарата: x — вперёд (+Gx «глаза внутрь»: аппарат
// разгоняется, человека вжимает в спинку), y — вверх (+Gz «глаза вниз»: вжимает в сиденье), z — вбок (Gy).
// Перегрузка — удельная сила кресла a − g в g: в горизонтальном полёте +1 Gz.
export type GAxis = '+Gx' | '-Gx' | 'Gy' | '+Gz' | '-Gz';
type Curve = [number, number][]; // (длительность, с; g)

// Норма NASA-STD-3001, т. 2, ред. C (2022), рис. 4–9: длительная перегрузка сидя, здоровый экипаж (полёт до 30 сут).
// Это предел для проектирования, с привязной системой и противоперегрузочным бельём, — «тяжело» в отчёте.
const DESIGN: Record<GAxis, Curve> = {
  '+Gx': [[0.5, 18.97], [5, 16.01], [300, 7.49]],
  '-Gx': [[0.5, 22.03], [5, 14.99], [120, 6.0], [400, 4.0]],
  Gy: [[0.5, 3], [1000, 2]],
  '+Gz': [[0.5, 8.3], [5, 6.4], [1200, 4.0]],
  '-Gz': [[0.5, 6], [5, 3.8], [60, 2.2], [1200, 1.0]],
};
// Средняя переносимость здоровых людей (Chambers 1963, по NASA SP-3006, рис. 4-25; оцифровка ±5 %) — «опасно»:
// дальше человек не выдерживает. По Gy кривой нет — взят аварийный предел NASA-STD-3001 (рис. 6: 5 → 2 g).
const TOLERANCE: Record<GAxis, Curve> = {
  '+Gx': [[1, 31.8], [2, 26.8], [5, 21.3], [10, 17.9], [30, 13.6], [60, 11.5], [120, 9.7], [300, 7.8], [600, 6.6], [1200, 5.6], [1800, 5.1]],
  '-Gx': [[1, 24.1], [2, 20.5], [5, 16.8], [10, 14.3], [30, 11.2], [60, 9.5], [120, 8.1], [300, 6.6], [600, 5.7], [1200, 4.9], [1800, 4.5]],
  Gy: [[0.5, 5], [1000, 2]],
  '+Gz': [[1, 14.9], [2, 13.3], [5, 11.3], [10, 10.0], [30, 8.2], [60, 7.2], [120, 6.4], [300, 5.4], [600, 4.8], [1200, 4.3], [1800, 4.0]],
  '-Gz': [[1, 6.9], [2, 6.2], [5, 5.2], [10, 4.6], [30, 3.8], [60, 3.4], [120, 3.0], [300, 2.6], [600, 2.3], [1200, 2.0], [1800, 1.9]],
};
// Потеря сознания (G-LOC) без защиты, +Gz: в среднем 5,4 ± 0,9 g (Cochran 1954, по NASA SP-3006, табл. 4-4), не раньше
// чем через 5 с (запас кислорода в мозге; Whinnery и Forster 2013: при быстром нарастании — 9,1 ± 2,4 с, не меньше 5 с).
export const GLOC = { g: 5.4, sd: 0.9, window: 5 };
// Модель Брикли (динамический отклик, NASA/TM-2013-217380 REV1, табл. 8) и её пределы (NASA-STD-3001, ред. C):
// δ̈ + 2ζω·δ̇ + ω²·δ = A(t), DR = ω²·δ/g; коэффициенты — по знаку отклика. Риск травмы: низкий до 0,5 %, средний 0,5–5 %,
// высокий 5–50 %. Сочетание осей: β = √Σ(DR/предел)² не больше 1. Оси здесь — корпуса: x — Gx, y — Gz, z — Gy.
export const BRINKLEY = {
  x: { pos: { w: 62.8, z: 0.2, low: 35, med: 40, high: 46 }, neg: { w: 56.0, z: 0.04, low: 28, med: 35, high: 46 } },
  y: { pos: { w: 52.9, z: 0.224, low: 15.2, med: 18.0, high: 22.8 }, neg: { w: 47.1, z: 0.24, low: 13.4, med: 16.5, high: 20.4 } },
  z: { pos: { w: 58.0, z: 0.07, low: 15, med: 20, high: 30 }, neg: { w: 58.0, z: 0.07, low: 15, med: 20, high: 30 } },
} as const;
type DrCoef = { w: number; z: number; low: number; med: number; high: number };

export function curveAt(c: Curve, t: number): number {
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++)
    if (t <= c[i][0]) {
      const k = (Math.log(t) - Math.log(c[i - 1][0])) / (Math.log(c[i][0]) - Math.log(c[i - 1][0]));
      return c[i - 1][1] + k * (c[i][1] - c[i - 1][1]);
    }
  return c[c.length - 1][1];
}
export const designLimit = (a: GAxis, t: number) => curveAt(DESIGN[a], t);
export const toleranceLimit = (a: GAxis, t: number) => curveAt(TOLERANCE[a], t);

export interface CrewLoadResult {
  design: { ratio: number; axis: GAxis; window: number; g: number; limit: number }; // худшее отношение к норме NASA
  tolerance: { ratio: number; axis: GAxis; window: number; g: number; limit: number }; // к переносимости
  gloc5s: number; // наибольшая средняя +Gz за 5 с
  dr: { low: number; med: number; high: number; axis: 'x' | 'y' | 'z'; value: number }; // β по трём уровням, худший отклик
}

const WINDOWS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1200];

/**
 * Перегрузка экипажа по осям: средние за окна от 1 до 1200 с (по средним за 0,1 с) против норм по длительности, средняя
 * +Gz за 5 с против потери сознания, и модель Брикли по трём осям (вход — ускорение кресла, сглаженное до 20 Гц).
 */
export class CrewLoad {
  private acc = [0, 0, 0];
  private accN = 0;
  private tAcc = 0;
  private rings = WINDOWS.map((w) => ({ w, n: Math.round(w / 0.1), buf: [] as number[][], i: 0, sum: [0, 0, 0] }));
  private lp: number[] | null = null;
  private st: Record<'x' | 'y' | 'z', number[]> = { x: [0, 0], y: [0, 0], z: [0, 0] };
  private readonly kLp: number;
  private readonly dt: number;
  private readonly g: number;
  readonly r: CrewLoadResult = {
    design: { ratio: 0, axis: '+Gz', window: 0, g: 0, limit: 0 }, tolerance: { ratio: 0, axis: '+Gz', window: 0, g: 0, limit: 0 },
    gloc5s: 0, dr: { low: 0, med: 0, high: 0, axis: 'y', value: 0 },
  };
  constructor(dt: number, g: number) {
    this.dt = dt;
    this.g = g;
    this.kLp = 1 - Math.exp(-2 * Math.PI * 20 * dt);
  }
  /** f — удельная сила кресла (a − g) в осях корпуса, м/с². */
  push(f: { x: number; y: number; z: number }) {
    const v = [f.x / this.g, f.y / this.g, f.z / this.g];
    // Брикли: сглаживание 20 Гц (одиночные шаги жёсткого контакта — артефакт модели), затем три осциллятора.
    this.lp = this.lp ? this.lp.map((x, i) => x + this.kLp * (v[i] - x)) : v.slice();
    const drs: { ax: 'x' | 'y' | 'z'; dr: number; c: DrCoef }[] = [];
    (['x', 'y', 'z'] as const).forEach((ax, i) => {
      const s = this.st[ax];
      const c: DrCoef = s[0] > 0 || (s[0] === 0 && this.lp![i] >= 0) ? BRINKLEY[ax].pos : BRINKLEY[ax].neg;
      const A = this.lp![i] * this.g;
      s[1] += this.dt * (A - 2 * c.z * c.w * s[1] - c.w * c.w * s[0]); // полунеявный Эйлер
      s[0] += this.dt * s[1];
      drs.push({ ax, dr: (c.w * c.w * s[0]) / this.g, c });
    });
    // В DR по +Gz входит и обычная 1 g — так модель Брикли и задана (покой даёт DR = 1).
    const beta = (k: 'low' | 'med' | 'high') => Math.sqrt(drs.reduce((t, d) => t + (d.dr / d.c[k]) ** 2, 0));
    this.r.dr.low = Math.max(this.r.dr.low, beta('low'));
    this.r.dr.med = Math.max(this.r.dr.med, beta('med'));
    this.r.dr.high = Math.max(this.r.dr.high, beta('high'));
    const worst = drs.reduce((m, d) => (Math.abs(d.dr) / d.c.low > Math.abs(m.dr) / m.c.low ? d : m));
    const prev = drs.find((d) => d.ax === this.r.dr.axis)!;
    if (Math.abs(worst.dr) / worst.c.low > Math.abs(this.r.dr.value) / prev.c.low) this.r.dr = { ...this.r.dr, axis: worst.ax, value: worst.dr };
    // Средние за 0,1 с → окна.
    for (let k = 0; k < 3; k++) this.acc[k] += v[k];
    this.accN++;
    this.tAcc += this.dt;
    if (this.tAcc < 0.1 - 1e-9) return;
    const m = this.acc.map((x) => x / this.accN);
    this.acc = [0, 0, 0];
    this.accN = 0;
    this.tAcc = 0;
    for (const R of this.rings) {
      if (R.buf.length < R.n) R.buf.push(m);
      else {
        const old = R.buf[R.i];
        for (let k = 0; k < 3; k++) R.sum[k] -= old[k];
        R.buf[R.i] = m;
        R.i = (R.i + 1) % R.n;
      }
      for (let k = 0; k < 3; k++) R.sum[k] += m[k];
      if (R.buf.length < R.n) continue;
      const gx = R.sum[0] / R.n, gz = R.sum[1] / R.n, gy = R.sum[2] / R.n;
      const cand: [GAxis, number][] = [[gx >= 0 ? '+Gx' : '-Gx', Math.abs(gx)], ['Gy', Math.abs(gy)], [gz >= 0 ? '+Gz' : '-Gz', Math.abs(gz)]];
      for (const [axis, g] of cand) {
        const dl = designLimit(axis, R.w), tl = toleranceLimit(axis, R.w);
        if (g / dl > this.r.design.ratio) this.r.design = { ratio: g / dl, axis, window: R.w, g, limit: dl };
        if (g / tl > this.r.tolerance.ratio) this.r.tolerance = { ratio: g / tl, axis, window: R.w, g, limit: tl };
      }
      if (R.w === GLOC.window) this.r.gloc5s = Math.max(this.r.gloc5s, gz);
    }
  }
}
