# @somnus/test-utils

Test helpers shared by every package and service. At Phase 2.1 this
package contains only two helpers:

- `captureLogger()` — a writable sink that records every line passed
  to it, parses JSON when possible, and exposes a `lines` getter and
  a `reset()` method.
- `withFakeTimers(startAt?)` — pin `Date.now` and `performance.now`
  to a fixed moment, advance time deterministically, and restore the
  real clocks.

## Build plan

Implements build plan §20 Phase 2 / Checkpoint 2.1 (test utilities
scaffold). Service-level helpers (e.g. a NestJS test module, a Drizzle
test database fixture) land with the corresponding service in later
phases.
