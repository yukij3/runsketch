// Copy for the traces strip, EN and RU. Plain, literal labels; units translated per language.
import type { Lang } from './contract';
import type { RestKind } from './rest';

export type UnitKey = 'km' | 'mi' | '/km' | '/mi' | 'km/h' | 'mph' | 'm' | 'ft' | 'bpm' | 'spm' | 'rpm' | '%';

export interface TraceStrings {
  /** Number formatting language (decimal comma in Russian). */
  lang: Lang;
  groupLabel: string;
  keyboardHint: string;
  empty: string;
  computing: string;
  recomputing: string;
  legendDemand: string;
  legendResponse: string;
  /** The hatched fill between the demand and response lines. */
  legendLag: string;
  legendStops: string;
  legendTerrain: string;
  axisLabel: string;
  axisDistance: string;
  axisTime: string;
  clearPlayhead: string;
  cleared: string;
  /** Live text when Escape returns the playhead to its rest point. */
  rested: Record<RestKind, string>;
  stopped: string;
  avg: string;
  ascent: string;
  demand: string;
  panel: { elevation: string; pace: string; speed: string; hr: string; cadence: string };
  /** Heart-rate zone functions, by zone id. */
  zone: Record<1 | 2 | 3 | 4 | 5, string>;
  cell: {
    elapsed: string;
    distance: string;
    pace: string;
    speed: string;
    hr: string;
    grade: string;
    cadence: string;
    elevation: string;
    avgPace: string;
    avgSpeed: string;
    avgHr: string;
    avgCadence: string;
    ascent: string;
    elevationRange: string;
  };
  units: Record<UnitKey, string>;
}

const en: TraceStrings = {
  lang: 'en',
  groupLabel: 'Activity traces',
  keyboardHint:
    'Arrow keys move the playhead by 10 seconds, Shift with an arrow by 60 seconds. Home and End jump to the start and finish. Escape returns it to the top of the largest climb, or to peak heart rate on a flat route.',
  empty: 'Traces appear once the route has two points',
  computing: 'Computing traces…',
  recomputing: 'Recomputing…',
  legendDemand: 'Dashed — what the effort demands.',
  legendResponse: 'Solid — how the heart responds.',
  legendLag: 'Hatched — its lag behind demand.',
  legendStops: 'Ticks under the axis — stops.',
  legendTerrain: 'Shaded — climbing; dotted — descending.',
  axisLabel: 'Horizontal axis',
  axisDistance: 'Distance',
  axisTime: 'Time',
  clearPlayhead: 'Unpin',
  cleared: 'Playhead cleared',
  rested: { crest: 'Playhead back at the top of the largest climb', peak: 'Playhead back at peak heart rate' },
  stopped: 'Stopped',
  avg: 'avg',
  ascent: 'recorded ascent',
  demand: 'demand',
  panel: { elevation: 'Elevation', pace: 'Pace', speed: 'Speed', hr: 'Heart rate', cadence: 'Cadence' },
  zone: { 1: 'Recovery', 2: 'Endurance', 3: 'Tempo', 4: 'Threshold', 5: 'VO₂max' },
  cell: {
    elapsed: 'Elapsed',
    distance: 'Distance',
    pace: 'Pace',
    speed: 'Speed',
    hr: 'HR / demand',
    grade: 'Grade',
    cadence: 'Cadence',
    elevation: 'Elevation',
    avgPace: 'Avg pace',
    avgSpeed: 'Avg speed',
    avgHr: 'Avg HR / demand',
    avgCadence: 'Avg cadence',
    ascent: 'Recorded ascent',
    elevationRange: 'Recorded elevation',
  },
  units: {
    km: 'km',
    mi: 'mi',
    '/km': '/km',
    '/mi': '/mi',
    'km/h': 'km/h',
    mph: 'mph',
    m: 'm',
    ft: 'ft',
    bpm: 'bpm',
    spm: 'spm',
    rpm: 'rpm',
    '%': '%',
  },
};

const ru: TraceStrings = {
  lang: 'ru',
  groupLabel: 'Графики тренировки',
  keyboardHint:
    'Стрелки сдвигают указатель на 10 секунд, Shift со стрелкой — на 60 секунд. Home и End — к старту и финишу. Escape возвращает его на вершину самого большого подъёма, а на плоском маршруте — к пиковому пульсу.',
  empty: 'Графики появятся, когда на маршруте будет две точки',
  computing: 'Расчёт графиков…',
  recomputing: 'Пересчёт…',
  legendDemand: 'Пунктир — чего требует нагрузка.',
  legendResponse: 'Сплошная — как отвечает сердце.',
  legendLag: 'Штриховка — его отставание от нагрузки.',
  legendStops: 'Засечки под осью — остановки.',
  legendTerrain: 'Тень — подъём; точки — спуск.',
  axisLabel: 'Горизонтальная ось',
  axisDistance: 'Дистанция',
  axisTime: 'Время',
  clearPlayhead: 'Открепить',
  cleared: 'Указатель убран',
  rested: { crest: 'Указатель снова на вершине самого большого подъёма', peak: 'Указатель снова на пиковом пульсе' },
  stopped: 'Остановка',
  avg: 'сред.',
  ascent: 'набор в записи',
  demand: 'требуемый',
  panel: { elevation: 'Высота', pace: 'Темп', speed: 'Скорость', hr: 'Пульс', cadence: 'Каденс' },
  zone: { 1: 'Восстановл.', 2: 'Аэробная', 3: 'Темповая', 4: 'Пороговая', 5: 'МПК' },
  cell: {
    elapsed: 'Время',
    distance: 'Дистанция',
    pace: 'Темп',
    speed: 'Скорость',
    hr: 'Пульс / требуемый',
    grade: 'Уклон',
    cadence: 'Каденс',
    elevation: 'Высота',
    avgPace: 'Средний темп',
    avgSpeed: 'Средняя скорость',
    avgHr: 'Средний пульс / требуемый',
    avgCadence: 'Средний каденс',
    ascent: 'Набор в записи',
    elevationRange: 'Высота в записи',
  },
  units: {
    km: 'км',
    mi: 'ми',
    '/km': '/км',
    '/mi': '/ми',
    'km/h': 'км/ч',
    mph: 'миль/ч',
    m: 'м',
    ft: 'фт',
    bpm: 'уд/мин',
    spm: 'шаг/мин',
    rpm: 'об/мин',
    '%': '%',
  },
};

export const STRINGS: Record<Lang, TraceStrings> = { en, ru };

export function stringsFor(lang: Lang): TraceStrings {
  return STRINGS[lang] ?? en;
}

/** Translate a unit string produced by src/lib/format.ts (e.g. "km", "/mi"). */
export function unitText(s: TraceStrings, unit: string): string {
  return (s.units as Record<string, string>)[unit] ?? unit;
}
