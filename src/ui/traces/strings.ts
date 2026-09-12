// Copy for the traces strip, EN and RU. Plain, literal labels; units translated per language.
import type { Lang } from './contract';

export type UnitKey = 'km' | 'mi' | '/km' | '/mi' | 'km/h' | 'mph' | 'm' | 'ft' | 'bpm' | 'spm' | 'rpm' | '%';

export interface TraceStrings {
  groupLabel: string;
  keyboardHint: string;
  empty: string;
  computing: string;
  recomputing: string;
  legendDemand: string;
  legendResponse: string;
  legendStops: string;
  axisLabel: string;
  axisDistance: string;
  axisTime: string;
  clearPlayhead: string;
  cleared: string;
  stopped: string;
  avg: string;
  ascent: string;
  demand: string;
  panel: { elevation: string; pace: string; speed: string; hr: string; cadence: string };
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
  groupLabel: 'Activity traces',
  keyboardHint:
    'Arrow keys move the playhead by 10 seconds, Shift with an arrow by 60 seconds. Home and End jump to the start and finish. Escape clears it.',
  empty: 'Traces appear once the route has two points',
  computing: 'Computing traces…',
  recomputing: 'Recomputing…',
  legendDemand: 'Dashed — what the effort demands.',
  legendResponse: 'Solid — how the heart responds, with its lag.',
  legendStops: 'Ticks under the axis — stops.',
  axisLabel: 'Horizontal axis',
  axisDistance: 'Distance',
  axisTime: 'Time',
  clearPlayhead: 'Clear playhead',
  cleared: 'Playhead cleared',
  stopped: 'Stopped',
  avg: 'avg',
  ascent: 'ascent',
  demand: 'demand',
  panel: { elevation: 'Elevation', pace: 'Pace', speed: 'Speed', hr: 'Heart rate', cadence: 'Cadence' },
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
    ascent: 'Ascent',
    elevationRange: 'Elevation',
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
  groupLabel: 'Графики тренировки',
  keyboardHint:
    'Стрелки сдвигают указатель на 10 секунд, Shift со стрелкой — на 60 секунд. Home и End — к старту и финишу. Escape убирает указатель.',
  empty: 'Графики появятся, когда на маршруте будет две точки',
  computing: 'Расчёт графиков…',
  recomputing: 'Пересчёт…',
  legendDemand: 'Пунктир — чего требует нагрузка.',
  legendResponse: 'Сплошная — как отвечает сердце, с запаздыванием.',
  legendStops: 'Засечки под осью — остановки.',
  axisLabel: 'Горизонтальная ось',
  axisDistance: 'Дистанция',
  axisTime: 'Время',
  clearPlayhead: 'Убрать указатель',
  cleared: 'Указатель убран',
  stopped: 'Остановка',
  avg: 'сред.',
  ascent: 'набор',
  demand: 'требуемый',
  panel: { elevation: 'Высота', pace: 'Темп', speed: 'Скорость', hr: 'Пульс', cadence: 'Каденс' },
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
    ascent: 'Набор',
    elevationRange: 'Высота',
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
