// Вердикт по телеметрии (ТЗ, раздел 9): правила проверяются сверху вниз,
// берётся первое подходящее. ИИ в этом не участвует. Тексты — на языке интерфейса (i18n.ts).
import type { ProgramResult } from './programs.ts';
import { modeName } from './strength.ts';
import { CREW_LIMITS, GLOC, toleranceLimit } from './crew.ts';
import { locale, td, tr, U } from './i18n.ts';
import { quasiSteadyThrustOverestimate } from './aero.ts';

/** Нехватка тяги меньше этой доли сопротивления — в пределах точности модели (ТЗ, раздел 12: допуск 20 % для эталонов). */
export const THRUST_TOLERANCE = 0.2;
// Свободный полёт: потеря энергии меньше этой доли сопротивления — в пределах того, что автопилот
// не успевает выбрать за время полёта; вердикт она не меняет.
export const FREE_TOLERANCE = 0.05;
// Усиление нагрузок у резонанса, начиная с которого вердикт о нём предупреждает.
export const RESONANCE_DAF = 1.5;

export type VerdictKind = 'breaks' | 'crew' | 'no-lift' | 'marginal' | 'flies' | 'n/a';

export function verdictName(k: VerdictKind): string {
  return {
    breaks: tr('Разрушается', 'Breaks up'),
    crew: tr('Экипаж не выживает', 'Crew does not survive'),
    'no-lift': tr('Не взлетает', 'Does not fly'),
    marginal: tr('Летает на пределе', 'Flies at the limit'),
    flies: tr('Летает', 'Flies'),
    'n/a': tr('Не применимо', 'Not applicable'),
  }[k];
}

export interface Verdict {
  kind: VerdictKind;
  title: string;
  reasons: string[]; // до трёх, по убыванию важности, с числами
  warnings: string[]; // выход за пределы модели и пробелы в данных
  crewLevel: 'comfortable' | 'hard' | 'injurious' | 'lethal';
}

export const n = (x: number | undefined, d = 3): string => {
  if (x === undefined || !Number.isFinite(x)) return '—';
  const y = Number(x.toPrecision(d));
  return (Math.abs(y) < 0.0005 ? 0 : y).toLocaleString(locale()); // без «−0»
};

/** «3 раза», «300 раз», «1,5 раза»; по-английски — «3 times». */
export function raz(x: number, d = 3): string {
  const s = n(x, d);
  if (locale() === 'en-US') return `${s} times`;
  if (s.includes(',')) return `${s} раза`;
  const k = Math.round(Math.abs(x < 1 ? 0 : Number(x.toPrecision(d))));
  return `${s} ${k % 100 >= 11 && k % 100 <= 14 ? 'раз' : k % 10 >= 2 && k % 10 <= 4 ? 'раза' : 'раз'}`;
}

export function crewLevel(r: ProgramResult): Verdict['crewLevel'] {
  const L = CREW_LIMITS;
  if (r.unmanned) return 'comfortable'; // людей на борту нет — перегрузки на вердикт не влияют
  const cl = r.crewLoad;
  if (cl) {
    // По осям и длительности: потеря сознания (+Gz), переносимость здоровых людей, норма NASA, модель Брикли.
    if (cl.gloc5s >= GLOC.g) return 'lethal';
    if (cl.tolerance.ratio >= 1 || cl.dr.med >= 1 || r.vibrationRms >= L.vibration.injurious) return 'injurious';
    if (cl.design.ratio >= 1 || cl.dr.low >= 1 || r.vibrationRms >= L.vibration.hard) return 'hard';
    return 'comfortable';
  }
  if (r.crewSustainedG >= L.sustained.lethal || r.crewPeakG >= L.impact.lethal) return 'lethal';
  if (r.crewSustainedG >= L.sustained.injurious || r.crewPeakG >= L.impact.injurious || r.vibrationRms >= L.vibration.injurious) return 'injurious';
  if (r.crewSustainedG >= L.sustained.hard || r.crewPeakG >= L.impact.hard || r.vibrationRms >= L.vibration.hard) return 'hard';
  return 'comfortable';
}

/** names — человеческие названия деталей по id (для отчёта); без них в тексте id. */
export function analyze(r: ProgramResult, names: Record<string, string> = {}): Verdict {
  const nm = (id: string) => td(names[id] ?? id);
  const q = (id: string) => tr(`«${nm(id)}»`, `“${nm(id)}”`);
  const pct = (x: number) => Math.round(x * 100);
  const warnings: string[] = [];
  if (r.maxMach > 0.7)
    warnings.push(tr(
      `Скорость сечений до M = ${n(r.maxMach, 2)}: выше 0,7 модель сжимаемости не работает, реальные нагрузки и сопротивление ещё больше.`,
      `Sections reach M = ${n(r.maxMach, 2)}: above 0.7 the compressibility model no longer holds; real loads and drag are even higher.`));
  const rz = r.resonance;
  if (rz && rz.ratio >= 1)
    warnings.push(tr(
      `Привод (${n(rz.fe)} Гц) быстрее собственной частоты изгиба ${q(rz.part)} (${n(rz.f1)} Гц): крыло не успевает за приводом и сильно гнётся — модель жёсткого крыла здесь неприменима.`,
      `The drive (${n(rz.fe)} Hz) is faster than the bending natural frequency of ${q(rz.part)} (${n(rz.f1)} Hz): the wing cannot follow the drive and bends heavily — the rigid-wing model does not apply here.`));
  // Предупреждаем, только если раскачка заметно усиливает нагрузки: у лопастей винтов частота близка к оборотам
  // всегда, но взмах сильно гасится воздухом (демпфирование 0,2–0,5), и усиление невелико.
  else if (rz && rz.ratio > 0.6 && rz.daf >= RESONANCE_DAF)
    warnings.push(tr(
      `Близко к резонансу: собственная частота ${q(rz.part)} ${n(rz.f1)} Гц, привод ${n(rz.fe)} Гц, демпфирование ${n(rz.zeta ?? 0.03, 2)} — раскачка с этой частотой усиливает нагрузки до ${raz(rz.daf, 2)}.`,
      `Close to resonance: the natural frequency of ${q(rz.part)} is ${n(rz.f1)} Hz, the drive ${n(rz.fe)} Hz, damping ${n(rz.zeta ?? 0.03, 2)} — oscillation at this frequency amplifies loads up to ${raz(rz.daf, 2)}.`));
  if (r.tunnel && r.tunnel.reducedFrequency >= 0.1 && r.tunnel.unsteady) {
    warnings.push(tr(
      `Приведённая частота взмаха k = ${n(r.tunnel.reducedFrequency, 2)}: обтекание нестационарное. Оно учтено упрощённо — запаздывание подъёмной силы (функция Вагнера) и запаздывание срыва с постоянными для профиля NACA 0012. Вихрь динамического срыва и потери подсасывающей силы у тонких профилей не учтены, поэтому запас тяги — оценка.`,
      `Reduced flapping frequency k = ${n(r.tunnel.reducedFrequency, 2)}: the flow is unsteady. It is modelled in a simplified way — lift lag (Wagner function) and stall delay with constants for the NACA 0012 airfoil. The dynamic-stall vortex and the loss of leading-edge suction on thin airfoils are not modelled, so the thrust margin is an estimate.`));
  } else if (r.tunnel && r.tunnel.reducedFrequency >= 0.1) {
    const k = r.tunnel.reducedFrequency;
    warnings.push(tr(
      `Приведённая частота взмаха k = ${n(k, 2)}: воздух не успевает за крылом. Модель считает обтекание установившимся в каждый момент и поэтому завышает тягу взмаха — по теории Теодорсена — Гаррика для профиля примерно в ${raz(quasiSteadyThrustOverestimate(k), 2)}. Настоящий запас тяги меньше.`,
      `Reduced flapping frequency k = ${n(k, 2)}: the air cannot keep up with the wing. The model treats the flow as steady at every instant and so overestimates flapping thrust — by about ${raz(quasiSteadyThrustOverestimate(k), 2)} according to Theodorsen–Garrick theory for an airfoil. The real thrust margin is smaller.`));
  }
  const ph = r.free?.pitchHold;
  if (ph)
    warnings.push(tr(
      `Наклон и курс корпуса в свободном полёте удерживались идеально — оперение не моделируется. Это стоило момента по тангажу: в среднем ${n(ph.mean, 2)} Н·м (коэффициент момента ${n(ph.cm, 2)}) — его должно давать оперение, — и переменного ±${n(ph.amp, 2)} Н·м с частотой взмахов: без удержания корпус качался бы примерно на ±${n(ph.swingDeg, 2)}°, и угол атаки крыльев менялся бы вместе с ним.`,
      `Body pitch and heading were held perfectly in free flight — the tail is not modelled. This took a pitching moment of ${n(ph.mean, 2)} N·m on average (moment coefficient ${n(ph.cm, 2)}) — the tail must supply it — and ±${n(ph.amp, 2)} N·m at the flapping frequency: unrestrained, the body would rock by about ±${n(ph.swingDeg, 2)}°, and the wing angle of attack with it.`));
  if (r.fatigue.noData.length) warnings.push(tr(`Нет данных об усталости материала: ${r.fatigue.noData.map(td).join(', ')}.`, `No fatigue data for the material: ${r.fatigue.noData.map(td).join(', ')}.`));
  const level = crewLevel(r);
  // Об этом надо сказать при любом вердикте, а не только когда аппарат летает.
  if (r.applicable && !r.strengthChecked) warnings.push(tr('Прочность не проверялась: у деталей не задан силовой набор (structure).', 'Strength was not checked: the parts have no load-bearing structure defined.'));
  if (!r.applicable) return { kind: 'n/a', title: verdictName('n/a'), reasons: [r.notApplicable ?? ''], warnings, crewLevel: level };

  const reasons: string[] = [];
  const margin = tr(
    `запас прочности ${n(r.minMargin)} в ${q(r.minMarginPart)} на ${pct(r.minMarginSpan)} % размаха — ${modeName(r.minMarginMode)}`,
    `safety margin ${n(r.minMargin)} in ${q(r.minMarginPart)} at ${pct(r.minMarginSpan)} % span — ${modeName(r.minMarginMode)}`);

  if (r.breaks.length) {
    const b = r.breaks[0];
    reasons.push(tr(
      `${q(b.part)} разрушается на ${n(b.t)} с: ${modeName(b.mode)} на ${pct(b.spanFrac)} % размаха.`,
      `${q(b.part)} fails at ${n(b.t)} s: ${modeName(b.mode)} at ${pct(b.spanFrac)} % span.`));
    if (r.breaks.length > 1) reasons.push(tr(`Всего разрушено деталей: ${r.breaks.length}.`, `Parts broken in total: ${r.breaks.length}.`));
    if (level === 'lethal' || level === 'injurious') reasons.push(crewText(r));
    return { kind: 'breaks', title: verdictName('breaks'), reasons: reasons.slice(0, 3), warnings, crewLevel: level };
  }
  if (Number.isFinite(r.minMargin) && r.minMargin < 1 && !r.strengthInfoOnly) {
    reasons.push(tr(`Перегрузка конструкции: ${margin} (разрушение отключено).`, `Structure overloaded: ${margin} (breaking disabled).`));
    return { kind: 'breaks', title: verdictName('breaks'), reasons, warnings, crewLevel: level };
  }
  const fl = r.flutter;
  if (fl) {
    const vLim = Math.min(fl.vFlutter, fl.vDivergence);
    const what = fl.vFlutter <= fl.vDivergence
      ? tr(`флаттер (изгиб с кручением, ${n(fl.fFlutter)} Гц)`, `flutter (bending–torsion, ${n(fl.fFlutter)} Hz)`)
      : tr('дивергенция (крыло закручивается потоком)', 'divergence (the flow twists the wing)');
    if (r.airspeedMax >= vLim) {
      reasons.push(tr(`${q(fl.part)}: ${what} начинается на ${n(vLim)} м/с, а скорость в испытании дошла до ${n(r.airspeedMax)} м/с.`,
        `${q(fl.part)}: ${what} starts at ${n(vLim)} m/s, and the test speed reached ${n(r.airspeedMax)} m/s.`));
      return { kind: 'breaks', title: verdictName('breaks'), reasons, warnings, crewLevel: level };
    }
    // Нормы (CS-23.629, FAR 23.629): без флаттера до 1,2 расчётной скорости пикирования.
    if (r.airspeedMax * 1.2 > vLim)
      warnings.push(tr(`Запас по флаттеру меньше 20 %: ${what} ${q(fl.part)} — на ${n(vLim)} м/с, наибольшая скорость испытания ${n(r.airspeedMax)} м/с (нормы требуют 1,2 расчётной скорости пикирования).`,
        `Flutter margin below 20 %: ${what} of ${q(fl.part)} at ${n(vLim)} m/s, test top speed ${n(r.airspeedMax)} m/s (regulations require 1.2 × design dive speed).`));
  }
  if (level === 'lethal') {
    reasons.push(crewText(r));
    return { kind: 'crew', title: verdictName('crew'), reasons, warnings, crewLevel: level };
  }

  const noLift: string[] = [];
  if (r.hover && !r.hover.achieved) {
    if (r.hover.saturated) noLift.push(tr(`На максимуме управления подъёмная сила — ${n(r.hover.liftToWeightAtMax * 100, 2)} % веса.`, `At full control the lift is ${n(r.hover.liftToWeightAtMax * 100, 2)} % of weight.`));
    else noLift.push(tr('Висение не удержано.', 'Hover was not held.'));
  }
  if (r.program === 'tethered' && Number.isFinite(r.liftToWeightMax) && r.liftToWeightMax < 1 && !r.flight)
    noLift.push(tr(`На стенде вертикальная сила — ${n(r.liftToWeightMax * 100, 2)} % веса.`, `On the test rig the vertical force is ${n(r.liftToWeightMax * 100, 2)} % of weight.`));
  if (r.flight && !r.flight.levelReached) {
    if (!r.flight.airborne) noLift.push(r.notes[0] ?? tr('Отрыва от земли не было.', 'It never left the ground.'));
    else noLift.push(tr(
      `Отрыв на ${n(r.flight.vRotate)} м/с после разбега ${n(r.flight.takeoffDistance)} м, но высоту не набирает: ${r.notes[0] ?? 'не хватает тяги'}.`,
      `Lift-off at ${n(r.flight.vRotate)} m/s after a ${n(r.flight.takeoffDistance)} m run, but it does not climb: ${r.notes[0] ?? 'not enough thrust'}.`));
  }
  const marginal: string[] = [];
  if (r.tunnel) {
    const t = r.tunnel;
    if (!t.trimmed) noLift.push(tr(`В потоке ${n(t.speed)} м/с подъёмная сила не дотягивает до веса: ${n(t.liftToWeight * 100, 2)} %.`, `In a ${n(t.speed)} m/s flow the lift falls short of the weight: ${n(t.liftToWeight * 100, 2)} %.`));
    else if (r.free) {
      // Свободный полёт: держит ли аппарат высоту и скорость сам. Мерило — полная энергия (высота + V²/2g):
      // её потеря на пройденном пути равна нехватке тяги.
      const f = r.free;
      const rel = t.dragEstimate > 0 ? -f.netForce / t.dragEstimate : 0;
      const facts = freeFacts(f);
      const lack = tr(`${n(-f.netForce)} Н — это ${n(rel * 100, 2)} % сопротивления`, `${n(-f.netForce)} N — ${n(rel * 100, 2)} % of drag`);
      if (f.grounded)
        noLift.push(tr(`В свободном полёте не держится: ${facts}. Полёт прерван: аппарат снизился почти до земли или потерял скорость.`,
          `It does not stay in free flight: ${facts}. The flight was cut short: the vehicle sank almost to the ground or lost its speed.`));
      else if (rel > THRUST_TOLERANCE)
        noLift.push(tr(`В свободном полёте теряет энергию: ${facts}. Это равносильно нехватке тяги ${lack}. Горизонтально не полетит.`,
          `In free flight it loses energy: ${facts}. This equals a thrust shortfall of ${lack}. It will not fly level.`));
      else if (rel > FREE_TOLERANCE)
        marginal.push(tr(`В свободном полёте понемногу теряет энергию: ${facts}. Это равносильно нехватке тяги ${lack} — меньше точности модели (${n(THRUST_TOLERANCE * 100)} % сопротивления), поэтому вывод — «на пределе».`,
          `In free flight it slowly loses energy: ${facts}. This equals a thrust shortfall of ${lack} — less than the model's accuracy (${n(THRUST_TOLERANCE * 100)} % of drag), so the conclusion is “at the limit”.`));
    } else if (t.netThrustMax < 0) {
      // Нехватка тяги в долях сопротивления. Меньше точности модели — «на пределе», а не «не взлетает».
      const rel = t.dragEstimate > 0 ? -t.netThrustMax / t.dragEstimate : Infinity;
      const nums = tr(`${n(-t.netThrustMax)} Н — это ${n(rel * 100, 2)} % сопротивления и ${n(-t.netThrustMaxToWeight * 100, 2)} % веса`, `${n(-t.netThrustMax)} N — ${n(rel * 100, 2)} % of drag and ${n(-t.netThrustMaxToWeight * 100, 2)} % of weight`);
      if (rel > THRUST_TOLERANCE)
        noLift.push(tr(`Подъёмную силу крылья дают, но тяги не хватает: при любом закручивании крыла она меньше сопротивления хотя бы на ${nums}. Горизонтально не полетит.`,
          `The wings give enough lift, but not enough thrust: at any wing twist it is short of drag by at least ${nums}. It will not fly level.`));
      else
        marginal.push(tr(`Тяга почти равна сопротивлению: не хватает ${nums}. Это меньше точности модели (${n(THRUST_TOLERANCE * 100)} % сопротивления), поэтому вывод — «на пределе»: в горизонтальном полёте аппарат понемногу теряет скорость или высоту.`,
          `Thrust nearly equals drag: it is short by ${nums}. This is less than the model's accuracy (${n(THRUST_TOLERANCE * 100)} % of drag), so the conclusion is “at the limit”: in level flight the vehicle slowly loses speed or height.`));
    }
  }
  // Нужная мощность. У машущего привода она зависит от того, возвращается ли энергия торможения
  // крыла (упругое крыло, пружина): без возврата — needPower, с полным возвратом — recPower.
  const needPower = r.free?.power ?? r.tunnel?.power ?? r.hover?.power ?? r.powerMean;
  const recPower = r.powerRecoverable ? Math.min(needPower, r.free ? r.free.powerRecovered : r.tunnel ? r.tunnel.powerRecovered ?? needPower : r.powerRecoveredMean) : needPower;
  const avail = r.powerAvailable;
  if (recPower > avail * 1.0001) {
    if (recPower < needPower * 0.97)
      noLift.push(tr(
        `Нужно ${watts(needPower)}, а если энергия торможения крыльев возвращается полностью — ${watts(recPower)}. Силовая установка даёт ${watts(avail)}: в ${raz(recPower / avail, 2)} меньше даже с возвратом.`,
        `It needs ${watts(needPower)}, or ${watts(recPower)} if the wing braking energy is fully recovered. The powerplant gives ${watts(avail)}: ${raz(recPower / avail, 2)} less even with recovery.`));
    else
      noLift.push(tr(
        `Нужно ${watts(needPower)}, а силовая установка даёт ${watts(avail)} — в ${raz(needPower / avail, 2)} меньше.`,
        `It needs ${watts(needPower)}, but the powerplant gives ${watts(avail)} — ${raz(needPower / avail, 2)} less.`));
  } else if (needPower > avail * 1.0001)
    marginal.push(tr(
      `Мощности хватает, только если энергия торможения крыльев возвращается (упругое крыло, пружина): без возврата нужно ${watts(needPower)}, с полным возвратом — ${watts(recPower)}, а силовая установка даёт ${watts(avail)}.`,
      `There is enough power only if the wing braking energy is recovered (elastic wing, spring): ${watts(needPower)} is needed without recovery, ${watts(recPower)} with full recovery, and the powerplant gives ${watts(avail)}.`));
  // Махолёт для полёта вперёд на месте не висит — как и настоящий. Это не «не взлетает»:
  // так и пишем и отправляем в трубу, где проверяется горизонтальный полёт.
  const cantHover = (r.hover && !r.hover.achieved) || (r.program === 'tethered' && Number.isFinite(r.liftToWeightMax) && r.liftToWeightMax < 1 && !r.flight);
  if (noLift.length && cantHover && r.forwardSpeed) {
    const hint = tr(
      `Это не значит, что аппарат не летает: он рассчитан на полёт вперёд со скоростью ${n(r.forwardSpeed)} м/с, а не на висение. Полетит ли он вперёд, показывает программа «Свободный полёт махолёта».`,
      `This does not mean the vehicle cannot fly: it is designed for forward flight at ${n(r.forwardSpeed)} m/s, not for hovering. Whether it flies forward is shown by the “Flapping-wing free flight” programme.`);
    return { kind: 'no-lift', title: tr('Не висит', 'Does not hover'), reasons: [noLift[0], hint, ...noLift.slice(1)].slice(0, 3), warnings, crewLevel: level };
  }
  if (noLift.length) return { kind: 'no-lift', title: verdictName('no-lift'), reasons: noLift.slice(0, 3), warnings, crewLevel: level };

  if (r.strengthInfoOnly) warnings.push(tr(`Прочность справочно (${margin}): ${r.strengthInfoOnly}.`, `Strength for reference only (${margin}): ${r.strengthInfoOnly}.`));
  else if (r.minMargin < 1.5) marginal.push(tr(`${capital(margin)}; в авиации нужен запас не меньше 1,5.`, `${capital(margin)}; aviation requires a margin of at least 1.5.`));
  if (r.fatigue.hours < 1) marginal.push(tr(
    `Усталостный ресурс ${n(r.fatigue.hours * 60)} мин: ${q(r.fatigue.part)} на ${pct(r.fatigue.spanFrac)} % размаха.`,
    `Fatigue life ${n(r.fatigue.hours * 60)} min: ${q(r.fatigue.part)} at ${pct(r.fatigue.spanFrac)} % span.`));
  if (level === 'injurious') marginal.push(crewText(r));
  if (r.minYieldMargin < 1 && !r.strengthInfoOnly) marginal.push(tr(
    `Металл течёт: напряжение выше предела текучести в ${raz(1 / r.minYieldMargin, 2)} — остаточная деформация.`,
    `The metal yields: stress is ${raz(1 / r.minYieldMargin, 2)} the yield strength — permanent deformation.`));
  const stressFailed = r.stress?.filter((s) => s.pass === false) ?? [];
  if (r.stress && stressFailed.length)
    marginal.unshift(tr(
      `Стресс-тесты по нормам лётной годности: не пройдено ${stressFailed.length} из ${r.stress.filter((s) => s.pass !== null).length} — ${stressFailed.map((s) => s.name).join('; ')}.`,
      `Airworthiness stress tests: ${stressFailed.length} of ${r.stress.filter((s) => s.pass !== null).length} failed — ${stressFailed.map((s) => s.name).join('; ')}.`));
  if (marginal.length) return { kind: 'marginal', title: verdictName('marginal'), reasons: marginal.slice(0, 3), warnings, crewLevel: level };

  const ok: string[] = [];
  if (Number.isFinite(r.minMargin) && !r.strengthInfoOnly) {
    ok.push(capital(margin) + '.');
    // Усталость считается по полному циклу в конце испытания.
    if (!r.finished) {
      /* ещё не посчитана */
    } else if (Number.isFinite(r.fatigue.hours) && r.fatigue.hours < 1e6) ok.push(tr(`Усталостный ресурс около ${n(r.fatigue.hours)} ч.`, `Fatigue life about ${n(r.fatigue.hours)} h.`));
    else if (Number.isFinite(r.fatigue.hours)) ok.push(tr('Усталостный ресурс практически не ограничен.', 'Fatigue life is practically unlimited.'));
    else if (!r.fatigue.noData.length) ok.push(tr('Напряжения ниже предела выносливости — усталость не грозит.', 'Stresses are below the endurance limit — no fatigue risk.'));
  }
  if (r.stress) {
    const passed = r.stress.filter((s) => s.pass).length;
    const judged = r.stress.filter((s) => s.pass !== null).length;
    ok.splice(1, 0, tr(`Стресс-тесты по нормам лётной годности: пройдено ${passed} из ${judged}.`, `Airworthiness stress tests: ${passed} of ${judged} passed.`));
  }
  if (r.hover?.achieved) ok.push(tr(`Висение удержано, мощность ${n(r.hover.power / 1e3)} кВт из ${n(r.powerAvailable / 1e3)} кВт.`, `Hover held, power ${n(r.hover.power / 1e3)} kW of ${n(r.powerAvailable / 1e3)} kW.`));
  if (r.free && !r.free.grounded)
    ok.push(tr(
      `Свободный полёт: ${freeFacts(r.free)}; мощность ${watts(r.free.power)} из ${watts(avail)}.`,
      `Free flight: ${freeFacts(r.free)}; power ${watts(r.free.power)} of ${watts(avail)}.`));
  else if (r.tunnel?.trimmed)
    ok.push(tr(
      `В потоке ${n(r.tunnel.speed)} м/с держит вес и скорость: запас тяги ${n(r.tunnel.netThrustMaxToWeight * 100, 2)} % веса, мощность ${watts(r.tunnel.power)} из ${watts(avail)}.`,
      `In a ${n(r.tunnel.speed)} m/s flow it holds weight and speed: thrust margin ${n(r.tunnel.netThrustMaxToWeight * 100, 2)} % of weight, power ${watts(r.tunnel.power)} of ${watts(avail)}.`));
  if (r.flight?.airborne)
    ok.push(tr(`Полёт: отрыв на ${n(r.flight.vRotate)} м/с`, `Flight: lift-off at ${n(r.flight.vRotate)} m/s`) +
      (r.flight.vStall !== undefined ? tr(`, сваливание на ${n(r.flight.vStall)} м/с.`, `, stall at ${n(r.flight.vStall)} m/s.`)
        : r.flight.loadFactor ? tr(`, манёвр с перегрузкой ${n(r.flight.loadFactor)}.`, `, manoeuvre at load factor ${n(r.flight.loadFactor)}.`) : '.'));
  return { kind: 'flies', title: verdictName('flies'), reasons: ok.slice(0, 3), warnings, crewLevel: level };
}

/** Свободный полёт в цифрах: сколько летел, как изменились скорость и высота. */
function freeFacts(f: NonNullable<ProgramResult['free']>): string {
  const dh = f.altitudeEnd - f.altitudeStart;
  return tr(
    `за ${n(f.duration)} с (${f.cycles} взмахов, ${n(f.distance)} м) скорость ${n(f.speedEnd)} м/с при заданных ${n(f.speed)} м/с, высота изменилась на ${n(dh, 2)} м`,
    `in ${n(f.duration)} s (${f.cycles} flaps, ${n(f.distance)} m) the speed is ${n(f.speedEnd)} m/s against ${n(f.speed)} m/s commanded, the height changed by ${n(dh, 2)} m`);
}

function crewText(r: ProgramResult): string {
  const cl = r.crewLoad;
  if (cl) {
    const d = cl.design;
    const tl = toleranceLimit(d.axis, d.window);
    const parts: string[] = [];
    if (d.ratio >= 1) parts.push(tr(
      `перегрузка ${d.axis} ${n(d.g)} g в среднем за ${n(d.window)} с (норма NASA для этой длительности — ${n(d.limit)} g, средняя переносимость здоровых людей — ${n(tl)} g)`,
      `load ${d.axis} ${n(d.g)} g averaged over ${n(d.window)} s (NASA limit for this duration ${n(d.limit)} g, average tolerance of healthy people ${n(tl)} g)`));
    if (cl.dr.low >= 1) parts.push(tr(`удар: отклик позвоночника по модели Брикли — ${n(cl.dr.low, 2)} от предела низкого риска травмы`,
      `impact: Brinkley spinal response ${n(cl.dr.low, 2)} of the low-injury-risk limit`));
    if (cl.gloc5s >= GLOC.g) parts.push(tr(`+Gz ${n(cl.gloc5s)} g за 5 с — без защиты человек в среднем теряет сознание с ${n(GLOC.g)} g, аппаратом некому управлять`,
      `+Gz ${n(cl.gloc5s)} g over 5 s — an unprotected person blacks out from ${n(GLOC.g)} g on average, nobody is left to fly the aircraft`));
    if (r.vibrationRms >= CREW_LIMITS.vibration.hard) parts.push(tr(`вибрация в кресле ${n(r.vibrationRms)} м/с² (с.к.з.; по норме ISO опасно для здоровья при коротком воздействии от ${n(CREW_LIMITS.vibration.injurious)})`,
      `seat vibration ${n(r.vibrationRms)} m/s² (RMS; the ISO standard: hazardous to health in short exposure from ${n(CREW_LIMITS.vibration.injurious)})`));
    if (!parts.length) parts.push(tr(`перегрузка ${d.axis} ${n(d.g)} g за ${n(d.window)} с — в пределах норм`, `load ${d.axis} ${n(d.g)} g over ${n(d.window)} s — within limits`));
    return tr(`Экипаж: ${parts.join('; ')}.`, `Crew: ${parts.join('; ')}.`);
  }
  const base = tr(
    `Экипаж: длительная перегрузка ${n(r.crewSustainedG)} g, пиковая ${n(r.crewPeakG)} g, вибрация ${n(r.vibrationRms)} м/с² (с.к.з.)`,
    `Crew: sustained load ${n(r.crewSustainedG)} g, peak ${n(r.crewPeakG)} g, vibration ${n(r.vibrationRms)} m/s² (RMS)`);
  if (r.crewSustainedG >= CREW_LIMITS.sustained.lethal)
    return tr(
      `${base}: выше ${n(CREW_LIMITS.sustained.lethal)} g без защиты человек теряет сознание — аппаратом некому управлять.`,
      `${base}: above ${n(CREW_LIMITS.sustained.lethal)} g an unprotected person blacks out — nobody is left to fly the aircraft.`);
  return `${base}.`;
}

export const watts = (w: number): string => (w >= 1e6 ? `${n(w / 1e6)} ${U.MW}` : w >= 1e3 ? `${n(w / 1e3)} ${U.kW}` : `${n(w)} ${U.W}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
