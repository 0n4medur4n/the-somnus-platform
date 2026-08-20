import { NOTIFICATION_TYPES, SUPPORTED_LOCALES } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import { renderEmail } from "../src/modules/notification/templates/render.js";

const LINK = "https://app.somnus.example/r/abc123?token=secret";

// Anything that would leak clinical content into an email (build plan §3.7).
const HEALTH_TERMS = [
  "insomnio",
  "insomnia",
  "apnea",
  "diagnóstico",
  "diagnosis",
  "síntoma",
  "symptom",
  "nivel de atención",
  "l0",
  "l1",
];

describe("email templates", () => {
  it("carry the secure link and no health details, in every locale and type", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const type of NOTIFICATION_TYPES) {
        const email = renderEmail(type, locale, LINK, { organizationName: "Acme" });

        expect(email.subject.length).toBeGreaterThan(0);
        // The secure link is present in both HTML and text bodies.
        expect(email.text).toContain(LINK);
        expect(email.html).toContain("app.somnus.example");

        const haystack = `${email.subject}\n${email.html}\n${email.text}`.toLowerCase();
        for (const term of HEALTH_TERMS) {
          expect(haystack).not.toContain(term);
        }
      }
    }
  });

  it("interpolates non-clinical params and leaves no placeholder behind", () => {
    const email = renderEmail("invitation", "es", LINK, { organizationName: "Clínica Sol" });
    expect(email.text).toContain("Clínica Sol");
    expect(email.html).not.toContain("{{");
  });

  it("produces distinct subjects per locale", () => {
    const subjects = SUPPORTED_LOCALES.map(
      (locale) => renderEmail("report_ready", locale, LINK, {}).subject,
    );
    expect(new Set(subjects).size).toBe(SUPPORTED_LOCALES.length);
  });
});
