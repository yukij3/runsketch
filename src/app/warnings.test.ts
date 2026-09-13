import { describe, expect, it } from 'vitest';
import { localizeWarning } from './warnings';

const cyrillicOnly = (text: string) => /[А-Яа-яЁё]/.test(text) && !/\b(the|than|so|and|this)\b/i.test(text);

describe('localizeWarning (ru)', () => {
  it.each([
    'The target moving time is longer than 168:00:00, so 168:00:00 was used.',
    'Effort averages about 97 % of VO2 reserve for 45:00, more than this athlete can sustain for that long, so heart rate sits near maximum.',
    "The target average speed is slower than this route's descents allow at an easy effort, so the rider brakes to about 31 km/h on descents.",
    'The target moving time of 0:20 could not be matched: moving time jumps between two nearly equal efforts on this route (a gait change or a stop), so the moving time is 0:24.',
    'The target moving time of 0:20 could not be matched: accelerating from a standing start takes up most of this short route, so the moving time is 0:24.',
    'The target moving time of 10:00 could not be matched: the maximum plausible power (2000 W) and speed cap how fast this route can be ridden, so the moving time is 12:31.',
  ])('translates %s', (sentence) => {
    const ru = localizeWarning('ru', sentence);
    expect(cyrillicOnly(ru)).toBe(true);
  });

  it.each([
    'The target average heart rate of 190 bpm is outside this athlete\'s plausible range of 65–182 bpm.',
    'The target average heart rate of 190 bpm could not be matched on this route, so the average in the file is 178 bpm.',
    'Matching an average heart rate of 178 bpm at this pace implies a VO2max of about 23 ml/kg/min, outside the usual range of 25–85.',
  ])('translates heart-rate matching note %s', (sentence) => {
    expect(cyrillicOnly(localizeWarning('ru', sentence))).toBe(true);
  });

  it.each([
    'The weather data ends 1:12:30 before the activity does, so the last known hour was held.',
    'Heat pushed core temperature to about 39.2 °C, so heart rate rose and the pace eased.',
    'Rain made 11.5 km of the route wet, and the wet descents were about 7 % slower.',
  ])('translates weather note %s', (sentence) => {
    expect(cyrillicOnly(localizeWarning('ru', sentence))).toBe(true);
  });

  it('keeps decimal commas in weather notes', () => {
    expect(localizeWarning('ru', 'Heat pushed core temperature to about 39.2 °C, so heart rate rose and the pace eased.')).toContain('39,2 °C');
    expect(localizeWarning('ru', 'Rain made 11.5 km of the route wet, and the wet descents were about 7 % slower.')).toBe(
      'Из-за дождя 11,5 км маршрута были мокрыми, и мокрые спуски пройдены примерно на 7 % медленнее.',
    );
  });

  it('writes decimal commas and Russian units inside numbers', () => {
    expect(
      localizeWarning('ru', 'The target needs about 420 W on flat road (6.0 W/kg, 151 % of VO2 reserve), more than this athlete can sustain; heart rate stays pinned near maximum.'),
    ).toContain('(6,0 Вт/кг, 151 %');
    expect(
      localizeWarning('ru', "On flat ground this target means 3:30/km, about 120 % of this athlete's VO2 reserve, which is not sustainable; heart rate stays pinned near maximum."),
    ).toContain('3:30/км');
  });

  it('keeps the numbers from the English sentence', () => {
    expect(localizeWarning('ru', 'The target moving time of 10:00 could not be matched: the maximum plausible power (2000 W) and speed cap how fast this route can be ridden, so the moving time is 12:31.')).toContain('2000 Вт');
    expect(localizeWarning('en', 'anything')).toBe('anything');
  });
});

describe('localizeWarning (ru): mountains and speed ceilings', () => {
  it.each([
    'The highest point (5642 m) is reached at 14:05 local time, after 13:00, when parties usually turn around to get down safely.',
    'The route climbs to 6961 m; above 5500 m that is not realistic without acclimatisation.',
    'The route climbs to 8849 m; above 7500 m most ascents use bottled oxygen, which is not modelled.',
    'The target moving time of 6:00:00 could not be matched: the oxygen available at altitude caps how fast the climbs can go, so the moving time is 7:12:00.',
    "The target moving time of 40:00 could not be matched: this athlete's highest sustainable climbing rate caps how fast the climbs can go, so the moving time is 52:10.",
    'The target moving time of 40:00 could not be matched: the fastest pace this athlete can hold on the flat caps how fast the route can be covered, so the moving time is 52:10.',
    'The target moving time of 40:00 could not be matched: the fastest plausible walking speed caps how fast the route can be covered, so the moving time is 52:10.',
  ])('translates %s', (sentence) => {
    expect(cyrillicOnly(localizeWarning('ru', sentence))).toBe(true);
  });

  it('keeps the summit height and clock time', () => {
    expect(
      localizeWarning('ru', 'The highest point (5642 m) is reached at 14:05 local time, after 13:00, when parties usually turn around to get down safely.'),
    ).toContain('(5642 м) достигается в 14:05');
  });
});
