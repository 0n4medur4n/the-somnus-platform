export function withFakeTimers(startAt) {
  const start = (startAt ?? new Date()).getTime();
  let now = start;
  const realDateNow = Date.now;
  const realPerfNow = performance.now.bind(performance);
  Date.now = () => now;
  performance.now = () => now - start;
  return {
    advance(ms) {
      now += ms;
    },
    restore() {
      Date.now = realDateNow;
      performance.now = realPerfNow;
    },
    now() {
      return now;
    },
  };
}
//# sourceMappingURL=fake-timers.js.map
