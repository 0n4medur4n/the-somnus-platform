import {
  type PlatformInvitationCreateRequest,
  type RegistrationRequest,
  UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db.client.js";
import {
  individualProfiles,
  platformInvitations,
  professionalProfiles,
  professionalVerificationCases,
  userIdentities,
  users,
} from "../schema/index.js";

export type PlatformInvitationRow = typeof platformInvitations.$inferSelect;
type InviteeScope = { invitationId: string; email: string; providerUserId: string };
const refusal = (
  code:
    | "INVITATION_NOT_FOUND"
    | "INVITATION_ALREADY_USED"
    | "INVITATION_EXPIRED"
    | "CONFLICT"
    | "FORBIDDEN"
    | "VALIDATION_FAILED",
) =>
  new SomnusError(ErrorCode[code], "Invitation cannot be accepted.", {
    correlationId: "platform-invitation",
  });

/** Platform-wide administrative records; invitee reads require a verified address and invitation id. */
export class PlatformInvitationsRepository {
  constructor(private readonly db: Db) {}

  async create(
    input: PlatformInvitationCreateRequest,
    invitedBy: string,
  ): Promise<PlatformInvitationRow> {
    const id = UUIDv7();
    await this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(platformInvitations)
        .where(
          and(
            eq(platformInvitations.email, input.email),
            eq(platformInvitations.status, "pending"),
          ),
        )
        .for("update");
      if (
        previous?.preparedUserId &&
        (previous.role !== input.role || previous.locale !== input.locale)
      )
        throw refusal("CONFLICT");
      await tx
        .update(platformInvitations)
        .set({ status: "revoked", pendingEmail: null })
        .where(
          and(
            eq(platformInvitations.email, input.email),
            eq(platformInvitations.status, "pending"),
          ),
        );
      await tx.insert(platformInvitations).values({
        ...input,
        id,
        invitedBy,
        pendingEmail: input.email,
        preparedUserId: previous?.preparedUserId ?? null,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      });
    });
    const row = await this.find(id);
    if (!row) throw refusal("CONFLICT");
    return row;
  }

  async recoverable(email: string) {
    return (
      (
        await this.db
          .select()
          .from(platformInvitations)
          .where(
            and(eq(platformInvitations.email, email), eq(platformInvitations.status, "pending")),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async find(invitationId: string) {
    return (
      (
        await this.db
          .select()
          .from(platformInvitations)
          .where(eq(platformInvitations.id, invitationId))
          .limit(1)
      )[0] ?? null
    );
  }

  async list() {
    return this.db
      .select()
      .from(platformInvitations)
      .orderBy(desc(platformInvitations.createdAt))
      .limit(100);
  }

  async revoke(invitationId: string): Promise<boolean> {
    const result = await this.db
      .update(platformInvitations)
      .set({ status: "revoked", pendingEmail: null })
      .where(
        and(eq(platformInvitations.id, invitationId), eq(platformInvitations.status, "pending")),
      );
    return (result[0].affectedRows ?? 0) === 1;
  }

  /** All identity writes are atomic; a new account stays suspended until consent and acceptance complete. */
  async prepare(scope: InviteeScope, registration?: RegistrationRequest) {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(platformInvitations)
        .where(
          and(
            eq(platformInvitations.id, scope.invitationId),
            eq(platformInvitations.email, scope.email),
          ),
        )
        .for("update");
      if (!invitation) throw refusal("INVITATION_NOT_FOUND");
      if (invitation.status !== "pending") throw refusal("INVITATION_ALREADY_USED");
      if (invitation.expiresAt.getTime() <= Date.now()) throw refusal("INVITATION_EXPIRED");
      const [linked] = await tx
        .select({ user: users })
        .from(userIdentities)
        .innerJoin(users, eq(users.id, userIdentities.userId))
        .where(eq(userIdentities.providerUserId, scope.providerUserId));
      if (linked) {
        const prepared = invitation.preparedUserId === linked.user.id;
        if (
          linked.user.email.toLowerCase() !== scope.email ||
          (linked.user.status !== "active" && !(prepared && linked.user.status === "suspended"))
        )
          throw refusal("FORBIDDEN");
        if (prepared && !registration) throw refusal("VALIDATION_FAILED");
        return { userId: linked.user.id, locale: linked.user.locale, prepared };
      }
      if (!registration || registration.role !== invitation.role)
        throw refusal("VALIDATION_FAILED");
      const [other] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, scope.email));
      if (other) throw refusal("CONFLICT");
      const userId = UUIDv7();
      const locale = registration.locale ?? invitation.locale;
      await tx
        .insert(users)
        .values({ id: userId, email: scope.email, locale, status: "suspended" });
      await tx
        .insert(userIdentities)
        .values({ id: UUIDv7(), userId, providerUserId: scope.providerUserId });
      await tx.insert(individualProfiles).values({
        id: UUIDv7(),
        userId,
        firstName: registration.firstName,
        lastName: registration.lastName,
        gender: registration.gender,
        country: registration.country,
        dateOfBirth: registration.dateOfBirth,
        city: registration.city ?? null,
        phone: registration.phone ?? null,
        registrationRole: registration.role,
      });
      if (registration.role === "professional") {
        const profileId = UUIDv7();
        await tx.insert(professionalProfiles).values({
          id: profileId,
          userId,
          specialty: registration.specialty,
          licenseNumber: registration.licenseNumber,
        });
        await tx
          .insert(professionalVerificationCases)
          .values({ id: UUIDv7(), professionalProfileId: profileId });
      }
      await tx
        .update(platformInvitations)
        .set({ preparedUserId: userId })
        .where(eq(platformInvitations.id, invitation.id));
      return { userId, locale, prepared: true };
    });
  }

  /** CAS after Consent's public interface succeeded. Revocation/expiry wins over an in-flight acceptance. */
  async complete(scope: InviteeScope & { userId: string; prepared: boolean }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const result = await tx
        .update(platformInvitations)
        .set({ status: "accepted", pendingEmail: null, acceptedAt: new Date() })
        .where(
          and(
            eq(platformInvitations.id, scope.invitationId),
            eq(platformInvitations.email, scope.email),
            eq(platformInvitations.status, "pending"),
            gt(platformInvitations.expiresAt, new Date()),
          ),
        );
      if ((result[0].affectedRows ?? 0) !== 1) throw refusal("INVITATION_ALREADY_USED");
      if (scope.prepared) {
        const activated = await tx
          .update(users)
          .set({ status: "active" })
          .where(and(eq(users.id, scope.userId), eq(users.status, "suspended")));
        if ((activated[0].affectedRows ?? 0) !== 1) throw refusal("CONFLICT");
      }
    });
  }
}
