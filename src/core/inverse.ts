// Обратная задача (ТЗ, раздел 7.6): какой материал и какая мощность нужны, чтобы аппарат
// прошёл испытание.
//
// Если плотность материала не меняется, нагрузки от него не зависят: масса и движение те же.
// Тогда запас прочности по каждому виду разрушения пропорционален характеристике материала
// (прочности — для разрыва, сжатия и среза, модулю упругости — для потери устойчивости).
// Значит, материал «в k раз прочнее и жёстче» даёт запас ровно в k раз больше, и нужное
// k = 1,5 / запас. Решение проверяется вторым прогоном с таким материалом.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { td, tr } from './i18n.ts';
import { powerNeedRecovered } from './report.ts';
import { ProgramRun, type ProgramId, type ProgramOptions, type ProgramResult } from './programs.ts';
import { analyze, crewLevel, n, raz, watts, type Verdict } from './analyze.ts';
import { MATERIALS, type Material } from './materials.ts';
import { modeName, plateStiffness, type FailureMode } from './strength.ts';
import type { Spec } from './spec.ts';

export const REQUIRED_MARGIN = 1.5;

export interface InverseResult {
  ms: number;
  base: { verdict: Verdict; margin: number; mode: FailureMode; part: string; material: Material | null };
  strengthFactor: number; // во сколько раз прочнее и жёстче нужен материал (1 — хватает)
  powerNeeded: number;
  powerNeededRecovered: number; // при полном возврате энергии разгона крыльев
  powerAvailable: number;
  powerFactor: number; // во сколько раз больше нужна мощность (≤ 1 — хватает)
  blockers: string[]; // что не исправить ни материалом, ни мощностью
  verified: { margin: number; verdict: Verdict } | null;
  candidates: { id: string; name: string; margin: number; kind: string }[]; // библиотечные материалы, приближённо
}

function capability(m: Material, mode: FailureMode): number {
  if (mode === 'buckling') return plateStiffness(m);
  if (mode === 'compression') return m.ultCompression;
  if (mode === 'shear') return m.shear;
  return m.ultTension;
}

function powerNeed(r: ProgramResult): number {
  return r.tunnel?.power ?? r.hover?.power ?? r.powerMean;
}

export function solveInverse(RAPIER: typeof RAPIER_NS, spec: Spec, program: ProgramId, opts: ProgramOptions = {}): InverseResult {
  const t0 = Date.now();
  const run = (o: ProgramOptions) => {
    const pr = new ProgramRun(RAPIER, spec, program, { ...opts, ...o });
    const matPart = pr.sim.parts.find((p) => p.material);
    const r = pr.runToEnd();
    pr.free();
    return { r, material: matPart?.material ?? null };
  };

  // 1. Без разрушения: какие нагрузки на самом деле возникают.
  const { r: r0, material } = run({ breakable: false });
  const v0 = analyze(r0);
  const margin = r0.minMargin;
  const strengthFactor = Number.isFinite(margin) && margin > 0 ? Math.max(1, REQUIRED_MARGIN / margin) : margin === 0 ? Infinity : 1;
  const need = powerNeed(r0);
  const blockers: string[] = [];
  if (r0.maxMach > 1)
    blockers.push(tr(`Сечения движутся быстрее звука (M = ${n(r0.maxMach, 2)}): сверхзвуковые законцовки не исправить материалом — нужны меньшие частота, размах или обороты.`, `Sections move faster than sound (M = ${n(r0.maxMach, 2)}): supersonic tips cannot be fixed by material — lower frequency, span or speed is needed.`));
  if (crewLevel(r0) === 'lethal')
    blockers.push(tr(`Экипаж: перегрузка +Gz ${n(r0.crewLoad?.gloc5s ?? r0.crewSustainedG, 2)} g за 5 с — человек теряет сознание при любом материале.`, `Crew: +Gz load ${n(r0.crewLoad?.gloc5s ?? r0.crewSustainedG, 2)} g over 5 s — a person blacks out whatever the material.`));
  if (r0.hover && !r0.hover.achieved && r0.hover.saturated)
    blockers.push(tr(`На максимуме управления подъёмная сила — ${n(r0.hover.liftToWeightAtMax * 100, 2)} % веса: материал и мощность этого не исправят, нужна другая геометрия.`, `At full control the lift is ${n(r0.hover.liftToWeightAtMax * 100, 2)} % of weight: neither material nor power will fix this, a different geometry is needed.`));
  if (r0.tunnel && !r0.tunnel.trimmed)
    blockers.push(tr(`В потоке ${n(r0.tunnel.speed)} м/с подъёмная сила не дотягивает до веса — нужна большая площадь крыла или скорость.`, `In a ${n(r0.tunnel.speed)} m/s flow the lift falls short of the weight — more wing area or speed is needed.`));
  if (r0.tunnel?.trimmed && r0.tunnel.netThrustMax < 0)
    blockers.push(tr(`Тяга меньше сопротивления на ${n(-r0.tunnel.netThrustMaxToWeight * 100, 2)} % веса при любом закручивании — нужны другие размах или частота взмаха, а не материал.`, `Thrust is ${n(-r0.tunnel.netThrustMaxToWeight * 100, 2)} % of weight short of drag at any twist — a different flapping amplitude or frequency is needed, not a material.`));
  if (r0.flight && !r0.flight.levelReached) blockers.push(tr('Самолёт не набирает высоту — нужна большая тяга или меньшая масса.', 'The aeroplane does not climb — more thrust or less mass is needed.'));
  if (r0.resonance && r0.resonance.ratio >= 1)
    blockers.push(tr(`Привод в ${raz(r0.resonance.ratio, 2)} быстрее собственной частоты крыла: даже прочное крыло будет сильно гнуться; жёсткость нужна примерно в ${raz(r0.resonance.ratio ** 2, 2)} выше.`, `The drive is ${raz(r0.resonance.ratio, 2)} faster than the wing's natural frequency: even a strong wing will bend heavily; stiffness must be about ${raz(r0.resonance.ratio ** 2, 2)} higher.`));

  // 2. Проверка: тот же расчёт с материалом в strengthFactor раз прочнее и жёстче.
  // Жёсткое крыло ближе к резонансу, поэтому проверка уточняет множитель (до двух раз).
  let verified: InverseResult['verified'] = null;
  let k = strengthFactor;
  if (material && Number.isFinite(strengthFactor) && strengthFactor > 1) {
    for (let i = 0; i < 2; i++) {
      const custom: Material = {
        ...material, id: 'custom', name: `${material.name} ×${k.toFixed(1)}`, group: 'custom', kind: 'theory',
        E: material.E * k, E2: material.E2 ? material.E2 * k : undefined, G12: material.G12 ? material.G12 * k : undefined,
        ultTension: material.ultTension * k, ultCompression: material.ultCompression * k, shear: material.shear * k,
        yield: material.yield ? material.yield * k : undefined, sources: [],
      };
      const { r } = run({ breakable: false, materialCustom: custom });
      verified = { margin: r.minMargin, verdict: analyze(r) };
      if (r.minMargin >= REQUIRED_MARGIN * 0.97 || !Number.isFinite(r.minMargin)) break;
      k *= (REQUIRED_MARGIN * 1.02) / Math.max(1e-9, r.minMargin);
    }
  }

  // 3. Какие материалы из библиотеки подошли бы — приближённо, без учёта изменения массы.
  const mode = r0.minMarginMode;
  const candidates = material && Number.isFinite(margin) && margin < REQUIRED_MARGIN
    ? Object.values(MATERIALS)
        .map((m) => ({ id: m.id, name: m.name, kind: m.group, margin: (margin * capability(m, mode)) / Math.max(1e-9, capability(material, mode)) }))
        .filter((c) => c.margin >= REQUIRED_MARGIN)
        .sort((a, b) => b.margin - a.margin)
    : [];

  return {
    ms: Date.now() - t0,
    base: { verdict: v0, margin, mode, part: r0.minMarginPart, material },
    strengthFactor: k,
    powerNeeded: need,
    powerNeededRecovered: powerNeedRecovered(r0),
    powerAvailable: r0.powerAvailable,
    powerFactor: need / Math.max(1e-9, r0.powerAvailable),
    blockers,
    verified,
    candidates,
  };
}

export function describeInverse(x: InverseResult): string[] {
  const out: string[] = [];
  const mat = td(x.base.material?.name ?? tr('материал', 'the material'));
  if (x.strengthFactor > 1)
    out.push(tr(`Прочность: нужен материал в ${raz(x.strengthFactor)} прочнее и жёстче, чем ${mat}, при той же плотности (сейчас запас ${n(x.base.margin)}, ${modeName(x.base.mode)}).`,
      `Strength: a material ${raz(x.strengthFactor)} stronger and stiffer than ${mat} at the same density is needed (margin now ${n(x.base.margin)}, ${modeName(x.base.mode)}).`));
  else if (Number.isFinite(x.base.margin)) out.push(tr(`Прочность: ${mat} достаточно — запас ${n(x.base.margin)}.`, `Strength: ${mat} is enough — margin ${n(x.base.margin)}.`));
  if (x.verified) out.push(tr(`Проверка с таким материалом: запас ${n(x.verified.margin)}, вердикт без учёта прочности — «${x.verified.verdict.title}».`, `Check with that material: margin ${n(x.verified.margin)}, verdict apart from strength — “${x.verified.verdict.title}”.`));
  const rec = x.powerNeededRecovered < x.powerNeeded * 0.97
    ? tr(` (если энергию торможения крыльев возвращать полностью — ${watts(x.powerNeededRecovered)})`, ` (${watts(x.powerNeededRecovered)} if the wing braking energy were fully recovered)`) : '';
  if (x.powerFactor > 1) out.push(tr(`Мощность: нужно ${watts(x.powerNeeded)}${rec} — в ${raz(x.powerFactor)} больше, чем есть (${watts(x.powerAvailable)}).`, `Power: ${watts(x.powerNeeded)} needed${rec} — ${raz(x.powerFactor)} more than available (${watts(x.powerAvailable)}).`));
  else out.push(tr(`Мощность: хватает — нужно ${watts(x.powerNeeded)}${rec} из ${watts(x.powerAvailable)}.`, `Power: enough — ${watts(x.powerNeeded)} needed${rec} of ${watts(x.powerAvailable)}.`));
  if (x.candidates.length)
    out.push(tr(`Из библиотеки подошли бы (приближённо: при тех же нагрузках, без учёта другой массы): `, `From the library these would do (roughly: same loads, ignoring the different mass): `) +
      `${x.candidates.slice(0, 4).map((c) => tr(`${td(c.name)} — запас ≈${n(c.margin, 2)}`, `${td(c.name)} — margin ≈${n(c.margin, 2)}`)).join('; ')}.`);
  else if (x.strengthFactor > 1) out.push(tr('Ни один материал из библиотеки, включая теоретические, не даёт запаса 1,5.', 'No material in the library, theoretical ones included, gives a margin of 1.5.'));
  for (const b of x.blockers) out.push(tr(`Не исправить материалом: ${b}`, `Cannot be fixed by material: ${b}`));
  return out;
}

