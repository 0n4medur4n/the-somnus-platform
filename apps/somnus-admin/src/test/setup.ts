import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import i18n from "../i18n/index.js";

// Deterministic locale for component assertions (jsdom's navigator
// language would otherwise pick it). Tests assert via i18n.t so they
// stay locale-agnostic, but pinning keeps snapshots stable.
beforeAll(async () => {
  await i18n.changeLanguage("es");
});

afterEach(() => {
  cleanup();
});
