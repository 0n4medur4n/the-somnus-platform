export function captureLogger() {
  const captured = [];
  const sink = (line) => {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = null;
    }
    captured.push({ raw: line, parsed });
  };
  Object.defineProperty(sink, "lines", {
    get: () => captured,
    enumerable: true,
  });
  sink.reset = () => {
    captured.length = 0;
  };
  return sink;
}
//# sourceMappingURL=capture-logger.js.map
