import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import ca from "../../src/i18n/locales/ca.json" with { type: "json" };
import es from "../../src/i18n/locales/es.json" with { type: "json" };
import { escapeRe, getSignInLink, uniqueEmail } from "./support/emulator.js";

type Dict = typeof es;
const DICTS: Record<string, Dict> = { es, ca };

/**
 * Addendum A §A3 Checkpoint 14.1: one registration flow with three role
 * branches, exercised end to end against the live dev stack in `es` and `ca`
 * (the tie-breaker locale, §19). Each branch is driven through the real
 * magic-link sign-in, so a branch field that the SPA, the edge or identity
 * silently dropped would fail the request rather than pass with degraded data.
 */
async function signInThroughMagicLink(page: Page, locale: string, email: string): Promise<void> {
  const t = DICTS[locale] as Dict;
  await page.goto(`/login?lng=${locale}`);
  await page.getByLabel(t.login.emailLabel, { exact: true }).fill(email);
  await page.getByRole("button", { name: t.login.sendLink }).click();
  await expect(page.getByRole("status")).toContainText(email);

  const link = await getSignInLink(email);
  await page.goto(link);
}

/** Step 1 (name) and step 2 (role) are common to every branch. */
async function fillNameAndChooseRole(
  page: Page,
  locale: string,
  roleLabel: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  const t = DICTS[locale] as Dict;
  await page.getByLabel(t.register.firstName, { exact: true }).fill(firstName);
  await page.getByLabel(t.register.lastName, { exact: true }).fill(lastName);
  await page.getByRole("button", { name: t.register.next }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.register.roleTitle);
  await page.getByRole("radio", { name: new RegExp(escapeRe(roleLabel)) }).check();
  await page.getByRole("button", { name: t.register.next }).click();
}

async function acceptBothConsents(page: Page, locale: string): Promise<void> {
  const t = DICTS[locale] as Dict;
  // Two separate checkboxes, one per purpose -- never one combined control
  // (build plan §13).
  await page.getByLabel(t.register.consentTerms, { exact: true }).check();
  await page.getByLabel(t.register.consentPrivacy, { exact: true }).check();
}

for (const locale of ["es", "ca"] as const) {
  const t = DICTS[locale] as Dict;

  test(`registration in ${locale}: adult branch reaches the app`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = uniqueEmail(`adult-${locale}`);

    await signInThroughMagicLink(page, locale, email);

    // Accessibility baseline on the registration screen itself. Wait for step 1
    // to render first: scanning earlier hits the transient "verifying" status
    // screen (FullPageStatus), which is not what this baseline is about.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.register.nameTitle);
    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);

    await fillNameAndChooseRole(page, locale, t.register.roleAdult, "Ada", "Lovelace");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.register.adultTitle);

    await page.getByLabel(t.register.ageLabel, { exact: true }).fill("34");
    await acceptBothConsents(page, locale);
    await page.getByRole("button", { name: t.register.submit }).click();

    await page.waitForURL("**/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.app.homeTitle);
    await expect(page.getByText("Ada", { exact: false })).toBeVisible();

    await context.close();
  });

  test(`registration in ${locale}: guardian branch reaches the app`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = uniqueEmail(`parent-${locale}`);

    await signInThroughMagicLink(page, locale, email);
    await fillNameAndChooseRole(page, locale, t.register.roleParent, "Marie", "Curie");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.register.parentTitle);

    // The minor never has an account: only the guardian's confirmation and the
    // minor's age band are collected (Addendum A §A1).
    await page.getByLabel(t.register.guardianshipLabel, { exact: true }).check();
    await page.getByLabel(t.register.minorAgeBandLabel, { exact: true }).selectOption("6-12y");
    await acceptBothConsents(page, locale);
    await page.getByRole("button", { name: t.register.submit }).click();

    await page.waitForURL("**/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.app.homeTitle);
    await expect(page.getByText("Marie", { exact: false })).toBeVisible();

    await context.close();
  });

  test(`registration in ${locale}: professional branch reaches the app as an individual`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = uniqueEmail(`pro-${locale}`);

    await signInThroughMagicLink(page, locale, email);
    await fillNameAndChooseRole(page, locale, t.register.roleProfessional, "Grace", "Hopper");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.register.professionalTitle);

    // The screen says outright that professional features stay off until a
    // verifier approves the case (Addendum A §A1).
    await expect(page.getByText(t.register.verificationNotice)).toBeVisible();

    await page
      .getByLabel(t.register.specialtyLabel, { exact: true })
      .selectOption("sleep_physician");
    await page.getByLabel(t.register.licenseLabel, { exact: true }).fill("COL-12345");
    await acceptBothConsents(page, locale);
    await page.getByRole("button", { name: t.register.submit }).click();

    await page.waitForURL("**/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.app.homeTitle);
    await expect(page.getByText("Grace", { exact: false })).toBeVisible();

    await context.close();
  });

  test(`registration in ${locale}: a minor age and a skipped guardianship are refused`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = uniqueEmail(`negative-${locale}`);

    await signInThroughMagicLink(page, locale, email);

    // Adult branch, minor age -> refused, and the account is never created.
    await fillNameAndChooseRole(page, locale, t.register.roleAdult, "Too", "Young");
    await page.getByLabel(t.register.ageLabel, { exact: true }).fill("15");
    await acceptBothConsents(page, locale);
    await page.getByRole("button", { name: t.register.submit }).click();
    await expect(page.getByText(t.register.errors.ageMin).first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/app/);

    // Same session, guardian branch, guardianship left unconfirmed -> refused.
    await page.getByRole("button", { name: t.register.back }).click();
    await page.getByRole("radio", { name: new RegExp(escapeRe(t.register.roleParent)) }).check();
    await page.getByRole("button", { name: t.register.next }).click();
    await page.getByLabel(t.register.minorAgeBandLabel, { exact: true }).selectOption("3-5y");
    await acceptBothConsents(page, locale);
    await page.getByRole("button", { name: t.register.submit }).click();
    await expect(page.getByText(t.register.errors.guardianship).first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/app/);

    await context.close();
  });
}
