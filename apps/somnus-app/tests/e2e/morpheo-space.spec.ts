import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import es from "../../src/i18n/locales/es.json" with { type: "json" };
import { expect, test } from "./support/console.js";
import { escapeRe, getSignInLink, uniqueEmail } from "./support/emulator.js";

const t = es;

/** A 1x1 PNG: enough for the browser to decode, re-encode and upload. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function registerAdult(page: Page, email: string): Promise<void> {
  await page.goto("/login?lng=es");
  await page.getByLabel(t.login.emailLabel, { exact: true }).fill(email);
  await page.getByRole("button", { name: t.login.sendLink }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page.goto(await getSignInLink(email));

  await page.getByLabel(t.register.firstName, { exact: true }).fill("Ada");
  await page.getByLabel(t.register.lastName, { exact: true }).fill("Lovelace");
  await page.getByRole("button", { name: t.register.next }).click();
  await page.getByRole("radio", { name: new RegExp(escapeRe(t.register.roleAdult)) }).check();
  await page.getByRole("button", { name: t.register.next }).click();
  await page.getByLabel(t.register.ageLabel, { exact: true }).fill("35");
  await page.getByLabel(t.register.consentTerms, { exact: true }).check();
  await page.getByLabel(t.register.consentPrivacy, { exact: true }).check();
  await page.getByRole("button", { name: t.register.submit }).click();
}

/**
 * The Morpheo user's journey end to end: registration lands on the
 * questionnaire (never a dashboard), the result is saved to the account on its
 * own, and from then on the person has their own space -- their assessments
 * with dates, each result, a new assessment, and a complete profile with photo.
 */
test("a new Morpheo user starts with the questionnaire, then has their own space", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await registerAdult(page, uniqueEmail("morpheo-space"));

  // 1. Straight to the questionnaire, on the adult branch they registered for.
  await page.waitForURL("**/assessment");
  await expect(page.getByLabel(t.assessment.role.adult, { exact: true })).toBeChecked();
  await expect(page.getByLabel(t.assessment.role.professional, { exact: true })).toHaveCount(0);

  await page.getByLabel(t.assessment.role.ageAdult, { exact: true }).fill("35");
  await page.getByRole("button", { name: t.assessment.actions.next }).click();
  await page.getByLabel(t.assessment.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.assessment.actions.next }).click();
  await page.getByRole("button", { name: t.assessment.actions.next }).click(); // no safety signal
  await page.getByLabel("despertares", { exact: true }).check();
  await page.getByRole("button", { name: t.assessment.actions.seeResult }).click();

  // 2. The result is saved to the account without asking.
  await expect(page.getByText(t.assessment.result.autoSaved)).toBeVisible();
  const resultScan = await new AxeBuilder({ page }).analyze();
  expect(resultScan.violations).toEqual([]);

  // 3. Their space: the first assessment, its date, and the way to a new one.
  await page.getByRole("link", { name: t.assessment.actions.goToSpace }).click();
  await page.waitForURL("**/app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.space.title);
  await expect(page.getByText(t.space.stats.first)).toBeVisible();
  await expect(page.getByRole("link", { name: t.space.newAssessment.start })).toBeVisible();
  const history = page.locator('a[href^="/app/assessments/"]');
  await expect(history).toHaveCount(1);
  const spaceScan = await new AxeBuilder({ page }).analyze();
  expect(spaceScan.violations).toEqual([]);

  // 4. The saved result, exactly as it was frozen.
  await history.first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.resultPage.title);
  await expect(page.getByText("Información y observación")).toBeVisible();

  // 5. A complete profile, photo included.
  await page.goto("/app/profile?lng=es");
  await page.locator("input[type=file]").setInputFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await expect(page.getByText(t.profile.photoSaved)).toBeVisible();
  await expect(page.getByRole("img", { name: t.profile.photoAlt }).first()).toBeVisible();

  await page.getByLabel(t.profile.dateOfBirth, { exact: true }).fill("1990-04-12");
  await page.getByLabel(t.profile.phone, { exact: true }).fill("+34 600 123 456");
  await page.getByRole("button", { name: t.common.save }).click();
  await expect(page.getByText(t.profile.saved)).toBeVisible();
  const profileScan = await new AxeBuilder({ page }).analyze();
  expect(profileScan.violations).toEqual([]);

  // Complete now: the space stops asking for it.
  await page.goto("/app?lng=es");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.space.title);
  await expect(page.getByText(t.space.completeProfile)).toHaveCount(0);

  await context.close();
});
