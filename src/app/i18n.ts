// UI strings (English, Russian). Every user-facing string goes through translate().
import type { ActivityType } from '../lib/types';
import type { Lang } from '../ui/traces/contract';

export type { Lang };

const en = {
  docTitle: 'Runsketch — realistic activity files from a drawn route',
  appTagline: 'Draw a route, get a FIT, TCX or GPX file whose heart rate answers the hills.',
  language: 'Language',
  units: 'Units',
  sourceCode: 'GitHub',

  mapLabel: 'Route map. Click to add a waypoint.',
  toolbarLabel: 'Route tools',
  searchLabel: 'Search places',
  searchPlaceholder: 'Search a place',
  searching: 'Searching…',
  searchEmpty: 'No places found',
  searchFailed: 'Search is unavailable right now',
  profileLabel: 'Routing profile',
  profile_foot: 'Road/path',
  profile_hiking: 'Trail',
  profile_bike: 'Bike',
  'profile_road-bike': 'Road bike',
  profile_mtb: 'MTB',
  profile_none: 'Straight',
  undo: 'Undo',
  redo: 'Redo',
  closeLoop: 'Close loop',
  outAndBack: 'Out-and-back',
  reverse: 'Reverse',
  importRoute: 'Import GPX/TCX',
  clearRoute: 'Clear route',
  clearConfirm: 'Clear all waypoints?',
  clearYes: 'Clear',
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  importFailed: 'Could not import {file}. {message}',
  imported: 'Imported {file} as {count} waypoints joined by straight legs, so the recorded shape stays as it was.',

  emptyTitle: 'Draw a route',
  emptyBody:
    'Click the map to set the start, then click again for each waypoint. Legs follow paths for the routing profile in the toolbar; drag a point to move it.',
  loadExample: 'Load example route',
  exampleHint: 'A hilly 7.7 km loop over Montjuïc, Barcelona. Watch heart rate lag behind the climb.',
  webglTitle: 'The map could not start',
  webglBody:
    'The map needs WebGL 2, which this browser has turned off or does not support. You can still import a GPX or TCX route from the toolbar, or open Runsketch in another browser.',
  styleFailed: 'Map tiles could not load. Check the connection; routing and export still work.',
  wpStart: 'Start',
  wpFinish: 'Finish',
  wpN: 'Waypoint {n}',
  fixMap: 'Fix the map',
  mapCanvas: 'Map',
  toggleAttribution: 'Toggle attribution',

  statusRouting: 'Routing {done}/{total}…',
  statusElevation: 'Sampling elevation…',
  statusSimulating: 'Simulating…',
  statusElevationFailed: 'Elevation lookup failed.',
  statusSimFailed: 'The simulation failed: {message}',
  retry: 'Retry',
  playhead: 'Playhead',
  hrDemand: 'demand',

  sectionRoute: 'Route',
  distance: 'Distance',
  ascentDescent: 'Ascent / descent',
  elevationRange: 'Elevation min / max',
  legs: 'Legs',
  legsNone: 'No legs yet',
  elevationSource: 'Elevation source',
  src_mapterhorn: 'Mapterhorn DEM',
  'src_aws-terrarium': 'AWS Terrain Tiles',
  'src_open-meteo': 'Open-Meteo',
  src_none: 'Unavailable, profile is flat',
  waypoints: 'Waypoints',
  noWaypoints: 'None yet. Click the map to set the start.',
  removeWaypoint: 'Remove {name}',
  copyLink: 'Copy share link',
  linkCopied: 'Link copied',
  linkCopyFailed: 'Could not copy. The link is in the address bar.',
  retryRouting: 'Retry routing',
  straightFallbackHint: 'No path found, so these legs are drawn as straight lines.',

  sectionAthlete: 'Athlete',
  age: 'Age',
  sex: 'Sex',
  sex_male: 'Male',
  sex_female: 'Female',
  weight: 'Weight',
  height: 'Height',
  restHr: 'Resting HR',
  maxHr: 'Max HR',
  maxHrAuto: 'auto from age',
  maxHrUseAuto: 'Use age estimate',
  fitness: 'Fitness',
  fitness_beginner: 'Beginner',
  fitness_recreational: 'Recreational',
  fitness_trained: 'Trained',
  fitness_elite: 'Elite',
  hrSensor: 'HR sensor',
  sensor_strap: 'Chest strap',
  sensor_optical: 'Wrist optical',

  sectionSession: 'Session',
  activity: 'Activity',
  activity_run: 'Run',
  activity_ride: 'Ride',
  activity_walk: 'Walk',
  activity_hike: 'Hike',
  name: 'Name',
  start: 'Start',
  target: 'Target',
  targetKind: 'Target type',
  target_pace: 'Pace',
  target_speed: 'Average speed',
  target_duration: 'Finish time',
  invalidPace: 'Use m:ss, for example 5:30',
  invalidDuration: 'Use h:mm:ss, for example 1:05:00',
  invalidSpeed: 'Enter a speed, for example 25',
  invalidNumber: 'Enter a number from {min} to {max}',
  invalidDate: 'Enter a date and time',
  pacing: 'Pacing',
  pacing_even: 'Even',
  pacing_negative: 'Negative',
  pacing_positive: 'Positive',
  variability: 'Variability',
  variability_steady: 'steady',
  variability_natural: 'natural',
  variability_uneven: 'uneven',
  stops: 'Stops',
  stops_none: 'None',
  stops_few: 'A few',
  stops_urban: 'Urban',
  gpsNoise: 'GPS noise',
  gps_off: 'Off',
  gps_low: 'Low',
  gps_normal: 'Normal',
  gps_high: 'High',
  temperature: 'Temperature',
  seed: 'Seed',
  newSeed: 'New seed',
  laps: 'Laps',
  lapsAuto: 'Auto, every 1 {unit}',
  description: 'Description',
  optional: 'Optional',

  sectionResult: 'Result',
  movingTime: 'Moving time',
  elapsedTime: 'Elapsed time',
  avgPace: 'Average pace',
  avgSpeed: 'Average speed',
  avgHr: 'Average HR',
  peakHr: 'Max HR',
  avgCadence: 'Average cadence',
  avgPower: 'Average power',
  calories: 'Calories',
  resultEmpty: 'Add at least two waypoints to simulate the session.',
  resultPending: 'Computing…',
  modelNotes: 'Model notes',

  sectionSplits: 'Splits',
  splitsCaption: 'Splits per {unit}',
  col_lap: '#',
  col_pace: 'Pace',
  col_speed: 'Speed',
  col_hr: 'HR',
  col_elev: 'Elev ±',
  splitsEmpty: 'Splits appear once the session is simulated.',

  sectionAbout: 'About & credits',
  aboutModelTitle: 'The model',
  aboutModel:
    'Terrain sets the load: the route is resampled every 5 m on an open elevation model, smoothed, and turned into grade. Speed follows grade through an effort-equivalent pace factor, and the energy cost of running uphill and downhill comes from Minetti et al. (2002); rides solve a cycling power balance instead. That cost becomes oxygen demand, and demand becomes a heart-rate target because the fraction of heart-rate reserve tracks the fraction of VO₂ reserve (Swain & Leutholtz 1997). Recorded heart rate chases that target through two first-order lags that rise faster than they recover, with a slow component above threshold and cardiac drift that grows with time and heat. Pace, heart rate, cadence, power and GPS all come from this one seeded run, so the preview is the file.',
  aboutDataTitle: 'Data and software',
  credit_osm: 'Map data',
  credit_tiles: 'Map tiles',
  credit_dem: 'Elevation and hillshade',
  credit_demFallback: 'Fallback elevation',
  credit_routing: 'Routing',
  credit_search: 'Place search',
  credit_renderer: 'Map renderer',
  credit_fit: 'FIT encoder',
  aboutPrivacy:
    'Everything is computed in your browser. Waypoints go only to the public routing, search and elevation services listed above. There is no account, no tracking and no server of ours.',
  aboutLicense: 'Runsketch is free software under the MIT license.',
  aboutSource: 'Source code',

  exportLabel: 'Export',
  exportAs: 'Download {format} file',
  exportUnavailable: 'Export unlocks once the session is simulated.',
  exportBusy: 'Updating the simulation…',
  exportFailed: 'Export failed: {message}',
  exportSaved: 'Saved {file}',

  unit_km: 'km',
  unit_mi: 'mi',
  unit_m: 'm',
  unit_ft: 'ft',
  unit_kmh: 'km/h',
  unit_mph: 'mph',
  unit_perKm: '/km',
  unit_perMi: '/mi',
  unit_bpm: 'bpm',
  unit_spm: 'spm',
  unit_rpm: 'rpm',
  unit_w: 'W',
  unit_kcal: 'kcal',
  unit_kg: 'kg',
  unit_lb: 'lb',
  unit_cm: 'cm',
  unit_in: 'in',
  unit_c: '°C',
  unit_f: '°F',
  unit_pct: '%',
};

export type MessageKey = keyof typeof en;

const ru: Record<MessageKey, string> = {
  docTitle: 'Runsketch — правдоподобные файлы тренировок по нарисованному маршруту',
  appTagline: 'Нарисуйте маршрут и получите файл FIT, TCX или GPX, где пульс отзывается на подъёмы.',
  language: 'Язык',
  units: 'Единицы',
  sourceCode: 'GitHub',

  mapLabel: 'Карта маршрута. Щелчок добавляет точку.',
  toolbarLabel: 'Инструменты маршрута',
  searchLabel: 'Поиск места',
  searchPlaceholder: 'Найти место',
  searching: 'Ищу…',
  searchEmpty: 'Ничего не найдено',
  searchFailed: 'Поиск сейчас недоступен',
  profileLabel: 'Профиль прокладки',
  profile_foot: 'Дороги и дорожки',
  profile_hiking: 'Тропы',
  profile_bike: 'Велосипед',
  'profile_road-bike': 'Шоссейный велосипед',
  profile_mtb: 'Горный велосипед',
  profile_none: 'По прямой',
  undo: 'Отменить',
  redo: 'Повторить',
  closeLoop: 'Замкнуть круг',
  outAndBack: 'Туда и обратно',
  reverse: 'Развернуть маршрут',
  importRoute: 'Импорт GPX/TCX',
  clearRoute: 'Очистить маршрут',
  clearConfirm: 'Удалить все точки?',
  clearYes: 'Удалить',
  cancel: 'Отмена',
  dismiss: 'Закрыть',
  importFailed: 'Не удалось импортировать {file}. {message}',
  imported: 'Файл {file} превращён в точки маршрута ({count}), соединённые прямыми, чтобы форма трека не изменилась.',

  emptyTitle: 'Нарисуйте маршрут',
  emptyBody:
    'Щёлкните по карте, чтобы поставить старт, и добавляйте точки следующими щелчками. Участки между точками идут по дорогам выбранного на панели профиля; любую точку можно перетащить.',
  loadExample: 'Загрузить пример',
  exampleHint: 'Холмистый круг 7,7 км по Монжуику в Барселоне. Видно, как пульс отстаёт от подъёма.',
  webglTitle: 'Карта не запустилась',
  webglBody:
    'Карте нужен WebGL 2, а в этом браузере он выключен или не поддерживается. Маршрут всё равно можно импортировать из GPX или TCX через панель инструментов — или откройте Runsketch в другом браузере.',
  styleFailed: 'Не удалось загрузить карту. Проверьте подключение: прокладка и экспорт по-прежнему работают.',
  wpStart: 'Старт',
  wpFinish: 'Финиш',
  wpN: 'Точка {n}',
  fixMap: 'Исправить карту',
  mapCanvas: 'Карта',
  toggleAttribution: 'Показать или скрыть источники',

  statusRouting: 'Прокладываю участки: {done} из {total}…',
  statusElevation: 'Считываю высоты…',
  statusSimulating: 'Моделирую…',
  statusElevationFailed: 'Не удалось получить высоты.',
  statusSimFailed: 'Моделирование не удалось: {message}',
  retry: 'Повторить',
  playhead: 'Курсор',
  hrDemand: 'потребность',

  sectionRoute: 'Маршрут',
  distance: 'Дистанция',
  ascentDescent: 'Подъём / спуск',
  elevationRange: 'Высота мин. / макс.',
  legs: 'Участки',
  legsNone: 'Участков пока нет',
  elevationSource: 'Источник высот',
  src_mapterhorn: 'Mapterhorn (ЦМР)',
  'src_aws-terrarium': 'AWS Terrain Tiles',
  'src_open-meteo': 'Open-Meteo',
  src_none: 'Нет данных, профиль плоский',
  waypoints: 'Точки',
  noWaypoints: 'Пока нет. Щёлкните по карте, чтобы поставить старт.',
  removeWaypoint: 'Удалить: {name}',
  copyLink: 'Скопировать ссылку',
  linkCopied: 'Ссылка скопирована',
  linkCopyFailed: 'Не удалось скопировать. Ссылка есть в адресной строке.',
  retryRouting: 'Проложить заново',
  straightFallbackHint: 'Путь не найден, поэтому эти участки проведены по прямой.',

  sectionAthlete: 'Спортсмен',
  age: 'Возраст',
  sex: 'Пол',
  sex_male: 'Мужской',
  sex_female: 'Женский',
  weight: 'Вес',
  height: 'Рост',
  restHr: 'Пульс покоя',
  maxHr: 'Макс. пульс',
  maxHrAuto: 'по возрасту',
  maxHrUseAuto: 'Рассчитать по возрасту',
  fitness: 'Подготовка',
  fitness_beginner: 'Новичок',
  fitness_recreational: 'Любитель',
  fitness_trained: 'Тренированный',
  fitness_elite: 'Элита',
  hrSensor: 'Датчик пульса',
  sensor_strap: 'Нагрудный',
  sensor_optical: 'На запястье',

  sectionSession: 'Тренировка',
  activity: 'Вид',
  activity_run: 'Бег',
  activity_ride: 'Велосипед',
  activity_walk: 'Ходьба',
  activity_hike: 'Поход',
  name: 'Название',
  start: 'Начало',
  target: 'Цель',
  targetKind: 'Тип цели',
  target_pace: 'Темп',
  target_speed: 'Средняя скорость',
  target_duration: 'Время на дистанцию',
  invalidPace: 'Формат м:сс, например 5:30',
  invalidDuration: 'Формат ч:мм:сс, например 1:05:00',
  invalidSpeed: 'Введите скорость, например 25',
  invalidNumber: 'Введите число от {min} до {max}',
  invalidDate: 'Укажите дату и время',
  pacing: 'Раскладка',
  pacing_even: 'Ровная',
  pacing_negative: 'Негативная',
  pacing_positive: 'Позитивная',
  variability: 'Вариативность',
  variability_steady: 'ровно',
  variability_natural: 'естественно',
  variability_uneven: 'рвано',
  stops: 'Остановки',
  stops_none: 'Нет',
  stops_few: 'Редкие',
  stops_urban: 'Городские',
  gpsNoise: 'Шум GPS',
  gps_off: 'Нет',
  gps_low: 'Слабый',
  gps_normal: 'Обычный',
  gps_high: 'Сильный',
  temperature: 'Температура',
  seed: 'Сид',
  newSeed: 'Новый сид',
  laps: 'Круги',
  lapsAuto: 'Авто, каждый 1 {unit}',
  description: 'Описание',
  optional: 'Необязательно',

  sectionResult: 'Результат',
  movingTime: 'Время в движении',
  elapsedTime: 'Общее время',
  avgPace: 'Средний темп',
  avgSpeed: 'Средняя скорость',
  avgHr: 'Средний пульс',
  peakHr: 'Макс. пульс',
  avgCadence: 'Средний каденс',
  avgPower: 'Средняя мощность',
  calories: 'Калории',
  resultEmpty: 'Добавьте хотя бы две точки, чтобы смоделировать тренировку.',
  resultPending: 'Считаю…',
  modelNotes: 'Замечания модели',

  sectionSplits: 'Отрезки',
  splitsCaption: 'Отрезки по 1 {unit}',
  col_lap: '№',
  col_pace: 'Темп',
  col_speed: 'Скорость',
  col_hr: 'Пульс',
  col_elev: 'Высота ±',
  splitsEmpty: 'Отрезки появятся после моделирования.',

  sectionAbout: 'О проекте и данных',
  aboutModelTitle: 'Модель',
  aboutModel:
    'Нагрузку задаёт рельеф: маршрут через каждые 5 м сверяется с открытой цифровой моделью высот, сглаживается и превращается в уклон. Скорость зависит от уклона через коэффициент равного усилия, а энергозатраты бега в гору и под гору взяты из работы Minetti и соавторов (2002); для велосипеда решается баланс мощности. Энергозатраты превращаются в потребность в кислороде, а она — в целевой пульс: доля резерва пульса следует за долей резерва VO₂ (Swain и Leutholtz, 1997). Записанный пульс догоняет эту цель через два инерционных звена первого порядка — разгоняется быстрее, чем восстанавливается, — с медленной компонентой выше порога и кардиодрейфом, который растёт со временем и в жару. Темп, пульс, каденс, мощность и GPS получаются из одного прогона с фиксированным сидом, поэтому предпросмотр и есть файл.',
  aboutDataTitle: 'Данные и программы',
  credit_osm: 'Картографические данные',
  credit_tiles: 'Тайлы карты',
  credit_dem: 'Высоты и отмывка рельефа',
  credit_demFallback: 'Резервные высоты',
  credit_routing: 'Прокладка маршрута',
  credit_search: 'Поиск мест',
  credit_renderer: 'Отрисовка карты',
  credit_fit: 'Запись FIT',
  aboutPrivacy:
    'Всё считается в вашем браузере. Координаты точек уходят только в перечисленные выше открытые сервисы прокладки, поиска и высот. Ни аккаунтов, ни трекеров, ни собственного сервера.',
  aboutLicense: 'Runsketch — свободная программа под лицензией MIT.',
  aboutSource: 'Исходный код',

  exportLabel: 'Экспорт',
  exportAs: 'Скачать файл {format}',
  exportUnavailable: 'Экспорт станет доступен после моделирования.',
  exportBusy: 'Обновляю модель…',
  exportFailed: 'Экспорт не удался: {message}',
  exportSaved: 'Сохранено: {file}',

  unit_km: 'км',
  unit_mi: 'ми',
  unit_m: 'м',
  unit_ft: 'фт',
  unit_kmh: 'км/ч',
  unit_mph: 'ми/ч',
  unit_perKm: '/км',
  unit_perMi: '/ми',
  unit_bpm: 'уд/мин',
  unit_spm: 'шаг/мин',
  unit_rpm: 'об/мин',
  unit_w: 'Вт',
  unit_kcal: 'ккал',
  unit_kg: 'кг',
  unit_lb: 'фунт',
  unit_cm: 'см',
  unit_in: 'дюйм',
  unit_c: '°C',
  unit_f: '°F',
  unit_pct: '%',
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, ru };

export type Params = Record<string, string | number>;

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const template = MESSAGES[lang]?.[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export type Translate = (key: MessageKey, params?: Params) => string;

export function detectLang(language: string | undefined): Lang {
  return language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** Russian plural category: 1 участок, 2 участка, 5 участков. */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export interface LegCounts {
  routed: number;
  straight: number;
  fallback: number;
  pending: number;
}

/** "4 legs follow paths · 1 straight" / "4 участка по дорогам · 1 по прямой". */
export function legsSummary(lang: Lang, c: LegCounts): string {
  const parts: string[] = [];
  const straight = c.straight + c.fallback;
  if (lang === 'ru') {
    if (c.routed) parts.push(`${c.routed} ${ruPlural(c.routed, 'участок', 'участка', 'участков')} по дорогам`);
    if (straight) parts.push(`${straight} по прямой`);
    if (c.pending) parts.push(`${c.pending} в работе`);
  } else {
    if (c.routed) parts.push(`${c.routed} ${c.routed === 1 ? 'leg follows' : 'legs follow'} paths`);
    if (straight) parts.push(`${straight} straight`);
    if (c.pending) parts.push(`${c.pending} routing`);
  }
  return parts.length ? parts.join(' · ') : translate(lang, 'legsNone');
}

type DayPart = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night';

function dayPart(hour: number): DayPart {
  if (hour < 5) return 'night';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'lunch';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

const EN_PART: Record<DayPart, string> = {
  morning: 'Morning',
  lunch: 'Lunch',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};
const EN_NOUN: Record<ActivityType, string> = { run: 'run', ride: 'ride', walk: 'walk', hike: 'hike' };

// Adjective agrees with the noun's gender: пробежка/прогулка (f), заезд/поход (m).
const RU_PART: Record<DayPart, [feminine: string, masculine: string]> = {
  morning: ['Утренняя', 'Утренний'],
  lunch: ['Дневная', 'Дневной'],
  afternoon: ['Дневная', 'Дневной'],
  evening: ['Вечерняя', 'Вечерний'],
  night: ['Ночная', 'Ночной'],
};
const RU_NOUN: Record<ActivityType, [noun: string, feminine: boolean]> = {
  run: ['пробежка', true],
  ride: ['заезд', false],
  walk: ['прогулка', true],
  hike: ['поход', false],
};

/** "Morning run" / "Утренняя пробежка" from the local start hour. */
export function defaultActivityName(lang: Lang, type: ActivityType, hour: number): string {
  const part = dayPart(hour);
  if (lang === 'ru') {
    const [noun, feminine] = RU_NOUN[type];
    return `${RU_PART[part][feminine ? 0 : 1]} ${noun}`;
  }
  return `${EN_PART[part]} ${EN_NOUN[type]}`;
}
