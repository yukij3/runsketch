import type { Translate } from '../app/i18n';

export type WaypointRole = 'start' | 'finish' | 'mid';

export function waypointRole(index: number, count: number): WaypointRole {
  if (index === 0) return 'start';
  return index === count - 1 ? 'finish' : 'mid';
}

export function waypointLabel(t: Translate, index: number, count: number): string {
  const role = waypointRole(index, count);
  if (role === 'start') return t('wpStart');
  if (role === 'finish') return t('wpFinish');
  return t('wpN', { n: index + 1 });
}
