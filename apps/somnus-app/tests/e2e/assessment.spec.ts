import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import es from "../../src/i18n/locales/es.json" with { type: "json" };

/**
 * Anonymous assessment golden paths (build plan §20 Checkpoint 10.3), run in
 * `es`. The flow is public: role → consent → concern → the §14b result, served
 * by morpheo through the edge with no session. Interactive safety-signal
 * questioning is deferred (its 22 prompts are not authored yet), so the
 * orientation is the baseline L4 and the L0/L1 emergency paths (T-03/T-06) and
 * the `ca` run follow with that content. Double-claim rejection is proven at the
 * API layer (morpheo single-use token) in the service tests.
 */
const t = es.assessment;

async function chooseRoleAndConsent(
  page: Page,
  opts: { role: "adult" | "parent" | "professional"; age?: string },
): Promise<void> {
  await page.goto("/assessment?lng=es");
  await page.getByLabel(t.role[opts.role], { exact: true }).check();
  if (opts.age !== undefined) {
    const label = opts.role === "parent" ? t.role.ageMinor : t.role.ageAdult;
    await page.getByLabel(label, { exact: true }).fill(opts.age);
  }
}

test("adult INS path shows the L4 orientation and passes the a11y baseline", async ({ page }) => {
  await chooseRoleAndConsent(page, { role: "adult", age: "35" });

  // Accessibility on the first assessment screen.
  const roleScan = await new AxeBuilder({ page }).analyze();
  expect(roleScan.violations).toEqual([]);

  await page.getByRole("button", { name: t.actions.next }).click();
  await page.getByLabel(t.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click();

  await page.getByLabel("despertares", { exact: true }).check();
  await page.getByRole("button", { name: t.actions.seeResult }).click();

  await expect(page.getByRole("heading", { name: t.result.title })).toBeVisible();
  await expect(page.getByText("Información y observación")).toBeVisible();
  await expect(page.getByText(t.result.limitsText)).toBeVisible();

  // Accessibility on the result screen.
  const resultScan = await new AxeBuilder({ page }).analyze();
  expect(resultScan.violations).toEqual([]);
});

test("parent BRE path routes to breathing and keeps the output adult-directed", async ({
  page,
}) => {
  await chooseRoleAndConsent(page, { role: "parent", age: "8" });
  await page.getByLabel(t.role.guardianship, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click();
  await page.getByLabel(t.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click();

  await page.getByLabel("ronquido", { exact: true }).check();
  await page.getByRole("button", { name: t.actions.seeResult }).click();

  await expect(page.getByRole("heading", { name: t.result.title })).toBeVisible();
  // Routed to the breathing module; the output speaks to the adult, never the minor.
  await expect(page.getByText("Respiración durante el sueño")).toBeVisible();
  await expect(page.getByText(t.result.limitsText)).toBeVisible();
});

test("professional with identifiable data hits the privacy block", async ({ page }) => {
  await chooseRoleAndConsent(page, { role: "professional" });
  await page.getByLabel(t.role.professionalConfirm, { exact: true }).check();
  await page.getByLabel(t.role.identifiable, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click();
  await page.getByLabel(t.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click();

  await page.getByLabel("despertares", { exact: true }).check();
  await page.getByRole("button", { name: t.actions.seeResult }).click();

  await expect(page.getByText(t.result.blocked.privacy_block)).toBeVisible();
});
