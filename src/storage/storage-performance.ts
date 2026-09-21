export interface StorageTiming {
  operation: 'get' | 'set' | 'remove';
  keyCount: number;
  durationMs: number;
}

const SLOW_STORAGE_THRESHOLD_MS = 100;

export async function timedStorageOperation<T>(
  operation: StorageTiming['operation'],
  keyCount: number,
  action: () => Promise<T>,
  onTiming: (timing: StorageTiming) => void = (timing) => {
    if (timing.durationMs >= SLOW_STORAGE_THRESHOLD_MS) console.debug('[X-Pilot][storage-slow]', timing);
  },
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    onTiming({ operation, keyCount, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
  }
}
