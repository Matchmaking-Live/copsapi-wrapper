import { CopsApiError } from './errors.js';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new CopsApiError('aborted', 'Request aborted.', 0, null, { cause: signal.reason }));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CopsApiError('aborted', 'Request aborted.', 0, null, { cause: signal?.reason }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
