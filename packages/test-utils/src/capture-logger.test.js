import { describe, expect, it } from "vitest";
import { captureLogger } from "./capture-logger.js";

describe("captureLogger", () => {
  it("captures raw lines and parsed JSON when valid", () => {
    const sink = captureLogger();
    sink('{"level":"info","message":"hi"}');
    sink("not json");
    expect(sink.lines.length).toBe(2);
    expect(sink.lines[0]?.parsed).toEqual({ level: "info", message: "hi" });
    expect(sink.lines[1]?.parsed).toBeNull();
    expect(sink.lines[1]?.raw).toBe("not json");
  });
  it("reset clears the captured lines", () => {
    const sink = captureLogger();
    sink('{"a":1}');
    expect(sink.lines.length).toBe(1);
    sink.reset();
    expect(sink.lines.length).toBe(0);
  });
});
//# sourceMappingURL=capture-logger.test.js.map
