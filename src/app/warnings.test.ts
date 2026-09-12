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
    'The target average heart rate of 190 bpm could not be matched on this route, so the average over moving time is 178 bpm.',
    'Matching an average heart rate of 178 bpm at this pace implies a VO2max of about 23 ml/kg/min, outside the usual range of 25–85.',
  ])('translates heart-rate matching note %s', (sentence) => {
    expect(cyrillicOnly(localizeWarning('ru', sentence))).toBe(true);
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
