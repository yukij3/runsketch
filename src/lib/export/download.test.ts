// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { REVOKE_DELAY_MS, downloadBlob } from './download';

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('clicks a temporary <a download> and revokes the object URL afterwards', () => {
  vi.useFakeTimers();
  const create = vi.fn((_: Blob | MediaSource) => 'blob:runsketch/1');
  const revoke = vi.fn((_: string) => undefined);
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;

  const seen: Array<{ href: string; download: string; attached: boolean }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    seen.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
  });

  const blob = new Blob(['<gpx/>'], { type: 'application/gpx+xml' });
  downloadBlob(blob, 'run.gpx');

  expect(create).toHaveBeenCalledWith(blob);
  expect(seen).toEqual([{ href: 'blob:runsketch/1', download: 'run.gpx', attached: true }]);
  expect(document.querySelectorAll('a').length).toBe(0);
  expect(revoke).not.toHaveBeenCalled();

  vi.advanceTimersByTime(REVOKE_DELAY_MS);
  expect(revoke).toHaveBeenCalledWith('blob:runsketch/1');
});
