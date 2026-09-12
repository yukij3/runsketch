// simulate() reports warnings in English. Known sentences get a Russian rendering; unknown ones pass through.
import type { Lang } from './i18n';

type Rule = [pattern: RegExp, render: (m: RegExpExecArray) => string];

const REASONS: Record<string, string> = {
  'corner speed limits and the maximum plausible speed on this route cap how fast it can be covered':
    'ограничения скорости в поворотах и предельная правдоподобная скорость не позволяют пройти маршрут быстрее',
  'the slowest plausible moving speed still covers the route sooner': 'даже самая медленная правдоподобная скорость проходит маршрут быстрее',
  'moving time jumps between two nearly equal efforts on this route (a gait change or a stop)':
    'время в движении скачком меняется между двумя почти равными усилиями (смена бега на шаг или остановка)',
  'accelerating from a standing start takes up most of this short route': 'разгон с места занимает бо́льшую часть этого короткого маршрута',
};

function localizeReason(reason: string): string {
  const power = /^the maximum plausible power \((\d+) W\) and speed cap how fast this route can be ridden$/.exec(reason);
  if (power) return `предельная правдоподобная мощность (${power[1]} Вт) и скорость не позволяют проехать маршрут быстрее`;
  return REASONS[reason] ?? reason;
}

const RU_RULES: Rule[] = [
  [
    /^The target was missing or not positive, so a default average pace of (.+) was used\.$/,
    (m) => `Цель не задана или не больше нуля, поэтому взят средний темп по умолчанию: ${m[1]}.`,
  ],
  [/^The route has fewer than two distinct points, so there is nothing to simulate\.$/, () => 'В маршруте меньше двух разных точек — моделировать нечего.'],
  [
    /^The route is only (\d+) m long, so the activity lasts just a few seconds\.$/,
    (m) => `Маршрут длиной всего ${m[1]} м, тренировка продлится несколько секунд.`,
  ],
  [
    /^The target moving time is longer than (.+), so (.+) was used\.$/,
    (m) => `Целевое время в движении больше ${m[1]}, поэтому взято ${m[2]}.`,
  ],
  [/^Grades steeper than (\d+) % were treated as (\d+) %\.$/, (m) => `Уклоны круче ${m[1]} % учтены как ${m[2]} %.`],
  [
    /^The simulation was cut off after (.+); the route is too long for the chosen target\.$/,
    (m) => `Моделирование остановлено на отметке ${m[1]}: маршрут слишком длинный для выбранной цели.`,
  ],
  [
    /^The target moving time of (.+) could not be matched: (.+), so the moving time is (.+)\.$/,
    (m) => `Не удалось попасть в целевое время в движении ${m[1]}: ${localizeReason(m[2])}. Итоговое время в движении — ${m[3]}.`,
  ],
  [
    /^The target needs about (\d+) W on flat road \(([\d.]+) W\/kg, (\d+) % of VO2 reserve\), more than this athlete can sustain; heart rate stays pinned near maximum\.$/,
    (m) =>
      `Для этой цели нужно около ${m[1]} Вт на ровной дороге (${m[2]} Вт/кг, ${m[3]} % резерва VO2) — больше, чем спортсмен способен держать; пульс упирается в максимум.`,
  ],
  [
    /^Some climbs are too steep for the planned power, so the rider crawls at 3\.6 km\/h for about (.+)\.$/,
    (m) => `Некоторые подъёмы слишком круты для заданной мощности: около ${m[1]} велосипедист ползёт со скоростью 3,6 км/ч.`,
  ],
  [
    /^On flat ground this target means (.+), about (\d+) % of this athlete's VO2 reserve, which is not sustainable; heart rate stays pinned near maximum\.$/,
    (m) => `На ровном месте эта цель означает ${m[1]}, около ${m[2]} % резерва VO2 спортсмена, — долго так не продержаться; пульс упирается в максимум.`,
  ],
  [
    /^A flat walking speed of (.+) is running speed; the walking model is stretched beyond its data\.$/,
    (m) => `Скорость ходьбы ${m[1]} по ровному — это уже бег; модель ходьбы работает за пределами своих данных.`,
  ],
  [
    /^Running speed fell below 1\.9 m\/s on climbs of 6 % or steeper, so (\d+) m were power-hiked with a walking gait and cadence\.$/,
    (m) => `На подъёмах от 6 % скорость бега падала ниже 1,9 м/с, поэтому ${m[1]} м пройдены быстрым шагом.`,
  ],
  [
    /^Effort averages about (\d+) % of VO2 reserve for (.+), more than this athlete can sustain for that long, so heart rate sits near maximum\.$/,
    (m) =>
      `Нагрузка в среднем около ${m[1]} % резерва VO2 в течение ${m[2]} — дольше, чем спортсмен способен её держать, поэтому пульс держится у максимума.`,
  ],
  [
    /^The target average speed is slower than this route's descents allow at an easy effort, so the rider brakes to about (\d+) km\/h on descents\.$/,
    (m) => `Целевая средняя скорость ниже, чем позволяют спуски даже при лёгком усилии, поэтому на спусках велосипедист притормаживает примерно до ${m[1]} км/ч.`,
  ],
];

export function localizeWarning(lang: Lang, text: string): string {
  if (lang !== 'ru') return text;
  for (const [pattern, render] of RU_RULES) {
    const m = pattern.exec(text);
    if (m) return render(m);
  }
  return text;
}
