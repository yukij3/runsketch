// Example routes for the empty map and the toolbar menu, each with the session it is best simulated with.
import type { EffortPreset } from '../lib/sim';
import type { ActivityType, LngLat, SessionSettings, SnapProfile, StopsLevel, TargetSpec } from '../lib/types';
import type { Lang } from './i18n';

export interface ExampleRoute {
  id: string;
  name: Readonly<Record<Lang, string>>;
  profile: SnapProfile;
  /** Activity the example loads with. */
  activity: ActivityType;
  coords: LngLat[];
  /** Local clock time of the start ('HH:MM') and the zone offset in the usual season, minutes east of UTC. Absent: the start stays. */
  start?: { local: string; utcOffsetMin: number };
  /** Typical air temperature at the start, °C. Absent: the temperature stays. */
  temperatureC?: number;
  /** Target: an effort preset solved on the route, or guide times for the day in elapsed hours (see exampleTarget). */
  suggest: { effort: EffortPreset } | { elapsedH: readonly [low: number, high: number] };
  /** Mountain settings for the day; the rest take the activity's defaults. */
  mountain?: Partial<Pick<SessionSettings, 'acclimatisation' | 'packKg' | 'footwear' | 'crampons' | 'snow' | 'snowlineM'>>;
  /** Stop schedule; absent: the activity's default (mountain breaks on mountaineering days). */
  stops?: StopsLevel;
  /** Guide and operator elapsed hours for the day when the target is a preset (a check, not an input). */
  guideH?: readonly [low: number, high: number];
  /** Routed distance, km, and the highest point, m, as the menu lists them. */
  km: number;
  maxEleM: number;
}

/**
 * Montjuïc is a hilly run where heart rate visibly lags the climb. The mountain days start and end at OSM huts, camps,
 * passes and summits (checked 2026-09-13; every waypoint snaps within 163 m of the alpine route). Distances are the
 * routed geometry; elapsed hours are guide and operator times including breaks; temperatures are typical for the season.
 */
export const EXAMPLES: readonly ExampleRoute[] = [
  {
    // Plaça d'Espanya → Palau Nacional → Passeig Olímpic → castle → Miramar → Poble-sec → Plaça d'Espanya, ~130 m of
    // climbing. Points are the OSRM foot snap locations (checked 2026-09-12, all < 50 m).
    id: 'montjuic',
    name: { en: 'Montjuïc loop, Barcelona', ru: 'Круг по Монжуику, Барселона' },
    profile: 'foot',
    activity: 'run',
    suggest: { effort: 'steady' },
    km: 7.7,
    maxEleM: 184,
    coords: [
      [2.149677, 41.375102],
      [2.153217, 41.368806],
      [2.157483, 41.364711],
      [2.165936, 41.363325],
      [2.171142, 41.368209],
      [2.163243, 41.372612],
      [2.149677, 41.375102],
    ],
  },
  {
    // Garabashi station 3850 m → Pastukhov rocks → saddle → West summit, and back the same way; almost all of it on glacier.
    id: 'elbrus-south',
    name: { en: 'Elbrus, south route', ru: 'Эльбрус, южный маршрут' },
    profile: 'alpine',
    activity: 'alpine',
    start: { local: '02:30', utcOffsetMin: 180 },
    temperatureC: -8,
    suggest: { effort: 'steady' },
    guideH: [11, 16],
    mountain: { acclimatisation: 'full', packKg: 5, footwear: 'mountain-boots', crampons: true, snow: 'firm' },
    km: 15.2,
    maxEleM: 5642,
    coords: [
      [42.46021, 43.30423],
      [42.45868, 43.33107],
      [42.44731, 43.35041],
      [42.43784, 43.35241],
      [42.44731, 43.35041],
      [42.45868, 43.33107],
      [42.46021, 43.30423],
    ],
  },
  {
    // Betlemi hut 3650 m → summit (5054 m since the 2019 survey) → hut, over the Gergeti glacier.
    id: 'kazbek-betlemi',
    name: { en: 'Kazbek from Betlemi hut', ru: 'Казбек от Бетлемской хижины' },
    profile: 'alpine',
    activity: 'alpine',
    start: { local: '02:00', utcOffsetMin: 240 },
    temperatureC: -4,
    suggest: { effort: 'steady' },
    guideH: [12, 14],
    mountain: { acclimatisation: 'partial', packKg: 8, footwear: 'mountain-boots', crampons: true, snow: 'soft', snowlineM: 4300 },
    km: 12.5,
    maxEleM: 5054,
    coords: [
      [44.53383, 42.67988],
      [44.51811, 42.69694],
      [44.53383, 42.67988],
    ],
  },
  {
    // Goûter hut 3835 m → Dôme du Goûter → Vallot hut → summit → back.
    id: 'mont-blanc-gouter',
    name: { en: 'Mont Blanc, Goûter route', ru: 'Монблан, маршрут через Гуте' },
    profile: 'alpine',
    activity: 'alpine',
    start: { local: '02:00', utcOffsetMin: 120 },
    temperatureC: -6,
    suggest: { effort: 'steady' },
    guideH: [7, 10],
    mountain: { acclimatisation: 'partial', packKg: 6, footwear: 'mountain-boots', crampons: true, snow: 'firm' },
    km: 11.2,
    maxEleM: 4808,
    coords: [
      [6.8306, 45.85109],
      [6.84347, 45.84258],
      [6.85219, 45.83909],
      [6.86517, 45.83271],
      [6.85219, 45.83909],
      [6.84347, 45.84258],
      [6.8306, 45.85109],
    ],
  },
  {
    // Barafu camp 4673 m → Stella Point → Uhuru Peak → Stella Point → Barafu → Mweka camp 3100 m: a walk-up on scree.
    id: 'kilimanjaro-summit-night',
    name: { en: 'Kilimanjaro summit night', ru: 'Килиманджаро, ночное восхождение' },
    profile: 'alpine',
    activity: 'alpine',
    start: { local: '23:30', utcOffsetMin: 180 },
    temperatureC: -5,
    suggest: { effort: 'steady' },
    guideH: [12, 15],
    mountain: { acclimatisation: 'partial', packKg: 5, footwear: 'mountain-boots', crampons: false, snowlineM: 6000 },
    km: 16.1,
    maxEleM: 5895,
    coords: [
      [37.37858, -3.09987],
      [37.36262, -3.07823],
      [37.354, -3.07641],
      [37.36262, -3.07823],
      [37.37858, -3.09987],
      [37.36709, -3.15695],
    ],
  },
  {
    // Cólera camp 5950 m → Independencia hut → La Cueva at the foot of the Canaleta → summit → back.
    id: 'aconcagua-normal',
    name: { en: 'Aconcagua, normal route', ru: 'Аконкагуа, классический маршрут' },
    profile: 'alpine',
    activity: 'alpine',
    start: { local: '03:00', utcOffsetMin: -180 },
    temperatureC: -15,
    suggest: { effort: 'steady' },
    guideH: [11, 14],
    mountain: { acclimatisation: 'partial', packKg: 5, footwear: 'double-boots', crampons: true, snow: 'firm', snowlineM: 6300 },
    km: 5.4,
    maxEleM: 6961,
    coords: [
      [-70.0183, -32.63736],
      [-70.01557, -32.64619],
      [-70.01615, -32.6535],
      [-70.01196, -32.65315],
      [-70.01615, -32.6535],
      [-70.01557, -32.64619],
      [-70.0183, -32.63736],
    ],
  },
  {
    // Lobuche 4940 m → Gorak Shep → Everest base camp monument 5364 m → Gorak Shep; the last stretch is a glacier path.
    id: 'ebc-lobuche',
    name: { en: 'Everest base camp from Lobuche', ru: 'Базовый лагерь Эвереста из Лобуче' },
    profile: 'hiking',
    activity: 'hike',
    start: { local: '07:00', utcOffsetMin: 345 },
    temperatureC: 2,
    stops: 'alpine',
    suggest: { elapsedH: [5, 7.5] },
    // Trekkers reach Lobuche after a week of walking up the valley, so they are part-acclimatised.
    mountain: { acclimatisation: 'partial' },
    km: 10.7,
    maxEleM: 5364,
    coords: [
      [86.81017, 27.9481],
      [86.82893, 27.98068],
      [86.84725, 27.99738],
      [86.82893, 27.98068],
    ],
  },
  {
    // Thorong Phedi 4540 m → High Camp → Thorong La 5416 m → Muktinath, the long day of the Annapurna circuit.
    id: 'thorong-la',
    name: { en: 'Thorong La crossing', ru: 'Перевал Торонг-Ла' },
    profile: 'hiking',
    activity: 'hike',
    start: { local: '04:30', utcOffsetMin: 345 },
    temperatureC: -5,
    stops: 'alpine',
    suggest: { elapsedH: [7, 9] },
    // The pass comes about ten days into the circuit, with nights spent at 3500–4500 m.
    mountain: { acclimatisation: 'partial' },
    km: 14.7,
    maxEleM: 5416,
    coords: [
      [83.97264, 28.77678],
      [83.96749, 28.78293],
      [83.93876, 28.79353],
      [83.8639, 28.816],
    ],
  },
];

/** Guide times include breaks; about a fifth of a guided mountain day is spent stopped. */
export const EXAMPLE_BREAK_SHARE = 0.2;

/** Moving time for guide elapsed hours: the middle of the range less breaks, to five minutes. */
export function exampleTarget(elapsedH: readonly [number, number]): TargetSpec {
  const moving = ((elapsedH[0] + elapsedH[1]) / 2) * 3600 * (1 - EXAMPLE_BREAK_SHARE);
  return { kind: 'duration', seconds: Math.round(moving / 300) * 300 };
}

/** The latest start at the example's local clock time that is not after `reference` (epoch ms). */
export function exampleStart(start: NonNullable<ExampleRoute['start']>, reference: number): Pick<SessionSettings, 'startTime' | 'utcOffsetMin'> {
  const [hours, minutes] = start.local.split(':').map(Number);
  const offsetMs = start.utcOffsetMin * 60_000;
  const local = new Date(reference + offsetMs);
  let startTime = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hours, minutes) - offsetMs;
  if (startTime > reference) startTime -= 86_400_000;
  return { startTime, utcOffsetMin: start.utcOffsetMin };
}
