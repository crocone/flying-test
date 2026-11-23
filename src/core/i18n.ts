// Два языка интерфейса (ТЗ, раздел 10: русский и английский).
// Фразы ядра задаются парой tr('по-русски', 'in English') прямо на месте — так их не потерять при
// правке. Данные (названия аппаратов, деталей, материалов, допущений) переводятся словарём
// «русская строка → английская» (src/core/i18n-data.ts). Язык — общий для модуля: в браузере,
// в фоновом потоке (на каждое задание) и в командной строке (по умолчанию русский).
import { DATA_EN } from './i18n-data.ts';

export type Lang = 'ru' | 'en';
let current: Lang = 'ru';

export const setLang = (l: Lang) => {
  current = l;
};
export const getLang = (): Lang => current;
export const isEn = () => current === 'en';

/** Фраза на текущем языке. */
export const tr = (ru: string, en: string): string => (current === 'en' ? en : ru);

/** Строка данных (название, подпись допущения): по словарю, а чего в нём нет — как есть. */
export function td(ru: string): string {
  if (current !== 'en' || !ru) return ru;
  const hit = DATA_EN[ru];
  if (hit) return hit;
  // Названия деталей вида «Крыло Л3», «Лопасть 2».
  const m = ru.match(/^(Крыло|Лопасть|Винт|Втулка) ?([ЛП])?(\d+)$/);
  if (m) return `${{ Крыло: 'Wing', Лопасть: 'Blade', Винт: 'Rotor', Втулка: 'Hub' }[m[1]]} ${m[2] === 'Л' ? 'L' : m[2] === 'П' ? 'R' : ''}${m[3]}`;
  return ru;
}

export const locale = () => (current === 'en' ? 'en-US' : 'ru-RU');

/** Единицы измерения. */
export const U = {
  get s() { return tr('с', 's'); },
  get min() { return tr('мин', 'min'); },
  get h() { return tr('ч', 'h'); },
  get m() { return tr('м', 'm'); },
  get mm() { return tr('мм', 'mm'); },
  get ms() { return tr('м/с', 'm/s'); },
  get ms2() { return tr('м/с²', 'm/s²'); },
  get kg() { return tr('кг', 'kg'); },
  get N() { return tr('Н', 'N'); },
  get Hz() { return tr('Гц', 'Hz'); },
  get W() { return tr('Вт', 'W'); },
  get kW() { return tr('кВт', 'kW'); },
  get MW() { return tr('МВт', 'MW'); },
  get GPa() { return tr('ГПа', 'GPa'); },
  get MPa() { return tr('МПа', 'MPa'); },
  get kgm3() { return tr('кг/м³', 'kg/m³'); },
};

/** Единица из данных («м», «Вт», «Гц», …) на текущем языке. */
export function unit(u: string | undefined): string {
  if (!u || current !== 'en') return u ?? '';
  const map: Record<string, string> = { 'с': 's', 'м': 'm', 'мм': 'mm', 'м/с': 'm/s', 'кг': 'kg', 'Н': 'N', 'Гц': 'Hz', 'Вт': 'W', 'кВт': 'kW', 'об/мин': 'rpm', 'м²': 'm²', 'кг/м²': 'kg/m²', 'ч': 'h' };
  return map[u] ?? u;
}
