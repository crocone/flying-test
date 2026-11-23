// Библиотека материалов (ТЗ, раздел 7.4). Значения — из data/research.md (по состоянию
// на 2026-11-10), у каждого материала ссылки на источники.
//
// Модели прочности нужны все характеристики. Если в источниках значения нет, оно
// заполнено по стандартному правилу и перечислено в `estimates` — это оценка, а не данные:
// - предел среза металла ≈ 0,6 предела прочности;
// - прочность металла при сжатии ≈ предел текучести при сжатии, иначе при растяжении;
// - показатель Баскина металлов −0,1, композитов и древесины −0,05 (типичные значения);
// - для теоретических материалов сжатие не измерено и принято равным растяжению.

export type MaterialGroup = 'metal' | 'composite' | 'natural' | 'fibre' | 'lab' | 'custom';

export const GROUP_NAMES: Record<MaterialGroup, string> = {
  metal: 'Металлы',
  composite: 'Композиты (вдоль волокон)',
  natural: 'Природные',
  fibre: 'Волокна без связующего',
  lab: 'Лабораторные и теоретические',
  custom: 'Свой материал',
};

export type DataKind = 'typical' | 'minimum' | 'lab' | 'theory';
export const DATA_KIND_NAMES: Record<DataKind, string> = {
  typical: 'типичные справочные значения',
  minimum: 'гарантированный минимум',
  lab: 'лабораторное измерение',
  theory: 'теоретический предел, наномасштаб',
};

export interface Material {
  id: string;
  name: string;
  group: MaterialGroup;
  kind: DataKind;
  density: number; // кг/м³
  E: number; // Па; у композитов и древесины — вдоль волокон
  nu: number;
  // Для материалов с волокнами: модуль поперёк волокон и модуль сдвига в плоскости листа.
  // От них зависит выпучивание тонких стенок. Не задано — материал изотропный.
  E2?: number;
  G12?: number;
  // Прочность однонаправленного слоя поперёк волокон (растяжение, сжатие), Па — для ламинатов: растрескивание связующего.
  Yt?: number;
  Yc?: number;
  yield?: number; // предел текучести, Па
  ultTension: number; // Па
  ultCompression: number; // Па; 0 — не держит сжатие
  shear: number; // Па
  fatigue?: { strength: number; cycles: number; b: number; enduranceLimit?: boolean };
  scale?: string;
  note?: string;
  estimates?: string[];
  sources: string[];
}

const M = 1e6;
const G = 1e9;
const S = {
  al7075: 'https://hplmachining.com/services/cnc-machining/aluminum/7075-2/',
  al2099: 'https://www.smithmetal.com/pdf/lithium/2099-lithium.pdf',
  ti64: 'https://www.aerospacemetals.com/wp-content/uploads/2023/07/Titanium-Ti-6Al-4V-Grade-5-Annealed.pdf',
  s4340qt: 'https://ijmse.iust.ac.ir/article-1-4368-en.pdf',
  s4340n: 'https://quickparts.com/wp-content/uploads/2024/05/Steel-4340.pdf',
  c350: 'https://atimaterials.com/Products/Documents/datasheets/stainless-specialty-steel/specialtysteel/ati_c-200-250-300-350_tds_en4_v1.pdf',
  az31: 'https://alloys.alfa-chemistry.com/az31b.html',
  be: 'https://hkvxni.files.cmp.optimizely.com/download/c2eca2d0f75e11ee9aa0f6c265376dea',
  hexcel: 'https://hexcel.com/wp-content/uploads/2025/12/HexPly_8552_eu_DataSheet1.pdf',
  t1100: 'https://www.toraycma.com/wp-content/uploads/T1100G-Data-Sheet.pdf',
  pc: 'http://www.performance-composites.com/carbonfibre/mechanicalproperties_2.asp',
  wood: 'https://www.precisebits.com/PDF/USFS_mechanical_properties_of_wood.pdf',
  bamboo: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4233722/',
  bambooShear: 'https://doi.org/10.3390/polym14132649',
  zylon: 'http://www.toyobo-global.com/seihin/kc/pbo/zylon-p/bussei-p/technical.pdf',
  dyneema: 'https://dyneema.com/design-with-dyneema/dyneema-product-portfolio',
  yu2000: 'https://doi.org/10.1126/science.287.5453.637',
  bai2018: 'https://doi.org/10.1038/s41565-018-0141-z',
  lee2008: 'https://doi.org/10.1126/science.1157996',
  zhang2024: 'https://doi.org/10.1126/science.adj1082',
  lee2022: 'https://doi.org/10.1126/sciadv.abn0939',
  zu2012: 'https://doi.org/10.1021/nn300857d',
  cntDensity: 'https://europepmc.org/article/PMC/PMC12203435',
  vit: 'https://link.aps.org/accepted/10.1103/PhysRevB.94.144207',
  vitC: 'https://doi.org/10.1016/j.fmre.2021.11.026',
  vitF: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8269617/',
};

const list: Material[] = [
  // ---------- металлы ----------
  {
    id: 'al7075', name: 'Алюминиевый сплав 7075-T6', group: 'metal', kind: 'typical',
    density: 2810, E: 71.7 * G, nu: 0.33, yield: 503 * M, ultTension: 572 * M, ultCompression: 503 * M, shear: 331 * M,
    fatigue: { strength: 159 * M, cycles: 5e8, b: -0.1 },
    estimates: ['сжатие = предел текучести', 'показатель Баскина'], sources: [S.al7075],
  },
  {
    id: 'al2099', name: 'Алюминий-литиевый сплав 2099-T83', group: 'metal', kind: 'minimum',
    density: 2630, E: 78 * G, nu: 0.33, yield: 525 * M, ultTension: 560 * M, ultCompression: 525 * M, shear: 336 * M,
    note: 'Прессованный профиль 12,7–25,4 мм, вдоль проката. Данных об усталости нет',
    estimates: ['плотность (типично для Al-Li)', 'коэффициент Пуассона', 'сжатие', 'срез'], sources: [S.al2099],
  },
  {
    id: 'ti64', name: 'Титановый сплав Ti-6Al-4V, отожжённый', group: 'metal', kind: 'typical',
    density: 4430, E: 113.8 * G, nu: 0.342, yield: 880 * M, ultTension: 950 * M, ultCompression: 970 * M, shear: 550 * M,
    fatigue: { strength: 510 * M, cycles: 1e7, b: -0.1 },
    estimates: ['показатель Баскина'], sources: [S.ti64],
  },
  {
    id: 'steel4340', name: 'Сталь 4340, закалка и отпуск 480 °C', group: 'metal', kind: 'lab',
    density: 7850, E: 200 * G, nu: 0.29, yield: 1050 * M, ultTension: 1151 * M, ultCompression: 1050 * M, shear: 690 * M,
    // Кривая Баскина по испытаниям: σ_f' = 2785 МПа, b = −0,126 → 335 МПа при 10⁷ циклов.
    fatigue: { strength: 335 * M, cycles: 1e7, b: -0.126 },
    note: 'Одна лабораторная работа; плотность, модуль и ν — по нормализованной стали 4340',
    estimates: ['предел текучести (по графику)', 'сжатие', 'срез'], sources: [S.s4340qt, S.s4340n],
  },
  {
    id: 'maraging350', name: 'Мартенситностареющая сталь C-350, состаренная', group: 'metal', kind: 'typical',
    density: 8100, E: 199.9 * G, nu: 0.3, yield: 2344 * M, ultTension: 2413 * M, ultCompression: 2675 * M, shear: 1448 * M,
    fatigue: { strength: 758 * M, cycles: 1e8, b: -0.1 },
    estimates: ['коэффициент Пуассона', 'срез', 'показатель Баскина'], sources: [S.c350],
  },
  {
    id: 'az31b', name: 'Магниевый сплав AZ31B-O', group: 'metal', kind: 'typical',
    density: 1770, E: 45 * G, nu: 0.35, yield: 150 * M, ultTension: 255 * M, ultCompression: 110 * M, shear: 145 * M,
    fatigue: { strength: 120 * M, cycles: 1e7, b: -0.1 },
    estimates: ['число циклов для предела выносливости', 'показатель Баскина'], sources: [S.az31],
  },
  {
    id: 'beryllium', name: 'Бериллий S-200-F', group: 'metal', kind: 'minimum',
    density: 1850, E: 290 * G, nu: 0.1, yield: 241 * M, ultTension: 324 * M, ultCompression: 241 * M, shear: 194 * M,
    note: 'Данных об усталости нет',
    estimates: ['коэффициент Пуассона', 'сжатие', 'срез'], sources: [S.be],
  },
  // ---------- композиты (однонаправленные — вдоль волокон) ----------
  {
    id: 'cfrp', name: 'Углепластик однонаправленный, обобщённый', group: 'composite', kind: 'typical',
    density: 1600, E: 135 * G, E2: 10 * G, G12: 5 * G, nu: 0.3, ultTension: 1500 * M, ultCompression: 1200 * M, shear: 70 * M,
    note: 'Эпоксид 120 °C, 60 % волокна. Данных об усталости композитов нет', sources: [S.pc],
  },
  {
    id: 'im7_8552', name: 'Углепластик IM7/8552 (Hexcel)', group: 'composite', kind: 'typical',
    density: 1570, E: 164 * G, E2: 12 * G, G12: 5 * G, nu: 0.3, ultTension: 2724 * M, ultCompression: 1690 * M, shear: 120 * M,
    note: '57,7 % волокна, 25 °C, сухой', estimates: ['коэффициент Пуассона', 'модуль сдвига в плоскости (по обобщённому углепластику)'], sources: [S.hexcel],
  },
  {
    id: 'as4_8552', name: 'Углепластик AS4/8552 (Hexcel)', group: 'composite', kind: 'typical',
    density: 1580, E: 141 * G, E2: 10 * G, G12: 5 * G, nu: 0.3, ultTension: 2207 * M, ultCompression: 1531 * M, shear: 114 * M,
    estimates: ['коэффициент Пуассона', 'модуль сдвига в плоскости (по обобщённому углепластику)'], sources: [S.hexcel],
  },
  {
    id: 't1100_2592', name: 'Углепластик T1100G/2592 (Toray)', group: 'composite', kind: 'typical',
    density: 1600, E: 185 * G, E2: 10 * G, G12: 5 * G, nu: 0.3, ultTension: 3460 * M, ultCompression: 1870 * M, shear: 160 * M,
    note: 'Нормировано на 60 % волокна', estimates: ['плотность', 'коэффициент Пуассона', 'поперечный модуль и модуль сдвига в плоскости (по обобщённому углепластику)'], sources: [S.t1100],
  },
  {
    id: 'cfrp_woven', name: 'Углепластиковая ткань AS4/8552, 0/90', group: 'composite', kind: 'typical',
    density: 1570, E: 68 * G, E2: 66 * G, G12: 5 * G, nu: 0.1, ultTension: 828 * M, ultCompression: 883 * M, shear: 84 * M,
    note: 'Ближайшая замена квазиизотропному ламинату (его данных нет)',
    estimates: ['коэффициент Пуассона', 'срез (по межслойному)', 'модуль сдвига в плоскости (по обобщённому углепластику)'], sources: [S.hexcel],
  },
  {
    id: 'gfrp', name: 'Стеклопластик E-glass/эпоксид', group: 'composite', kind: 'typical',
    density: 1900, E: 40 * G, E2: 8 * G, G12: 4 * G, nu: 0.25, ultTension: 1000 * M, ultCompression: 600 * M, shear: 40 * M, sources: [S.pc],
  },
  {
    id: 'aramid', name: 'Органопластик Kevlar/эпоксид', group: 'composite', kind: 'typical',
    density: 1400, E: 75 * G, E2: 6 * G, G12: 2 * G, nu: 0.34, ultTension: 1300 * M, ultCompression: 280 * M, shear: 60 * M,
    note: 'На сжатие держит в 4–5 раз хуже, чем на растяжение', sources: [S.pc],
  },
  // ---------- природные ----------
  {
    id: 'spruce', name: 'Ель ситхинская, 12 % влажности', group: 'natural', kind: 'typical',
    // Поперёк волокон: E_R/E_L = 0,078 и E_T/E_L = 0,043 — взято среднее; G_LR/E_L = 0,064 (Wood Handbook, табл. 5-1).
    density: 448, E: 11.9 * G, E2: 0.06 * 11.9 * G, G12: 0.064 * 11.9 * G, nu: 0.37, ultTension: 67 * M, ultCompression: 38.7 * M, shear: 7.9 * M,
    fatigue: { strength: 21 * M, cycles: 3e7, b: -0.05 },
    note: 'Чистая древесина без пороков, разброс 15–25 %',
    estimates: ['плотность (из удельного веса 0,40)', 'растяжение (сырая 59,3 МПа + 13 %)', 'усталость (30 % для чистой древесины в целом)', 'показатель Баскина'],
    sources: [S.wood],
  },
  {
    id: 'bamboo', name: 'Бамбук мосо', group: 'natural', kind: 'lab',
    density: 630, E: 10.56 * G, nu: 0.3, ultTension: 130 * M, ultCompression: 69.1 * M, shear: 8.65 * M,
    note: 'Растяжение стебля не измерено — взят предел при изгибе',
    estimates: ['растяжение', 'коэффициент Пуассона'], sources: [S.bamboo, S.bambooShear],
  },
  // ---------- волокна ----------
  {
    id: 'zylon', name: 'Волокно Zylon AS (PBO)', group: 'fibre', kind: 'typical',
    density: 1540, E: 180 * G, nu: 0.3, ultTension: 5800 * M, ultCompression: 469 * M, shear: 0,
    note: 'Без связующего волокно не держит сдвиг — балку из него не сделать', estimates: ['коэффициент Пуассона'], sources: [S.zylon],
  },
  {
    id: 'dyneema', name: 'Волокно Dyneema SK99', group: 'fibre', kind: 'typical',
    density: 970, E: 154 * G, nu: 0.3, ultTension: 4120 * M, ultCompression: 0, shear: 0,
    note: 'Без связующего не держит ни сжатие, ни сдвиг', estimates: ['коэффициент Пуассона'], sources: [S.dyneema],
  },
  {
    id: 't1100_fibre', name: 'Углеродное волокно T1100G', group: 'fibre', kind: 'typical',
    density: 1790, E: 324 * G, nu: 0.3, ultTension: 7000 * M, ultCompression: 0, shear: 0,
    note: 'Без связующего не держит ни сжатие, ни сдвиг', estimates: ['коэффициент Пуассона'], sources: [S.t1100],
  },
  // ---------- лабораторные и теоретические ----------
  {
    id: 'cnt_fibre', name: 'Волокно из нанотрубок (рекорд 2024)', group: 'lab', kind: 'lab',
    density: 1300, E: 629 * G, nu: 0.2, ultTension: 8200 * M, ultCompression: 416 * M, shear: 0,
    scale: 'Макроскопические нити; это реальный, но лабораторный материал',
    note: 'Без связующего не держит сдвиг. Прочность — Zhang 2024, модуль — Lee 2022, сжатие — Zu 2012',
    estimates: ['коэффициент Пуассона'], sources: [S.zhang2024, S.lee2022, S.zu2012, S.cntDensity],
  },
  {
    id: 'cnt_bundle', name: 'Пучок нанотрубок сантиметровой длины', group: 'lab', kind: 'lab',
    density: 1300, E: 1000 * G, nu: 0.2, ultTension: 43 * G, ultCompression: 43 * G, shear: 21.5 * G,
    scale: 'Сантиметровые пучки (Bai 2018); 80 ГПа на сечение трубок, 43 ГПа — «инженерная» прочность',
    note: 'Монолитной балки такой прочности не существует: это «что было бы, если»',
    estimates: ['плотность', 'модуль', 'коэффициент Пуассона', 'сжатие = растяжению', 'срез = половине растяжения'],
    sources: [S.bai2018, S.cntDensity],
  },
  {
    id: 'mwcnt', name: 'Нанотрубка, предел одиночной трубки', group: 'lab', kind: 'theory',
    density: 1300, E: 950 * G, nu: 0.2, ultTension: 63 * G, ultCompression: 63 * G, shear: 31.5 * G,
    scale: 'Нанометры, одиночные многостенные трубки (Yu 2000: 11–63 ГПа); взят верхний предел',
    note: 'Теоретический потолок: в балке метрового размера недостижим',
    estimates: ['плотность', 'коэффициент Пуассона', 'сжатие = растяжению', 'срез = половине растяжения'],
    sources: [S.yu2000, S.cntDensity],
  },
  {
    id: 'graphene', name: 'Графен, предел бездефектной решётки', group: 'lab', kind: 'theory',
    density: 2200, E: 1000 * G, nu: 0.17, ultTension: 130 * G, ultCompression: 130 * G, shear: 65 * G,
    scale: 'Микрометровая мембрана, один атомный слой (Lee 2008)',
    note: 'Теоретический потолок прочности вещества вообще',
    estimates: ['плотность (как у графита)', 'коэффициент Пуассона', 'сжатие = растяжению', 'срез = половине растяжения'],
    sources: [S.lee2008],
  },
  {
    id: 'vitreloy1', name: 'Металлическое стекло Vitreloy 1', group: 'lab', kind: 'lab',
    density: 6110, E: 101.3 * G, nu: 0.345, yield: 1765 * M, ultTension: 1765 * M, ultCompression: 2008 * M, shear: 970 * M,
    fatigue: { strength: 152 * M, cycles: 1e7, b: -0.08 },
    scale: 'Объёмные образцы миллиметры — сантиметры',
    note: 'Хрупкое: после предела текучести почти сразу разрушается',
    estimates: ['растяжение (= пределу текучести при сжатии)', 'срез', 'число циклов и показатель Баскина'],
    sources: [S.vit, S.vitC, S.vitF],
  },
];

export const MATERIALS: Record<string, Material> = Object.fromEntries(list.map((m) => [m.id, m]));

export function customMaterial(base: Partial<Material>): Material {
  return {
    id: 'custom', name: 'Свой материал', group: 'custom', kind: 'theory',
    density: 1600, E: 100 * G, nu: 0.3, ultTension: 1 * G, ultCompression: 1 * G, shear: 0.5 * G,
    sources: [], ...base,
  };
}
