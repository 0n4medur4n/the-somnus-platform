import { describe, expect, it } from "vitest";
import { appendDictation, spokenText } from "./dictation.js";

describe("spoken punctuation", () => {
  it("turns spoken marks into punctuation and keeps one of each", () => {
    expect(spokenText("hola coma qué tal punto", "es")).toBe("hola, qué tal.");
    expect(spokenText("hola punto y aparte qué tal", "es")).toBe("hola.\nqué tal");
  });

  it("uses the phrases of the language being dictated", () => {
    expect(spokenText("hello comma how are you full stop", "en")).toBe("hello, how are you.");
    expect(spokenText("hola coma què tal punt", "ca")).toBe("hola, què tal.");
    expect(spokenText("bonjour virgule ça va point", "fr")).toBe("bonjour, ça va.");
  });
});

describe("appendDictation", () => {
  it("starts a sentence with a capital and separates the next one", () => {
    expect(appendDictation("", "me despierto varias veces punto", "es")).toBe(
      "Me despierto varias veces.",
    );
    expect(appendDictation("Me despierto.", "luego no concilio el sueño", "es")).toBe(
      "Me despierto. Luego no concilio el sueño",
    );
  });

  it("breaks the line when a new paragraph is said", () => {
    expect(appendDictation("Me acuesto tarde.", "punto y aparte me levanto cansado", "es")).toBe(
      "Me acuesto tarde.\nMe levanto cansado",
    );
  });
});
