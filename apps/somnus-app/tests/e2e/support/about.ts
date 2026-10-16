import { expect, type Page } from "@playwright/test";
import es from "../../../src/i18n/locales/es.json" with { type: "json" };

type Dict = typeof es;

/**
 * Registration step 2, "about you": birth date, gender and country (required),
 * city and phone left empty (optional). The same on every branch.
 */
export async function fillAboutYou(page: Page, t: Dict): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.register.aboutTitle);
  await page.getByLabel(t.register.dobLabel, { exact: true }).fill("1990-05-17");
  await page.getByRole("radio", { name: t.about.gender.female, exact: true }).check();
  await page.getByLabel(t.about.countryLabel, { exact: true }).selectOption("ES");
  await page.getByRole("button", { name: t.register.next }).click();
}
