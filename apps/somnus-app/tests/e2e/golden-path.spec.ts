import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import ca from "../../src/i18n/locales/ca.json";
import es from "../../src/i18n/locales/es.json";
import { getSignInLink, uniqueEmail } from "./support/emulator.js";

type Dict = typeof es;
const DICTS: Record<string, Dict> = { es, ca };

/**
 * Build plan §20 Checkpoint 9.1 golden path, run once in `es` and once
 * in `ca` (the tie-breaker locale, §19). Two real users via the Auth
 * emulator's email-link flow: an owner registers, edits their profile,
 * creates an organization and invites someone; a second user registers
 * and accepts the invitation. Asserts the accessibility baseline (axe,
 * no violations on login + profile) and that no Firebase token is ever
 * persisted in the browser (build plan §5.2 / §10).
 */
async function signInAndRegister(
  page: Page,
  t: Dict,
  locale: string,
  email: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  await page.goto(`/login?lng=${locale}`);
  await page.getByLabel(t.login.emailLabel).fill(email);
  await page.getByRole("button", { name: t.login.sendLink }).click();
  await expect(page.getByRole("status")).toContainText(email);

  const link = await getSignInLink(email);
  await page.goto(link);

  // New account -> the callback shows the registration form.
  await page.getByLabel(t.callback.firstName).fill(firstName);
  await page.getByLabel(t.callback.lastName).fill(lastName);
  await page.getByRole("button", { name: t.callback.completeRegistration }).click();

  await page.waitForURL("**/app");
}

async function expectNoTokenInStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => {
    const idbNames = (await indexedDB.databases?.())?.map((d) => d.name ?? "") ?? [];
    return {
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      idb: idbNames,
    };
  });
  const tokenLike = /firebase:authUser|refreshToken|idToken|accessToken/i;
  expect(storage.local.some((k) => tokenLike.test(k))).toBe(false);
  expect(storage.session.some((k) => tokenLike.test(k))).toBe(false);
  expect(storage.idb.some((n) => /firebaseLocalStorage/i.test(n))).toBe(false);
}

for (const locale of ["es", "ca"] as const) {
  const t = DICTS[locale];

  test(`golden path in ${locale}: register, login, profile, org, invite, accept, logout`, async ({
    browser,
  }) => {
    const ownerEmail = uniqueEmail(`owner-${locale}`);
    const inviteeEmail = uniqueEmail(`invitee-${locale}`);

    // --- Owner ---
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();

    // Accessibility baseline on the login screen.
    await owner.goto(`/login?lng=${locale}`);
    const loginA11y = await new AxeBuilder({ page: owner }).analyze();
    expect(loginA11y.violations).toEqual([]);

    await signInAndRegister(owner, t, locale, ownerEmail, "Ada", "Lovelace");
    await expect(owner.getByRole("heading", { level: 1 })).toHaveText(t.app.homeTitle);
    await expectNoTokenInStorage(owner);

    // Edit profile + accessibility baseline on the profile screen.
    await owner.goto(`/app/profile?lng=${locale}`);
    const profileA11y = await new AxeBuilder({ page: owner }).analyze();
    expect(profileA11y.violations).toEqual([]);
    await owner.getByLabel(t.profile.firstName).fill("Augusta");
    await owner.getByRole("button", { name: t.common.save }).click();
    await expect(owner.getByText(t.profile.saved)).toBeVisible();

    // Create an organization.
    await owner.goto(`/organization?lng=${locale}`);
    await owner.getByLabel(t.organization.nameLabel).fill("Acme Health");
    await owner.getByRole("button", { name: t.organization.create }).click();
    await expect(owner.getByText("Acme Health", { exact: false })).toBeVisible();

    // Invite the second user and capture the invitation token.
    await owner.goto(`/organization/invitations?lng=${locale}`);
    await owner.getByLabel(t.organization.inviteEmailLabel).fill(inviteeEmail);
    await owner.getByRole("button", { name: t.organization.invite }).click();
    const token = (await owner.getByTestId("invite-token").textContent())?.trim() ?? "";
    expect(token.length).toBeGreaterThan(0);

    // --- Invitee ---
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    await signInAndRegister(invitee, t, locale, inviteeEmail, "Grace", "Hopper");

    await invitee.goto(`/organization/invitations?lng=${locale}`);
    await invitee.getByLabel(t.organization.tokenLabel).fill(token);
    await invitee.getByRole("button", { name: t.organization.accept }).click();
    await expect(invitee.getByText(t.organization.accepted)).toBeVisible();

    // Logout.
    await invitee.getByRole("button", { name: t.common.signOut }).click();
    await invitee.waitForURL("**/login");

    await ownerContext.close();
    await inviteeContext.close();
  });
}
