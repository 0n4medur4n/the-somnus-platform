import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GabaMolecule } from "./GabaMolecule";

const copy = {
  moleculeDescription: "GABA molecule",
  moleculeTitle: "GABA",
  signalLabels: ["Awakenings", "Schedules", "Habits", "Daytime impact", "Relevant signals"],
} as const;

describe("GabaMolecule", () => {
  it("renders on the server without requiring the removed atom label map", () => {
    const markup = renderToStaticMarkup(createElement(GabaMolecule, copy));

    expect(markup).toContain('id="atom-nitrogen"');
    expect(markup).toContain('id="atom-oxygen-2"');
    expect(markup).toContain(">NH₂</text>");
    expect(markup.match(/>CH₂<\/text>/g)).toHaveLength(3);
    expect(markup).toContain(">OH</text>");
    expect(markup).toContain("NH₂–CH₂–CH₂–CH₂–COOH");
    expect(markup.match(/class="bond__core"/g)).toHaveLength(7);
    expect(markup.match(/class="bond__highlight"/g)).toHaveLength(7);
    expect(markup.match(/class="bond__base"/g)).toHaveLength(7);
    expect(markup.match(/pathLength="1"/g)).toHaveLength(21);
    expect(markup.match(/data-specular=/g)).toHaveLength(7);
  });
});
