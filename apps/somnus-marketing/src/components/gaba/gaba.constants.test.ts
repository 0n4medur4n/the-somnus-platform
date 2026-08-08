import { describe, expect, it } from "vitest";

import {
  GABA_ATOMS,
  GABA_CONNECTION_STEPS,
  GABA_MEDIA_QUERIES,
  GABA_SIGNAL_SEQUENCE,
} from "./gaba.constants";

describe("GABA motion media queries", () => {
  it("always initializes the animation context when reduced motion is not requested", () => {
    expect(GABA_MEDIA_QUERIES).toEqual({
      all: "all",
      reduced: "(prefers-reduced-motion: reduce)",
    });
  });
});

describe("GABA scientific labels", () => {
  it("shows the simplified chemical groups directly on the atoms", () => {
    expect(GABA_ATOMS.map(({ label }) => label)).toEqual([
      "NH₂",
      "CH₂",
      "CH₂",
      "CH₂",
      "C",
      "O",
      "OH",
    ]);
  });
});

describe("sleep signal choreography", () => {
  it("reveals the five signals in order without overlapping the next signal", () => {
    expect(GABA_SIGNAL_SEQUENCE.map(({ signalIndex }) => signalIndex)).toEqual([0, 1, 2, 3, 4]);

    for (const [index, signal] of GABA_SIGNAL_SEQUENCE.entries()) {
      const nextSignal = GABA_SIGNAL_SEQUENCE[index + 1];
      if (!nextSignal) continue;
      expect(signal.fadeStart + signal.fadeDuration).toBeLessThanOrEqual(nextSignal.start);
    }
  });
});

describe("GABA connection choreography", () => {
  it("builds the carbon chain first and completes the carboxyl group last", () => {
    expect(GABA_CONNECTION_STEPS.map(({ atomId }) => atomId)).toEqual([
      "carbon-1",
      "carbon-2",
      "carbon-3",
      "carbon-4",
      "oxygen-1",
      "oxygen-2",
    ]);
    expect(GABA_CONNECTION_STEPS.at(-1)?.bondIds).toEqual(["bond-hydroxyl"]);
  });

  it("starts every incoming atom away from its final position", () => {
    expect(GABA_CONNECTION_STEPS.every(({ fromX, fromY }) => fromX !== 0 || fromY !== 0)).toBe(
      true,
    );
  });
});
