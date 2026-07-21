export type RetryPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
};

export const defaultRetryPolicy: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2_000,
  backoffMultiplier: 2,
  jitter: true,
});

export const noRetryPolicy: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  jitter: false,
});

export function isRetriableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

export function isRetriableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  return name === "AbortError" || name === "TimeoutError" || name === "TypeError";
}

export function computeBackoffMs(policy: RetryPolicy, attempt: number): number {
  const base = Math.min(
    policy.initialDelayMs * policy.backoffMultiplier ** attempt,
    policy.maxDelayMs,
  );
  if (!policy.jitter) return base;
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
