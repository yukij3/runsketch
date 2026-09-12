// FileSaver.js waits 40 s before revoking: some browsers resolve the blob URL asynchronously
// after click(), and revoking immediately cancels the download there.
export const REVOKE_DELAY_MS = 40_000;

/** Saves a Blob through a temporary <a download> element and releases the object URL afterwards. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
