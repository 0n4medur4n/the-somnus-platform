export type FakeTimerHandle = {
  advance(ms: number): void;
  restore(): void;
  now(): number;
};

export function withFakeTimers(startAt?: Date): FakeTimerHandle {
  const start = (startAt ?? new Date()).getTime();
  let now = start;
  const realDateNow = Date.now;
  const realPerfNow = performance.now.bind(performance);
  Date.now = (): number => now;
  performance.now = (): number => now - start;
  return {
    advance(ms: number): void {
      now += ms;
    },
    restore(): void {
      Date.now = realDateNow;
      performance.now = realPerfNow;
    },
    now(): number {
      return now;
    },
  };
}
