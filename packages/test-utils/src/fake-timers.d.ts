export type FakeTimerHandle = {
  advance(ms: number): void;
  restore(): void;
  now(): number;
};
export declare function withFakeTimers(startAt?: Date): FakeTimerHandle;
//# sourceMappingURL=fake-timers.d.ts.map
