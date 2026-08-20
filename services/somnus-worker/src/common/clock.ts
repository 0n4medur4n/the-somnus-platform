/**
 * An injectable clock so time-dependent logic (the retention TTL jobs) is
 * deterministic under test: tests supply a fixed `now`, production uses the wall
 * clock. Build plan §20 Checkpoint 12.2: "TTL job behavior with time control".
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const CLOCK = Symbol("CLOCK");
