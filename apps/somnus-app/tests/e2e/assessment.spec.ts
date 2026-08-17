import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import es from "../../src/i18n/locales/es.json" with { type: "json" };

/**
 * Anonymous assessment golden paths (build plan §20 Checkpoint 10.3), run in
 * `es` against the real edge → morpheo → MySQL stack. The flow is safety-first
 * (state machine §14a): role → consent → safety questions → (emergency stop) →
 * concern → the §14b result. `ca` follows when its content is localized.
 */
const t = es.assessment;

async function roleConsent(
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

async function passConsent(page: Page): Promise<void> {
  await page.getByRole("button", { name: t.actions.next }).click(); // -> consent
  await page.getByLabel(t.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click(); // -> safety
}

/** Answer one safety question (identified by a fragment of its text) Sí/No. */
async function answerSafety(page: Page, question: RegExp, answer: string): Promise<void> {
  await page.getByRole("group", { name: question }).getByLabel(answer, { exact: true }).check();
}

test("adult INS path shows the L4 orientation and passes the a11y baseline", async ({ page }) => {
  await roleConsent(page, { role: "adult", age: "35" });

  const roleScan = await new AxeBuilder({ page }).analyze();
  expect(roleScan.violations).toEqual([]);

  await passConsent(page);
  // No safety signal -> continue to the concern step.
  await page.getByRole("button", { name: t.actions.next }).click();

  await page.getByLabel("despertares", { exact: true }).check();
  await page.getByRole("button", { name: t.actions.seeResult }).click();

  await expect(page.getByRole("heading", { name: t.result.title })).toBeVisible();
  await expect(page.getByText("Información y observación")).toBeVisible();
  await expect(page.getByText(t.result.limitsText)).toBeVisible();

  const resultScan = await new AxeBuilder({ page }).analyze();
  expect(resultScan.violations).toEqual([]);
});

test("parent BRE path routes to breathing and keeps the output adult-directed", async ({
  page,
}) => {
  await roleConsent(page, { role: "parent", age: "8" });
  await page.getByLabel(t.role.guardianship, { exact: true }).check();
  await passConsent(page);
  await page.getByRole("button", { name: t.actions.next }).click(); // no safety signal -> concern

  await page.getByLabel("ronquido", { exact: true }).check();
  await page.getByRole("button", { name: t.actions.seeResult }).click();

  await expect(page.getByRole("heading", { name: t.result.title })).toBeVisible();
  await expect(page.getByText("Respiración durante el sueño")).toBeVisible();
});

test("T-03: adult driving near-miss escalates to L1 and stops before the concern step", async ({
  page,
}) => {
  await roleConsent(page, { role: "adult", age: "35" });
  await passConsent(page);

  await answerSafety(page, /a punto de sufrir un accidente/, t.safety.yes);
  await page.getByRole("button", { name: t.actions.next }).click();

  // Emergency stop: straight to the result, no concern step.
  await expect(page.getByRole("heading", { name: t.result.title })).toBeVisible();
  await expect(page.getByText(/Valoración urgente/)).toBeVisible();
  await expect(page.getByRole("button", { name: t.actions.seeResult })).toHaveCount(0);
});

test("T-06: infant cyanosis + unresponsive is an L0 emergency that stops the flow", async ({
  page,
}) => {
  await roleConsent(page, { role: "parent", age: "0" });
  await page.getByLabel(t.role.guardianship, { exact: true }).check();
  await passConsent(page);

  await answerSafety(page, /azulados o grisáceos/, t.safety.yes); // cyanosis
  await answerSafety(page, /no responde cuando le habla/, t.safety.yes); // unresponsive
  await page.getByRole("button", { name: t.actions.next }).click();

  await expect(page.getByRole("heading", { name: t.result.title })).toBeVisible();
  await expect(page.getByText("Emergencia actual")).toBeVisible();
  await expect(page.getByRole("button", { name: t.actions.seeResult })).toHaveCount(0);
});

test("professional with identifiable data hits the privacy block", async ({ page }) => {
  await roleConsent(page, { role: "professional" });
  await page.getByLabel(t.role.professionalConfirm, { exact: true }).check();
  await page.getByLabel(t.role.identifiable, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click(); // -> consent
  await page.getByLabel(t.consent.label, { exact: true }).check();
  await page.getByRole("button", { name: t.actions.next }).click(); // create -> blocked

  await expect(page.getByText(t.result.blocked.privacy_block)).toBeVisible();
});
