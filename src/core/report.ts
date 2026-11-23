// Отчёт об испытании (ТЗ, разделы 8 и 9): вердикт, время решающего события, причины с числами,
// ориентиры, телеметрия с пределами. Чистая функция от результата — одинакова в браузере и в Node.
// Правило приёмки этапа 4: каждое число в тексте вердикта есть в таблице телеметрии.
import type { ProgramResult } from './programs.ts';
import type { Spec } from './spec.ts';
import { analyze, n, raz, watts, THRUST_TOLERANCE, FREE_TOLERANCE, RESONANCE_DAF, type Verdict } from './analyze.ts';
import { quasiSteadyThrustOverestimate } from './aero.ts';
import { modeName } from './strength.ts';
import { CREW_LIMITS, toleranceLimit } from './crew.ts';
import { td, tr, U } from './i18n.ts';

export interface ReportRow {
  key: string;
  label: string;
  value: string;
  note?: string;
  level?: 'ok' | 'warn' | 'bad';
}

export interface Report {
  vehicle: string;
  program: string;
  verdict: Verdict;
  event: string; // когда наступило решающее событие
  comparisons: string[]; // понятные ориентиры
  telemetry: ReportRow[];
  disclaimer: string;
}

export const disclaimer = () => tr(
  'Результат — оценка по упрощённой физической модели, а не инженерный расчёт. Настоящей технике нужны расчёт по нормам и испытания.',
  'The result is an estimate from a simplified physical model, not an engineering analysis. Real aircraft need design to standards and testing.');

/** Нужная мощность в программе — та же, что сравнивает вердикт. Без возврата энергии торможения крыльев. */
export function powerNeed(r: ProgramResult): number {
  return r.free?.power ?? r.tunnel?.power ?? r.hover?.power ?? r.powerMean;
}

/** То же при полном возврате энергии торможения крыльев; у винтов и самолётов совпадает с powerNeed. */
export function powerNeedRecovered(r: ProgramResult): number {
  const need = powerNeed(r);
  if (!r.powerRecoverable) return need;
  return Math.min(need, r.free ? r.free.powerRecovered : r.tunnel ? r.tunnel.powerRecovered ?? need : r.powerRecoveredMean);
}

export function partNames(spec: Spec): Record<string, string> {
  return Object.fromEntries(spec.parts.map((p) => [p.id, p.name ?? p.id]));
}

export function buildReport(r: ProgramResult, spec: Spec): Report {
  const names = partNames(spec);
  const nm = (id: string) => td(names[id] ?? id);
  const q = (id: string) => tr(`«${nm(id)}»`, `“${nm(id)}”`);
  const v = analyze(r, names);
  const pct = (x: number) => Math.round(x * 100);
  const rows: ReportRow[] = [];
  const row = (x: ReportRow) => rows.push(x);
  const L = CREW_LIMITS;
  const after = r.breaks.length
    ? tr(`; включая время после разрушения на ${n(r.breaks[0].t)} с — без разрушения см. ниже`, `; includes the time after the failure at ${n(r.breaks[0].t)} s — see the no-break run below`)
    : '';

  row({ key: 'time', label: tr('Длительность испытания', 'Test duration'), value: `${n(r.simTime)} ${U.s}`, note: r.finished ? tr('программа пройдена до конца', 'programme completed') : tr('испытание не завершено', 'test not finished') });
  row({ key: 'mass', label: tr('Масса аппарата', 'Vehicle mass'), value: `${n(r.totalMass)} ${U.kg}` });

  if (!r.strengthChecked)
    row({ key: 'margin', label: tr('Запас прочности', 'Safety margin'), value: tr('не проверялся', 'not checked'), note: tr('у деталей не задан силовой набор', 'the parts have no load-bearing structure defined'), level: 'warn' });
  else if (Number.isFinite(r.minMargin))
    row({
      key: 'margin', label: tr('Запас прочности, худший', 'Safety margin, worst'),
      value: tr(`${n(r.minMargin)} · нужно не меньше ${n(1.5)}, разрушение при 1`, `${n(r.minMargin)} · at least ${n(1.5)} required, failure at 1`),
      note: tr(`${q(r.minMarginPart)} на ${pct(r.minMarginSpan)} % размаха — ${modeName(r.minMarginMode)}`, `${q(r.minMarginPart)} at ${pct(r.minMarginSpan)} % span — ${modeName(r.minMarginMode)}`),
      level: r.minMargin < 1 ? 'bad' : r.minMargin < 1.5 ? 'warn' : 'ok',
    });
  if (Number.isFinite(r.minYieldMargin))
    row({
      key: 'yield', label: tr('Запас до текучести металла', 'Margin to metal yield'), value: n(r.minYieldMargin),
      note: r.minYieldMargin < 1 ? tr(`напряжение выше предела текучести в ${raz(1 / r.minYieldMargin, 2)}`, `stress is ${raz(1 / r.minYieldMargin, 2)} the yield strength`) : tr('ниже предела текучести', 'below the yield strength'),
      level: r.minYieldMargin < 1 ? 'warn' : 'ok',
    });
  row({
    key: 'breaks', label: tr('Разрушено деталей', 'Parts broken'), value: String(r.breaks.length),
    note: r.breaks.slice(0, 3).map((b) => tr(`${q(b.part)} на ${n(b.t)} с: ${modeName(b.mode)} на ${pct(b.spanFrac)} % размаха`, `${q(b.part)} at ${n(b.t)} s: ${modeName(b.mode)} at ${pct(b.spanFrac)} % span`)).join('; ') || undefined,
    level: r.breaks.length ? 'bad' : 'ok',
  });

  if (Number.isFinite(r.liftToWeightMax))
    row({
      key: 'lift', label: tr('Подъёмная сила / вес', 'Lift / weight'),
      value: tr(`макс ${n(r.liftToWeightMax * 100, 2)} %, в среднем ${n(r.liftToWeightMean * 100, 2)} %`, `max ${n(r.liftToWeightMax * 100, 2)} %, mean ${n(r.liftToWeightMean * 100, 2)} %`),
      note: tr('вертикальная аэродинамическая сила', 'vertical aerodynamic force') + after,
    });

  const need = powerNeed(r);
  const rec = powerNeedRecovered(r);
  const avail = r.powerAvailable;
  row({
    key: 'power', label: tr('Нужная мощность', 'Power required'), value: tr(`${watts(need)} из ${watts(avail)}`, `${watts(need)} of ${watts(avail)}`),
    note: (need > avail
      ? tr(`в ${raz(need / avail, 2)} больше, чем даёт силовая установка`, `${raz(need / avail, 2)} what the powerplant gives`)
      : tr(`${n((need / avail) * 100, 2)} % располагаемой`, `${n((need / avail) * 100, 2)} % of available`)) +
      (rec < need * 0.97
        ? tr(`; это без возврата энергии торможения крыльев. С полным возвратом (упругое крыло, пружина) — ${watts(rec)}`, `; this is without recovery of the wing braking energy. With full recovery (elastic wing, spring) — ${watts(rec)}`) +
          (rec > avail ? tr(`, в ${raz(rec / avail, 2)} больше располагаемой`, `, ${raz(rec / avail, 2)} the available power`) : '')
        : '') + after,
    level: rec > avail * 1.0001 ? 'bad' : need > avail * 1.0001 ? 'warn' : 'ok',
  });
  row({ key: 'powerPeak', label: tr('Пиковая мощность', 'Peak power'), value: watts(r.powerPeak) });

  const crewLevel = v.crewLevel;
  row({
    key: 'crew', label: r.unmanned ? tr('Корпус (людей на борту нет): длительная / пиковая перегрузка', 'Body (nobody on board): sustained / peak load') : tr('Экипаж: длительная / пиковая перегрузка', 'Crew: sustained / peak load'),
    value: `${n(r.crewSustainedG)} g / ${n(r.crewPeakG)} g`,
    note: r.unmanned ? tr('аппарат беспилотный: на вердикт не влияет', 'the vehicle is unmanned: this does not affect the verdict') : r.crewLoad ? tr(
      `по осям и длительности: ${r.crewLoad.design.axis} ${n(r.crewLoad.design.g)} g за ${n(r.crewLoad.design.window)} с — ${n(r.crewLoad.design.ratio * 100, 2)} % нормы NASA-STD-3001 (${n(r.crewLoad.design.limit)} g; средняя переносимость здоровых людей ${n(toleranceLimit(r.crewLoad.design.axis, r.crewLoad.design.window))} g); +Gz за 5 с — ${n(r.crewLoad.gloc5s)} g (потеря сознания без защиты — в среднем с 5,4 g); удар по модели Брикли — ${n(r.crewLoad.dr.low * 100, 2)} % предела низкого риска (${n(r.crewLoad.dr.low, 2)})`,
      `by axis and duration: ${r.crewLoad.design.axis} ${n(r.crewLoad.design.g)} g over ${n(r.crewLoad.design.window)} s — ${n(r.crewLoad.design.ratio * 100, 2)} % of the NASA-STD-3001 limit (${n(r.crewLoad.design.limit)} g; average tolerance of healthy people ${n(toleranceLimit(r.crewLoad.design.axis, r.crewLoad.design.window))} g); +Gz over 5 s — ${n(r.crewLoad.gloc5s)} g (unprotected blackout from 5.4 g on average); Brinkley impact — ${n(r.crewLoad.dr.low * 100, 2)} % of the low-risk limit (${n(r.crewLoad.dr.low, 2)})`) : tr(
      `длительно тяжело от ${n(L.sustained.hard)} g, опасно от ${n(L.sustained.injurious)} g, без защиты человек теряет сознание выше ${n(L.sustained.lethal)} g; удар — низкий риск до ${n(L.impact.hard)} g, предел кресел ${n(L.impact.injurious)} g`,
      `sustained: hard from ${n(L.sustained.hard)} g, dangerous from ${n(L.sustained.injurious)} g, an unprotected person blacks out above ${n(L.sustained.lethal)} g; impact: low risk up to ${n(L.impact.hard)} g, seat limit ${n(L.impact.injurious)} g`),
    level: crewLevel === 'lethal' ? 'bad' : crewLevel === 'injurious' || crewLevel === 'hard' ? 'warn' : 'ok',
  });
  row({
    key: 'vibration', label: r.unmanned ? tr('Вибрация корпуса, 2–16 Гц', 'Body vibration, 2–16 Hz') : tr('Вибрация в кресле, 2–16 Гц', 'Seat vibration, 2–16 Hz'), value: `${n(r.vibrationRms)} ${U.ms2}`,
    note: r.unmanned ? tr('аппарат беспилотный: на вердикт не влияет', 'the vehicle is unmanned: this does not affect the verdict') : tr(`тяжело от ${n(L.vibration.hard)} м/с², опасно от ${n(L.vibration.injurious)} м/с²`, `hard from ${n(L.vibration.hard)} m/s², dangerous from ${n(L.vibration.injurious)} m/s²`),
    level: !r.unmanned && r.vibrationRms >= L.vibration.injurious ? 'warn' : 'ok',
  });
  row({
    key: 'mach', label: tr('Число Маха сечений', 'Section Mach number'), value: n(r.maxMach, 2),
    note: (r.maxMach > 1 ? tr('быстрее звука; ', 'supersonic; ') : '') + tr(`модель сжимаемости работает до ${n(0.7)}`, `the compressibility model holds up to ${n(0.7)}`),
    level: r.maxMach > 0.7 ? 'bad' : 'ok',
  });

  const fh = r.fatigue.hours;
  if (r.finished && Number.isFinite(fh))
    row({
      key: 'fatigue', label: tr('Усталостный ресурс', 'Fatigue life'),
      value: fh >= 1e6 ? tr('практически не ограничен', 'practically unlimited') : fh < 1 ? `${n(fh * 60)} ${U.min}` : `${n(fh)} ${U.h}`,
      note: r.fatigue.part ? tr(`${q(r.fatigue.part)} на ${pct(r.fatigue.spanFrac)} % размаха; нужно не меньше часа`, `${q(r.fatigue.part)} at ${pct(r.fatigue.spanFrac)} % span; at least an hour is required`) : undefined,
      level: fh < 1 ? 'warn' : 'ok',
    });

  if (r.hover)
    row({
      key: 'hover', label: tr('Висение', 'Hover'),
      value: r.hover.achieved ? tr(`удержано, ${n(r.hover.power / 1e3)} кВт из ${n(r.powerAvailable / 1e3)} кВт`, `held, ${n(r.hover.power / 1e3)} kW of ${n(r.powerAvailable / 1e3)} kW`) : tr('не удержано', 'not held'),
      note: r.hover.saturated ? tr(`на максимуме управления подъёмная сила ${n(r.hover.liftToWeightAtMax * 100, 2)} % веса`, `at full control the lift is ${n(r.hover.liftToWeightAtMax * 100, 2)} % of weight`) : undefined,
      level: r.hover.achieved ? 'ok' : 'bad',
    });
  if (r.tunnel) {
    const t = r.tunnel;
    const rel = t.dragEstimate > 0 ? -t.netThrustMax / t.dragEstimate : 0;
    row({
      key: 'tunnel', label: tr(`Поток ${n(t.speed)} м/с: подъёмная сила`, `Flow ${n(t.speed)} m/s: lift`),
      value: tr(`${n(t.liftToWeight * 100, 2)} % веса`, `${n(t.liftToWeight * 100, 2)} % of weight`),
      note: tr(`угол установки крыльев ${n(t.pitchDeg)}°`, `wing incidence ${n(t.pitchDeg)}°`) +
        (t.twist !== undefined ? tr(`, закручивание ${n(t.twist * 100, 2)} % наибольшего; циклов взмаха на поиск: ${t.cycles}`, `, twist ${n(t.twist * 100, 2)} % of maximum; flapping cycles spent searching: ${t.cycles}`) : ''),
      level: t.trimmed ? 'ok' : 'bad',
    });
    row({
      key: 'thrust', label: tr('Запас тяги: наибольшая тяга − сопротивление', 'Thrust margin: maximum thrust − drag'),
      value: tr(`${n(t.netThrustMax)} Н (${n(t.netThrustMaxToWeight * 100, 2)} % веса)`, `${n(t.netThrustMax)} N (${n(t.netThrustMaxToWeight * 100, 2)} % of weight)`),
      note: tr(`сопротивление в планировании около ${n(t.dragEstimate)} Н`, `gliding drag about ${n(t.dragEstimate)} N`) +
        (t.netThrustMax < 0
          ? tr(`; не хватает ${n(-t.netThrustMax)} Н — это ${n(rel * 100, 2)} % сопротивления и ${n(-t.netThrustMaxToWeight * 100, 2)} % веса; точность модели — ${n(THRUST_TOLERANCE * 100)} % сопротивления`,
            `; short by ${n(-t.netThrustMax)} N — ${n(rel * 100, 2)} % of drag and ${n(-t.netThrustMaxToWeight * 100, 2)} % of weight; model accuracy is ${n(THRUST_TOLERANCE * 100)} % of drag`)
          : tr(`; на режиме измерения тяга − сопротивление ${n(t.netThrust)} Н`, `; at the measured point thrust − drag is ${n(t.netThrust)} N`)),
      level: t.netThrustMax >= 0 ? 'ok' : rel > THRUST_TOLERANCE ? 'bad' : 'warn',
    });
    if (t.reducedFrequency > 0)
      row({
        key: 'reduced', label: tr('Приведённая частота взмаха k', 'Reduced flapping frequency k'), value: n(t.reducedFrequency, 2),
        note: t.unsteady
          ? tr('нестационарность учтена: запаздывание подъёмной силы (функция Вагнера) и срыва (постоянные для профиля NACA 0012)', 'unsteadiness is modelled: lift lag (Wagner function) and stall delay (constants for the NACA 0012 airfoil)')
          : t.reducedFrequency >= 0.1
            ? tr(`модель установившегося обтекания завышает тягу взмаха примерно в ${raz(quasiSteadyThrustOverestimate(t.reducedFrequency), 2)}`, `the steady-flow model overestimates flapping thrust by about ${raz(quasiSteadyThrustOverestimate(t.reducedFrequency), 2)}`)
            : tr('обтекание близко к установившемуся', 'the flow is close to steady'),
        level: t.reducedFrequency >= 0.1 && !t.unsteady ? 'warn' : 'ok',
      });
  }
  if (r.free) {
    const f = r.free;
    const rel = r.tunnel && r.tunnel.dragEstimate > 0 ? -f.netForce / r.tunnel.dragEstimate : 0;
    row({
      key: 'free', label: tr('Свободный полёт', 'Free flight'),
      value: tr(`${n(f.duration)} с, ${f.cycles} взмахов, ${n(f.distance)} м`, `${n(f.duration)} s, ${f.cycles} flaps, ${n(f.distance)} m`) + (f.grounded ? tr(' — прерван', ' — cut short') : ''),
      note: tr(
        `высота от начальной: от ${n(f.altitudeMin - f.altitudeStart, 2)} до ${n(f.altitudeMax - f.altitudeStart, 2)} м, в конце ${n(f.altitudeEnd - f.altitudeStart, 2)} м; скорость в конце ${n(f.speedEnd)} м/с при заданных ${n(f.speed)} м/с, наименьшая ${n(f.speedMin)} м/с; тяга − сопротивление по изменению полной энергии ${n(f.netForce, 2)} Н; автопилот менял угол установки крыльев в пределах ${n(f.pitchRange[0])}…${n(f.pitchRange[1])}°`,
        `height from the start: ${n(f.altitudeMin - f.altitudeStart, 2)} to ${n(f.altitudeMax - f.altitudeStart, 2)} m, ${n(f.altitudeEnd - f.altitudeStart, 2)} m at the end; final speed ${n(f.speedEnd)} m/s against ${n(f.speed)} m/s commanded, lowest ${n(f.speedMin)} m/s; thrust − drag from the change in total energy ${n(f.netForce, 2)} N; the autopilot moved the wing incidence within ${n(f.pitchRange[0])}…${n(f.pitchRange[1])}°`) +
        (f.twistRange ? tr(`, закручивание — ${n(f.twistRange[0] * 100, 2)}…${n(f.twistRange[1] * 100, 2)} % наибольшего`, `, the twist within ${n(f.twistRange[0] * 100, 2)}…${n(f.twistRange[1] * 100, 2)} % of maximum`) : '') +
        tr('; курс и наклон корпуса удерживаются (хвост не моделируется)', '; heading and body attitude are held (the tail is not modelled)'),
      level: f.grounded || rel > THRUST_TOLERANCE ? 'bad' : rel > FREE_TOLERANCE ? 'warn' : 'ok',
    });
    if (f.pitchHold) {
      const h = f.pitchHold;
      row({
        key: 'pitchHold', label: tr('Удержание наклона корпуса', 'Body pitch hold'),
        value: tr(`${n(h.mean, 2)} Н·м в среднем, ±${n(h.amp, 2)} Н·м за взмах`, `${n(h.mean, 2)} N·m mean, ±${n(h.amp, 2)} N·m per flap`),
        note: tr(`момент, которым корпус держали по тангажу (оперение не моделируется); коэффициент момента ${n(h.cm, 2)}; без удержания корпус качался бы примерно на ±${n(h.swingDeg, 2)}°`,
          `the moment that held the body in pitch (the tail is not modelled); moment coefficient ${n(h.cm, 2)}; unrestrained, the body would rock by about ±${n(h.swingDeg, 2)}°`),
        level: 'warn',
      });
    }
  }
  if (r.flight) {
    const f = r.flight;
    const parts = [
      f.vRotate !== undefined ? tr(`отрыв на ${n(f.vRotate)} м/с`, `lift-off at ${n(f.vRotate)} m/s`) : null,
      f.takeoffDistance !== undefined ? tr(`разбег ${n(f.takeoffDistance)} м`, `take-off run ${n(f.takeoffDistance)} m`) : null,
      f.vMax !== undefined ? tr(`максимальная скорость ${n(f.vMax)} м/с`, `top speed ${n(f.vMax)} m/s`) : null,
      f.vStall !== undefined ? tr(`сваливание на ${n(f.vStall)} м/с`, `stall at ${n(f.vStall)} m/s`) : null,
      f.loadFactor !== undefined ? tr(`манёвр с перегрузкой ${n(f.loadFactor)}`, `manoeuvre at load factor ${n(f.loadFactor)}`) : null,
      f.cruiseSpeed !== undefined ? tr(`крейсер ${n(f.cruiseSpeed)} м/с — ${n((f.cruisePower ?? 0) / 1e3)} кВт`, `cruise ${n(f.cruiseSpeed)} m/s — ${n((f.cruisePower ?? 0) / 1e3)} kW`) : null,
    ].filter(Boolean);
    row({ key: 'flight', label: tr('Полёт', 'Flight'), value: f.airborne ? tr('был отрыв', 'lifted off') : tr('отрыва не было', 'never lifted off'), note: parts.join(', ') || undefined, level: f.levelReached === false ? 'bad' : 'ok' });
  }
  if (r.endurance !== undefined && Number.isFinite(r.endurance))
    row({
      key: 'endurance', label: tr('Хватит топлива или батареи при этой мощности', 'Fuel or battery lasts at this power'),
      value: r.endurance > 3600 ? tr(`${n(r.endurance / 3600)} ч`, `${n(r.endurance / 3600)} h`) : tr(`${n(r.endurance / 60)} мин`, `${n(r.endurance / 60)} min`),
      note: tr('весь запас, без резерва и без расхода на запуск, руление и набор', 'the whole supply, no reserve, no start-up, taxi or climb'),
    });
  if (r.flutter) {
    const fl = r.flutter;
    const vLim = Math.min(fl.vFlutter, fl.vDivergence);
    row({
      key: 'flutter', label: tr('Флаттер и дивергенция крыла', 'Wing flutter and divergence'),
      value: tr(`флаттер ${Number.isFinite(fl.vFlutter) ? n(fl.vFlutter) + ' м/с' : 'нет'}, дивергенция ${Number.isFinite(fl.vDivergence) ? n(fl.vDivergence) + ' м/с' : 'нет'}`,
        `flutter ${Number.isFinite(fl.vFlutter) ? n(fl.vFlutter) + ' m/s' : 'none'}, divergence ${Number.isFinite(fl.vDivergence) ? n(fl.vDivergence) + ' m/s' : 'none'}`),
      note: tr(`частоты изгиба ${n(fl.fBending)} и кручения ${n(fl.fTorsion)} Гц; наибольшая скорость испытания ${n(r.airspeedMax)} м/с`, `bending ${n(fl.fBending)} and torsion ${n(fl.fTorsion)} Hz; test top speed ${n(r.airspeedMax)} m/s`),
      level: r.airspeedMax >= vLim ? 'bad' : r.airspeedMax * 1.2 > vLim ? 'warn' : 'ok',
    });
  }
  if (r.resonance)
    row({
      key: 'resonance', label: tr('Собственная частота крыла', 'Wing natural frequency'),
      value: tr(`${n(r.resonance.f1)} Гц при приводе ${n(r.resonance.fe)} Гц`, `${n(r.resonance.f1)} Hz with a ${n(r.resonance.fe)} Hz drive`),
      note: tr(`${q(r.resonance.part)}; демпфирование ${n(r.resonance.zeta ?? 0.03, 2)} (из него воздух ${n(r.resonance.zetaAir ?? 0, 2)}); усиление нагрузок ×${n(r.resonance.daf, 2)}`,
        `${q(r.resonance.part)}; damping ${n(r.resonance.zeta ?? 0.03, 2)} (air ${n(r.resonance.zetaAir ?? 0, 2)}); load amplification ×${n(r.resonance.daf, 2)}`),
      level: r.resonance.ratio >= 1 ? 'bad' : r.resonance.ratio > 0.6 && r.resonance.daf >= RESONANCE_DAF ? 'warn' : 'ok',
    });
  for (const [i, x] of r.notes.entries()) row({ key: `note${i}`, label: tr('Примечание программы', 'Programme note'), value: x });

  // Время решающего события.
  let event: string;
  if (v.kind === 'breaks' && r.breaks.length) event = tr(`Первое разрушение на ${n(r.breaks[0].t)} с испытания.`, `First failure at ${n(r.breaks[0].t)} s into the test.`);
  else if (v.kind === 'n/a') event = tr('Испытание к аппарату не применимо.', 'The test does not apply to this vehicle.');
  else event = tr(`Итог по ${n(r.simTime)} с испытания${r.finished ? '' : ' (не завершено)'}.`, `Result after ${n(r.simTime)} s of testing${r.finished ? '' : ' (not finished)'}.`);

  return {
    vehicle: td(spec.meta.name),
    program: r.name,
    verdict: v,
    event,
    comparisons: comparisons(r, need),
    telemetry: rows,
    disclaimer: disclaimer(),
  };
}

// ---------- ориентиры ----------
// Числа ориентиров — справочные, не из телеметрии. Где есть источник, он в data/research.md.
const POWER_REFS: { w: number; ru: string; en: string }[] = [
  { w: 650, ru: 'пилот мускулолёта Snowbird на рабочем ходе (600–700 Вт, его собственная оценка)', en: 'the pilot of the Snowbird human-powered ornithopter on a power stroke (600–700 W, his own estimate)' },
  { w: 97.7e3, ru: 'двигатель вертолёта R22 (97,7 кВт)', en: 'the R22 helicopter engine (97.7 kW)' },
  { w: 134.2e3, ru: 'двигатель Cessna 172S (134 кВт, 180 л. с.)', en: 'the Cessna 172S engine (134 kW, 180 hp)' },
  { w: 1.6e6, ru: 'двигатель ТВ3-117 вертолёта Ми-8 (порядка 1,6 МВт)', en: 'the TV3-117 engine of the Mi-8 helicopter (about 1.6 MW)' },
  { w: 40e6, ru: 'газовая турбина военного корабля (порядка 40 МВт)', en: 'a warship gas turbine (about 40 MW)' },
  { w: 1e9, ru: 'энергоблок АЭС (порядка 1000 МВт)', en: 'a nuclear power unit (about 1000 MW)' },
];

function times(x: number): string {
  if (x >= 0.9 && x <= 1.1) return tr('примерно как', 'about the same as');
  return x > 1 ? tr(`в ${raz(x, 2)} больше, чем`, `${raz(x, 2)} more than`) : tr(`в ${raz(1 / x, 2)} меньше, чем`, `${raz(1 / x, 2)} less than`);
}

function nearestPower(w: number) {
  let best = POWER_REFS[0];
  for (const ref of POWER_REFS) if (Math.abs(Math.log(w / ref.w)) < Math.abs(Math.log(w / best.w))) best = ref;
  return best;
}

export function comparisons(r: ProgramResult, need: number): string[] {
  const out: string[] = [];
  if (need > 0) {
    const ref = nearestPower(need);
    out.push(tr(`Нужная мощность ${times(need / ref.w)} ${ref.ru}.`, `The power required is ${times(need / ref.w)} ${ref.en}.`));
  }
  if (r.powerAvailable > 0 && need > r.powerAvailable * 1.0001) {
    const ref = nearestPower(r.powerAvailable);
    out.push(tr(`Силовая установка аппарата даёт ${times(r.powerAvailable / ref.w).replace('примерно как', 'примерно столько же, сколько')} ${ref.ru}.`,
      `The vehicle's powerplant gives ${times(r.powerAvailable / ref.w)} ${ref.en}.`));
  }
  // Если деталь сломалась, запас в момент разрушения ≈ 1; во сколько раз нагрузка выше — по прогону без разрушения.
  if (!r.breaks.length && Number.isFinite(r.minMargin) && r.minMargin < 1) out.push(overload(r.minMargin));
  const g = r.crewSustainedG;
  if (g >= CREW_LIMITS.sustained.hard)
    out.push(tr(`Длительная перегрузка ${n(g)} g: пилот истребителя в противоперегрузочном костюме выдерживает до 9 g, без костюма теряют сознание примерно с 5–6 g.`,
      `Sustained load ${n(g)} g: a fighter pilot in a g-suit tolerates up to 9 g; without one people black out from about 5–6 g.`));
  if (r.crewPeakG >= CREW_LIMITS.impact.hard)
    out.push(tr(`Удар ${n(r.crewPeakG)} g: кресла лёгких самолётов сертифицируют на ${n(CREW_LIMITS.impact.injurious)} g.`, `Impact ${n(r.crewPeakG)} g: light-aircraft seats are certified to ${n(CREW_LIMITS.impact.injurious)} g.`));
  if (r.maxMach > 1) out.push(tr(`Концы крыльев или лопастей движутся в ${raz(r.maxMach, 2)} быстрее звука — как пуля, а не как птица.`, `The wing or blade tips move ${raz(r.maxMach, 2)} faster than sound — like a bullet, not a bird.`));
  return out;
}

export function overload(margin: number): string {
  return tr(`Нагрузка в ${raz(1 / margin, 2)} выше той, что ломает деталь; в авиации деталь должна выдерживать в полтора раза больше расчётной.`,
    `The load is ${raz(1 / margin, 2)} higher than what breaks the part; in aviation a part must withstand 1.5 times the design load.`);
}

/** Все числа в строке: «12 400», «0,85», «−9,7». */
export function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[   ]\d{3})*(?:,\d+)?/g) ?? []).map((x) => x.replace(/[   ]/g, ' '));
}

/** Отпечаток телеметрии по 12 значащим цифрам — сверять прогоны в разных браузерах и в Node.
 *  Последние биты в разных движках JS расходятся (≈1e-15), поэтому до последнего бита не сравниваем;
 *  «нули с шумом» (остатки вычитания порядка 1e-16) считаются нулём. */
export function resultDigest(r: ProgramResult): string {
  const key = JSON.stringify([
    r.simTime, r.minMargin, r.minMarginPart, r.minMarginMode, r.powerMean, r.powerPeak, r.liftToWeightMax, r.liftToWeightMean,
    r.crewPeakG, r.crewSustainedG, r.vibrationRms, r.maxMach, r.fatigue.hours, r.breaks.map((b) => [b.t, b.part, b.mode, b.spanFrac]),
    r.hover ?? null, r.tunnel ?? null, r.flight ?? null, r.free ?? null,
  ], (_, v) => (typeof v === 'number' ? (!Number.isFinite(v) ? String(v) : Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(12))) : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
