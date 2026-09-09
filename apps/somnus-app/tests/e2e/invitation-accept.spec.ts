import type { Page } from "@playwright/test";
import ca from "../../src/i18n/locales/ca.json" with { type: "json" };
import es from "../../src/i18n/locales/es.json" with { type: "json" };
import { expect, test } from "./support/console.js";
import { escapeRe, getSignInLink, uniqueEmail } from "./support/emulator.js";

type Dict = typeof es;
const DICTS: Record<string, Dict> = { es, ca };

/** i18next interpolation, for asserting copy that carries a variable. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/**
 * Addendum A §A1 / Checkpoint 14.2, end to end against the live dev stack in
 * `es` and `ca`: an organization owner invites a brand-new email, and that
 * person gets in through the invitation link and nothing else -- magic link,
 * registration with the branch locked to professional, membership attached.
 *
 * The same link is then replayed to prove single use, and a made-up token is
 * refused, with neither screen offering a way to register anyway.
 */
async function registerOwner(page: Page, locale: string, email: string): Promise<void> {
  const t = DICTS[locale] as Dict;
  await page.goto(`/login?lng=${locale}`);
  await page.getByLabel(t.login.emailLabel, { exact: true }).fill(email);
  await page.getByRole("button", { name: t.login.sendLink }).click();
  await expect(page.getByRole("status")).toContainText(email);

  await page.goto(await getSignInLink(email));

  await page.getByLabel(t.register.firstName, { exact: true }).fill("Ada");
  await page.getByLabel(t.register.lastName, { exact: true }).fill("Lovelace");
  await page.getByRole("button", { name: t.register.next }).click();
  await page.getByRole("radio", { name: new RegExp(escapeRe(t.register.roleAdult)) }).check();
  await page.getByRole("button", { name: t.register.next }).click();
  await page.getByLabel(t.register.ageLabel, { exact: true }).fill("40");
  await page.getByLabel(t.register.consentTerms, { exact: true }).check();
  await page.getByLabel(t.register.consentPrivacy, { exact: true }).check();
  await page.getByRole("button", { name: t.register.submit }).click();
  await page.waitForURL("**/app");
}

for (const locale of ["es", "ca"] as const) {
  const t = DICTS[locale] as Dict;
  const ORGANIZATION = "Nox Research Lab";

  test(`invitation in ${locale}: a new email joins through the link, and only through it`, async ({
    browser,
  }) => {
    const ownerEmail = uniqueEmail(`nox-owner-${locale}`);
    const inviteeEmail = uniqueEmail(`nox-invitee-${locale}`);

    // --- Owner: create the organization and issue the invitation ---
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await registerOwner(owner, locale, ownerEmail);

    await owner.goto(`/organization?lng=${locale}`);
    await owner.getByLabel(t.organization.nameLabel, { exact: true }).fill(ORGANIZATION);
    await owner.getByRole("button", { name: t.organization.create }).click();
    await expect(owner.getByText(ORGANIZATION, { exact: false })).toBeVisible();

    await owner.goto(`/organization/invitations?lng=${locale}`);
    await owner.getByLabel(t.organization.inviteEmailLabel, { exact: true }).fill(inviteeEmail);
    await owner.getByRole("button", { name: t.organization.invite }).click();
    const token = (await owner.getByTestId("invite-token").textContent())?.trim() ?? "";
    expect(token.length).toBeGreaterThan(0);

    // --- Invitee: a brand-new email, arriving from the invitation link ---
    const inviteeContext = await browser.newContext();
    const invitee = await inviteeContext.newPage();
    const acceptUrl = `/invitation/accept?token=${encodeURIComponent(token)}&lng=${locale}`;
    await invitee.goto(acceptUrl);

    // The organization is named before any sign-in has happened.
    await expect(
      invitee.getByText(interpolate(t.invitation.invitedTo, { organization: ORGANIZATION })),
    ).toBeVisible();

    // The address is fixed by the invitation, not chosen here.
    const emailField = invitee.getByLabel(t.invitation.emailLabel, { exact: true });
    await expect(emailField).toHaveValue(inviteeEmail);
    await expect(emailField).toHaveAttribute("readonly", "");

    await invitee.getByRole("button", { name: t.invitation.continueCta }).click();
    await expect(invitee.getByRole("status")).toContainText(inviteeEmail);

    // Magic link -> registration, with the branch locked to professional.
    await invitee.goto(await getSignInLink(inviteeEmail));

    await expect(invitee.getByRole("heading", { level: 1 })).toHaveText(t.register.nameTitle);
    // Two steps, not three: there is no role to choose.
    await expect(
      invitee.getByText(interpolate(t.register.stepOf, { current: "1", total: "2" })),
    ).toBeVisible();

    await invitee.getByLabel(t.register.firstName, { exact: true }).fill("Rosalind");
    await invitee.getByLabel(t.register.lastName, { exact: true }).fill("Franklin");
    await invitee.getByRole("button", { name: t.register.next }).click();

    // Straight to the professional branch, which says why it was not offered.
    await expect(invitee.getByRole("heading", { level: 1 })).toHaveText(
      t.register.professionalTitle,
    );
    await expect(invitee.getByText(t.register.lockedNotice)).toBeVisible();
    await expect(invitee.getByText(t.register.verificationNotice)).toBeVisible();

    await invitee
      .getByLabel(t.register.specialtyLabel, { exact: true })
      .selectOption("sleep_physician");
    await invitee.getByLabel(t.register.licenseLabel, { exact: true }).fill("COL-NOX-1");
    await invitee.getByLabel(t.register.consentTerms, { exact: true }).check();
    await invitee.getByLabel(t.register.consentPrivacy, { exact: true }).check();
    await invitee.getByRole("button", { name: t.register.submit }).click();

    // Back on the accept screen, now signed in: join the organization.
    await invitee.waitForURL("**/invitation/accept**");
    await invitee
      .getByRole("button", {
        name: interpolate(t.invitation.acceptCta, { organization: ORGANIZATION }),
      })
      .click();
    await expect(
      invitee.getByText(interpolate(t.invitation.accepted, { organization: ORGANIZATION })),
    ).toBeVisible();

    // Single use: the same link is dead now, and says so plainly.
    await invitee.goto(acceptUrl);
    await expect(invitee.getByRole("heading", { level: 1 })).toHaveText(t.invitation.errorTitle);
    await expect(invitee.getByRole("alert")).toHaveText(t.invitation.errors.alreadyUsed);
    await expect(invitee.getByText(t.invitation.noOpenSignup)).toBeVisible();

    // The owner sees exactly two members: themselves and the invitee. Scoped
    // to the member list -- the app shell's nav is a list of <li> too.
    await owner.goto(`/organization/members?lng=${locale}`);
    await expect(owner.getByTestId("member-list").getByRole("listitem")).toHaveCount(2);

    await ownerContext.close();
    await inviteeContext.close();
  });

  test(`invitation in ${locale}: an invalid token is refused with no way to register anyway`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/invitation/accept?token=not-a-real-token&lng=${locale}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.invitation.errorTitle);
    await expect(page.getByRole("alert")).toHaveText(t.invitation.errors.notFound);
    await expect(page.getByText(t.invitation.noOpenSignup)).toBeVisible();

    // Nowhere to go: no continue button, and the only link is the skip link.
    await expect(page.getByRole("button", { name: t.invitation.continueCta })).toHaveCount(0);
    const hrefs = await page
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["#main"]);

    await context.close();
  });
}
