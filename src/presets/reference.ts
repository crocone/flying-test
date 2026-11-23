// Эталонные значения для проверки (ТЗ, раздел 12, уровень 2). Источники — data/research.md.
export const KT = 0.514444; // узел, м/с
export const HP = 745.7; // л. с., Вт
export const FT = 0.3048;

export const REFERENCE = {
  // Прямой скорости сваливания в открытых данных нет (таблицы POH — сканы). Выводим из
  // сертификационной маневренной скорости: по определению V_A = V_S·√n, n = 3,8 (Normal),
  // V_A = 102 KCAS при 2550 lb (EASA TCDS IM.A.051).
  cessnaStallSpeed: {
    value: (102 / Math.sqrt(3.8)) * KT,
    what: 'Cessna 172S: V_S = V_A/√3,8 = 52,3 KCAS',
    source: 'https://www.easa.europa.eu/es/downloads/7423/en',
  },
  cessnaMaxSpeed: {
    value: 126 * KT,
    what: 'Cessna 172S: максимальная скорость у земли 126 kt',
    source: 'https://africair.com/wp-content/uploads/2016/03/172S-SD-Unit-11662-to-TBD-2015-Dec.pdf',
  },
  cessnaCruise: {
    altitude: 8500 * FT, speed: 124 * KT, power: 0.75 * 180 * HP,
    what: 'Cessna 172S: 75 % мощности, 8500 ft, 2550 lb — 124 kt',
    source: 'https://africair.com/wp-content/uploads/2016/03/172S-SD-Unit-11662-to-TBD-2015-Dec.pdf',
  },
  // Мощности висения R22 в открытых данных нет. Есть статический потолок висения вне
  // влияния земли при максимальной массе — 5000 ft: там потребная мощность равна взлётной,
  // 131 л. с. (двигатель дросселирован с 180 л. с. и до этой высоты её держит).
  r22Hover: {
    altitude: 5000 * FT, power: 131 * HP,
    what: 'R22: висение вне влияния земли на 5000 ft при 1370 lb требует взлётной мощности 131 л. с.',
    source: 'https://robinsonheli.com/r22-beta-ii-helicopter',
  },
  // SmartBird (Send et al., ICAS 2012): в горизонтальном полёте на 4,7 м/с — 18 Вт электрической
  // мощности, из них около 5 Вт — сервоприводы и электроника; на взмах остаётся около 13 Вт.
  // В модели сервоприводов нет, поэтому сравнивается с 13 Вт. На расчётном режиме (5 м/с) — 23 Вт.
  smartbird: {
    speed: 4.7, power: 13, powerWithServos: 18, powerDesign: 23,
    what: 'Festo SmartBird: горизонтальный полёт на 4,7 м/с — 18 Вт, без сервоприводов около 13 Вт',
    source: 'https://icas.org/ICAS_ARCHIVE/ICAS2012/PAPERS/053.PDF',
  },
  // Snowbird: пилот оценил мощность в 600–700 Вт на каждом рабочем ходе (CSM, через Википедию);
  // по другому сообщению — около 0,3 л. с. в среднем (AVweb). Измерений нет. В записи полёта
  // полная энергия и скорость понемногу падали — аппарат летел на пределе.
  snowbird: {
    speed: 7.11, strokePower: [600, 700], meanPower: 224,
    what: 'UTIAS Snowbird: 600–700 Вт на рабочем ходе, около 0,3 л. с. в среднем — оценки пилота, не измерения',
    source: 'https://en.wikipedia.org/wiki/UTIAS_Snowbird',
  },
  quadHover: {
    power: 81.3 / (28 / 60),
    what: 'DJI Phantom 4: 81,3 Вт·ч за 28 мин полёта — около 174 Вт электрической мощности',
    source: 'https://www.dji.com/support/product/phantom-4',
  },
};
