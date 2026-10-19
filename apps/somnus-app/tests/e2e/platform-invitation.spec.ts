import {
  createDb,
  createPool,
} from "../../../../services/somnus-identity-service/src/infrastructure/db/db.client.js";
import { loadDbConfig } from "../../../../services/somnus-identity-service/src/infrastructure/db/db.config.js";
import {
  ProfessionalProfilesRepository,
  RoleAssignmentsRepository,
  RolesRepository,
  UsersRepository,
} from "../../../../services/somnus-identity-service/src/infrastructure/db/repositories/index.js";
import ca from "../../src/i18n/locales/ca.json" with { type: "json" };
import es from "../../src/i18n/locales/es.json" with { type: "json" };
import { fillAboutYou } from "./support/about.js";
import { expect, test } from "./support/console.js";
import { getSignInLink, uniqueEmail } from "./support/emulator.js";

// Fixture writes are permitted only to the disposable full-stack database.
// Never seed or inspect real users: all addresses below are unique @example.com.
const config = loadDbConfig(process.env);
const target = new URL(config.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/somnus_identity"
)
  throw new Error("Morpheo invitation E2E requires disposable loopback MySQL.");
const pool = createPool(config);
const db = createDb(pool);
const users = new UsersRepository(db);
const roles = new RolesRepository(db);
const assignments = new RoleAssignmentsRepository(db);
const identityUrl = "http://localhost:3001";
test.afterAll(async () => pool.end());

for (const locale of ["es", "ca"] as const) {
  for (const branch of ["adult", "professional"] as const) {
    test(`Morpheo invitation ${locale}: ${branch}, new and existing account`, async ({
      page,
      request,
    }) => {
      const t = locale === "ca" ? ca : es;
      const adminId = await users.create({
        email: uniqueEmail(`invite-admin-${locale}-${branch}`),
      });
      const role = await roles.findByKey("platform_super_admin");
      if (!role) throw new Error("Missing reference role");
      await assignments.assign({ userId: adminId, roleId: role.id, assignedBy: null });
      const email = uniqueEmail(`morpheo-invite-${locale}-${branch}`);
      const create = await request.post(`${identityUrl}/internal/v1/admin/platform-invitations`, {
        headers: { "x-somnus-actor-id": adminId },
        data: { firstName: "Ana", lastName: "Garcia", email, role: branch, locale },
      });
      expect(create.status()).toBe(201);
      const invitation = (await create.json()) as { id: string };
      expect(await users.findByEmail(email)).toBeNull();

      await page.goto(`/login?lng=${locale}`);
      await page.getByLabel(t.login.emailLabel, { exact: true }).fill(email);
      await page.getByRole("button", { name: t.login.sendLink }).click();
      await expect(page.getByRole("status")).toContainText(email);
      const source = new URL(await getSignInLink(email));
      const callback = new URL("/auth/callback", page.url());
      callback.searchParams.set("mode", "signIn");
      callback.searchParams.set("oobCode", source.searchParams.get("oobCode") ?? "");
      callback.searchParams.set("platformInvitation", invitation.id);
      callback.searchParams.set("lng", locale);
      await page.goto(callback.toString());
      await expect(page.getByLabel(t.register.firstName, { exact: true })).toHaveValue("Ana");
      await expect(page.getByLabel(t.register.lastName, { exact: true })).toHaveValue("Garcia");
      await page.getByRole("button", { name: t.register.next }).click();
      await fillAboutYou(page, t);
      if (branch === "professional") {
        await page
          .getByLabel(t.register.specialtyLabel, { exact: true })
          .selectOption("family_physician");
        await page.getByLabel(t.register.licenseLabel, { exact: true }).fill("TEST-MORPHEO");
      } else await page.getByLabel(t.register.ageLabel, { exact: true }).fill("40");
      await expect(page.getByLabel(t.register.consentTerms)).not.toBeChecked();
      await expect(page.getByLabel(t.register.consentPrivacy)).not.toBeChecked();
      await page.getByLabel(t.register.consentTerms).check();
      await page.getByLabel(t.register.consentPrivacy).check();
      await page.getByRole("button", { name: t.register.submit }).click();
      await page.waitForURL(/\/(app|assessment)(?:[/?]|$)/);
      const account = await users.findByEmail(email);
      expect(account?.status).toBe("active");
      if (!account) throw new Error("Invited account absent");
      expect(await assignments.listActiveForUser({ userId: account.id })).toHaveLength(0);
      if (branch === "professional")
        expect(
          (await new ProfessionalProfilesRepository(db).findByUser({ userId: account.id }))
            ?.verificationStatus,
        ).toBe("pending");

      // Accept again as an existing account: no registration, no profile or locale overwrite.
      const second = await request.post(`${identityUrl}/internal/v1/admin/platform-invitations`, {
        headers: { "x-somnus-actor-id": adminId },
        data: { firstName: "Changed", lastName: "Ignored", email, role: "adult", locale: "fr" },
      });
      expect(second.status()).toBe(201);
      const next = (await second.json()) as { id: string };
      await page.goto(`/auth/callback?platformInvitation=${next.id}&lng=${locale}`);
      await page.getByRole("button", { name: t.platformInvite.accept }).click();
      await page.waitForURL(/\/(app|assessment)(?:[/?]|$)/);
      expect((await users.findByEmail(email))?.locale).toBe(locale);
      await page.goto(`/auth/callback?platformInvitation=${next.id}&lng=${locale}`);
      await expect(page.getByRole("alert")).toHaveText(t.invitation.errors.alreadyUsed);
      await expect(page.getByLabel(t.register.firstName, { exact: true })).toHaveCount(0);
    });
  }
}
