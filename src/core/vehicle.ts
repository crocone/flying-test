// Испытание как переносимое состояние: аппарат (пресет или проект от ИИ) + правки допущений +
// программа и условия. Из него собирается спецификация — в странице, в фоновом расчёте и по ссылке.
import { PRESETS } from '../presets/index.ts';
import { applyAssumptions, validateSpec, type Assumption, type Spec } from './spec.ts';
import { MATERIALS } from './materials.ts';
import { buildSpec, checkDesign, setDesignField, type Design } from './design.ts';
import { PROGRAMS, type ProgramId, type ProgramOptions } from './programs.ts';

export type VehicleSource = { preset: string } | { design: Design; info?: string };

export interface TestState {
  vehicle: VehicleSource;
  overrides: Record<string, number>;
  program: ProgramId;
  material?: string; // переопределение материала силового набора
  altitude?: number;
  isaDeviation?: number; // °C: температура воздуха выше (+) или ниже (−) стандартной
  cruise?: number; // м/с; 0 или нет — без крейсера
  wind?: number; // м/с, поток в трубе
  breakable?: boolean;
}

/** Исходная спецификация без правок — её допущения и есть «оценка ИИ или источника». */
export function baseSpec(v: VehicleSource): Spec {
  return 'preset' in v ? PRESETS[v.preset] : buildSpec(v.design);
}

export function baseAssumptions(v: VehicleSource): Assumption[] {
  return baseSpec(v).assumptions;
}

export function buildVehicle(state: Pick<TestState, 'vehicle' | 'overrides'>): { spec: Spec; errors: string[] } {
  const v = state.vehicle;
  if ('preset' in v) {
    if (!PRESETS[v.preset]) return { spec: null as unknown as Spec, errors: [`нет аппарата «${v.preset}»`] };
    const spec = applyAssumptions(PRESETS[v.preset], state.overrides);
    const val = validateSpec(spec, Object.keys(MATERIALS));
    return { spec, errors: val.ok ? [] : val.errors };
  }
  let d = v.design;
  for (const [p, x] of Object.entries(state.overrides)) d = setDesignField(d, p.replace(/^design\./, ''), x);
  const c = checkDesign(d);
  return { spec: c.spec ?? buildSpec(d), errors: c.spec ? [] : c.errors };
}

export function programOptions(state: TestState): ProgramOptions {
  const o: ProgramOptions = { breakable: state.breakable ?? true, altitude: state.altitude ?? 0, isaDeviation: state.isaDeviation ?? 0 };
  if (state.material) o.materialOverride = state.material;
  if (state.cruise && state.cruise > 0) o.cruiseSpeed = state.cruise;
  if (state.wind && state.wind > 0) o.windSpeed = state.wind;
  return o;
}

// ---------- ссылка ----------
// Состояние целиком лежит в адресе (после #), поэтому ссылка воспроизводит испытание без сервера.

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Состояние в том виде, в каком оно уходит в ссылку и на сервер. */
export const wireState = (state: TestState) => ({ v: 1 as const, ...state });

export function encodeState(state: TestState): string {
  return toBase64Url(JSON.stringify(wireState(state)));
}

/** Разобрать состояние из ссылки. Всё, что пришло по ссылке, проверяется так же, как ответ ИИ. */
export function decodeState(s: string): { state: TestState | null; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(s));
  } catch {
    return { state: null, error: 'ссылка повреждена' };
  }
  return parseState(raw);
}

/** Проверить состояние испытания, пришедшее извне (ссылка, сохранённый отчёт). */
export function parseState(raw: unknown): { state: TestState | null; error?: string } {
  const o = raw as Partial<TestState> & { v?: number };
  if (!o || typeof o !== 'object' || o.v !== 1) return { state: null, error: 'неизвестный формат ссылки' };
  if (!o.program || !(o.program in PROGRAMS)) return { state: null, error: 'в ссылке нет программы испытания' };
  const veh = o.vehicle as VehicleSource | undefined;
  if (!veh || typeof veh !== 'object') return { state: null, error: 'в ссылке нет аппарата' };
  if ('preset' in veh && !PRESETS[veh.preset]) return { state: null, error: `нет аппарата «${String(veh.preset)}»` };
  if ('design' in veh) {
    const c = checkDesign(veh.design);
    if (!c.spec) return { state: null, error: `проект из ссылки не прошёл проверку: ${c.errors.slice(0, 3).join('; ')}` };
  }
  const overrides: Record<string, number> = {};
  for (const [k, x] of Object.entries(o.overrides ?? {})) if (typeof x === 'number' && Number.isFinite(x)) overrides[k] = x;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return {
    state: {
      vehicle: veh,
      overrides,
      program: o.program,
      material: typeof o.material === 'string' && MATERIALS[o.material] ? o.material : undefined,
      altitude: num(o.altitude),
      isaDeviation: num(o.isaDeviation),
      cruise: num(o.cruise),
      wind: num(o.wind),
      breakable: typeof o.breakable === 'boolean' ? o.breakable : true,
    },
  };
}
