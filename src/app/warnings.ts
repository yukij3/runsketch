// simulate() reports warnings in English. Known sentences get a Russian rendering; unknown ones pass through.
import type { Lang } from './i18n';

type Rule = [pattern: RegExp, render: (m: RegExpExecArray) => string];

/** "5:30/km" → "5:30/км"; "3.2" → "3,2". */
const ruPace = (text: string) => text.replace('/km', '/км');
const ruDecimal = (text: string) => text.replace('.', ',');

const REASONS: Record<string, string> = {
  'corner speed limits and the maximum plausible speed on this route cap how fast it can be covered':
    'ограничения скорости в поворотах и предельная правдоподобная скорость не позволяют пройти маршрут быстрее',
  'the slowest plausible moving speed still covers the route sooner': 'даже самая медленная правдоподобная скорость проходит маршрут быстрее',
  'moving time jumps between two nearly equal efforts on this route (a gait change or a stop)':
    'время в движении скачком меняется между двумя почти равными усилиями (смена бега на шаг или остановка)',
  'accelerating from a standing start takes up most of this short route': 'разгон с места занимает бо́льшую часть этого короткого маршрута',
  'the oxygen available at altitude caps how fast the climbs can go': 'на высоте не хватает кислорода, чтобы подниматься быстрее',
  "this athlete's highest sustainable climbing rate caps how fast the climbs can go":
    'предельная для спортсмена скорость набора высоты не позволяет подниматься быстрее',
  'the fastest pace this athlete can hold on the flat caps how fast the route can be covered':
    'самый быстрый темп, который спортсмен может держать по ровному, не позволяет пройти маршрут быстрее',
  'the fastest plausible walking speed caps how fast the route can be covered': 'предельная правдоподобная скорость ходьбы не позволяет пройти маршрут быстрее',
};

function localizeReason(reason: string): string {
  const power = /^the maximum plausible power \((\d+) W\) and speed cap how fast this route can be ridden$/.exec(reason);
  if (power) return `предельная правдоподобная мощность (${power[1]} Вт) и скорость не позволяют проехать маршрут быстрее`;
  return REASONS[reason] ?? reason;
}

const RU_RULES: Rule[] = [
  [
    /^The target was missing or not positive, so a default average pace of (.+) was used\.$/,
    (m) => `Цель не задана или не больше нуля, поэтому взят средний темп по умолчанию: ${ruPace(m[1])}.`,
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
    /^The elevation data was steeper than this route plausibly is, so grades were limited on about (\d+) m\.$/,
    (m) => `Данные высот круче, чем правдоподобно для этого маршрута, поэтому уклоны ограничены примерно на ${m[1]} м.`,
  ],
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
      `Для этой цели нужно около ${m[1]} Вт на ровной дороге (${ruDecimal(m[2])} Вт/кг, ${m[3]} % резерва VO2) — больше, чем спортсмен способен держать; пульс упирается в максимум.`,
  ],
  [
    /^Some climbs are too steep for the planned power, so the rider crawls at 3\.6 km\/h for about (.+)\.$/,
    (m) => `Некоторые подъёмы слишком круты для заданной мощности: около ${m[1]} велосипедист ползёт со скоростью 3,6 км/ч.`,
  ],
  [
    /^On flat ground this target means (.+), about (\d+) % of this athlete's VO2 reserve, which is not sustainable; heart rate stays pinned near maximum\.$/,
    (m) => `На ровном месте эта цель означает ${ruPace(m[1])}, около ${m[2]} % резерва VO2 спортсмена, — долго так не продержаться; пульс упирается в максимум.`,
  ],
  [
    /^The highest point \((\d+) m\) is reached at (\d+:\d\d) local time, after 13:00, when parties usually turn around to get down safely\.$/,
    (m) => `Высшая точка (${m[1]} м) достигается в ${m[2]} по местному времени — позже 13:00, когда группы обычно уже поворачивают вниз, чтобы безопасно спуститься.`,
  ],
  [
    /^The route climbs to (\d+) m; above 5500 m that is not realistic without acclimatisation\.$/,
    (m) => `Маршрут поднимается до ${m[1]} м: выше 5500 м это нереалистично без акклиматизации.`,
  ],
  [
    /^The route climbs to (\d+) m; above 7500 m most ascents use bottled oxygen, which is not modelled\.$/,
    (m) => `Маршрут поднимается до ${m[1]} м: выше 7500 м большинство восхождений идёт с кислородом, а он в модели не учитывается.`,
  ],
  [
    /^Running speed on steep climbs fell below the walk–run transition, so (\d+) m were power-hiked with a walking gait and cadence\.$/,
    (m) => `На крутых подъёмах скорость бега опускалась ниже порога перехода на шаг, поэтому ${m[1]} м пройдены быстрым шагом.`,
  ],
  [/^Some descents are too steep to run, so (\d+) m were walked down\.$/, (m) => `Некоторые спуски слишком круты для бега, поэтому ${m[1]} м пройдены шагом.`],
  [
    /^Technical ground allows only about (\d+) % of smooth-path speed over ([\d.]+) km, so holding the target pace there takes much more effort\.$/,
    (m) => `Технический рельеф позволяет держать лишь около ${m[1]} % скорости по гладкой дороге на ${ruDecimal(m[2])} км, поэтому целевой темп там даётся куда тяжелее.`,
  ],
  [
    /^Glycogen ran low around (\d+) km, so the pace dropped sharply from there \(hitting the wall\)\.$/,
    (m) => `Около ${m[1]} км закончился гликоген, и с этого места темп резко упал («стена»).`,
  ],
  [
    /^Effort averages about (\d+) % of VO2 reserve for (.+), more than this athlete can sustain for that long, so heart rate sits near maximum\.$/,
    (m) =>
      `Нагрузка в среднем около ${m[1]} % резерва VO2 в течение ${m[2]} — дольше, чем спортсмен способен её держать, поэтому пульс держится у максимума.`,
  ],
  [
    /^The target average heart rate of (\d+) bpm is outside this athlete's plausible range of (\d+)–(\d+) bpm\.$/,
    (m) => `Целевой средний пульс ${m[1]} уд/мин вне правдоподобного для спортсмена диапазона ${m[2]}–${m[3]} уд/мин.`,
  ],
  [
    /^The target average heart rate of (\d+) bpm could not be matched on this route, so the average in the file is (\d+) bpm\.$/,
    (m) => `На этом маршруте не удалось выйти на средний пульс ${m[1]} уд/мин: в файле средний пульс — ${m[2]} уд/мин.`,
  ],
  [
    /^Matching an average heart rate of (\d+) bpm at this pace implies a VO2max of about (\d+) ml\/kg\/min, outside the usual range of (\d+)–(\d+)\.$/,
    (m) => `Средний пульс ${m[1]} уд/мин при таком темпе означает VO2max около ${m[2]} мл/кг/мин — вне обычного диапазона ${m[3]}–${m[4]}.`,
  ],
  [
    /^The weather data ends (.+) before the activity does, so the last known hour was held\.$/,
    (m) => `Данные о погоде заканчиваются за ${m[1]} до конца тренировки, поэтому до финиша взят последний известный час.`,
  ],
  [
    /^Heat pushed core temperature to about ([\d.]+) °C, so heart rate rose and the pace eased\.$/,
    (m) => `Из-за жары температура тела поднялась примерно до ${ruDecimal(m[1])} °C, поэтому пульс вырос, а темп снизился.`,
  ],
  [
    /^Cold, wet weather cooled core temperature to about ([\d.]+) °C, so the pace slowed and shivering raised heart rate\.$/,
    (m) =>
      `Из-за холода и сырости температура тела опустилась примерно до ${ruDecimal(m[1])} °C, поэтому темп упал, а дрожь подняла пульс.`,
  ],
  [
    /^Cold, wind and wet clothing cooled the muscles and slowed the pace by up to about (\d+) %\.$/,
    (m) => `Холод, ветер и мокрая одежда остудили мышцы и замедлили темп примерно на ${m[1]} %.`,
  ],
  [
    /^Rain made ([\d.]+) km of the route wet, and the wet descents were about (\d+) % slower\.$/,
    (m) => `Из-за дождя ${ruDecimal(m[1])} км маршрута были мокрыми, и мокрые спуски пройдены примерно на ${m[2]} % медленнее.`,
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
