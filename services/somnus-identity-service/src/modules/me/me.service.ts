import { Injectable } from "@nestjs/common";
import {
  INTERNAL_ROLE_KEYS,
  type MeAccount,
  type MeResponse,
  type ProfilePatchRequest,
  type RoleKey,
  type UUIDv7,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { IndividualProfilesRepository } from "../../infrastructure/db/repositories/individual-profiles.repository.js";
import { OrganizationMembershipsRepository } from "../../infrastructure/db/repositories/organization-memberships.repository.js";
import { OrganizationsRepository } from "../../infrastructure/db/repositories/organizations.repository.js";
import { ProfessionalProfilesRepository } from "../../infrastructure/db/repositories/professional-profiles.repository.js";
import { RoleAssignmentsRepository } from "../../infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../infrastructure/db/repositories/roles.repository.js";
import { UsersRepository } from "../../infrastructure/db/repositories/users.repository.js";

@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly individualProfiles: IndividualProfilesRepository,
    private readonly professionalProfiles: ProfessionalProfilesRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    private readonly roles: RolesRepository,
  ) {}

  async getMe(userId: UUIDv7): Promise<MeResponse> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "User not found.", { correlationId: "me" });
    }

    const [individual, professional, account] = await Promise.all([
      this.individualProfiles.findByUser({ userId }),
      this.professionalProfiles.findByUser({ userId }),
      this.accountOf(userId),
    ]);

    return {
      user: { id: user.id, email: user.email, locale: user.locale, status: user.status },
      individualProfile: individual
        ? {
            firstName: individual.firstName,
            lastName: individual.lastName,
            ...(individual.dateOfBirth ? { dateOfBirth: individual.dateOfBirth } : {}),
            ...(individual.phone ? { phone: individual.phone } : {}),
            ...(individual.photoUpdatedAt
              ? { photoUpdatedAt: individual.photoUpdatedAt.toISOString() }
              : {}),
          }
        : null,
      professionalProfile: professional
        ? {
            specialty: professional.specialty,
            licenseNumber: professional.licenseNumber,
            verificationStatus: professional.verificationStatus,
          }
        : null,
      account: {
        registrationRole: individual?.registrationRole ?? null,
        ...account,
      },
    };
  }

  /**
   * Staff roles and organizations, read with the user id as the scope (build
   * plan §8). Internal roles are reported only so the app can point staff at
   * the console; the console's own capability check still decides every action.
   */
  private async accountOf(userId: UUIDv7): Promise<Omit<MeAccount, "registrationRole">> {
    const [memberships, assignments] = await Promise.all([
      this.memberships.listMembershipsForUser(userId),
      this.roleAssignments.listActiveForUser({ userId }),
    ]);

    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const roleRows = roleIds.length > 0 ? await this.roles.findManyByIds(roleIds) : [];
    const keyOf = new Map<string, RoleKey>(roleRows.map((row) => [row.id, row.key]));
    const heldKeys = (organizationId: string): RoleKey[] => [
      ...new Set(
        assignments
          .filter((a) => a.organizationId === organizationId)
          .map((a) => keyOf.get(a.roleId))
          .filter((key): key is RoleKey => key !== undefined),
      ),
    ];

    const internalRoles = [
      ...new Set(
        assignments
          .map((a) => keyOf.get(a.roleId))
          .filter((key): key is RoleKey => key !== undefined && INTERNAL_ROLE_KEYS.has(key)),
      ),
    ];

    const active = memberships.filter((m) => m.status === "active");
    const orgRows = await Promise.all(
      active.map((m) => this.organizations.findById(m.organizationId)),
    );
    const organizations = orgRows
      .filter((org) => org !== null)
      .map((org) => ({
        id: org.id,
        name: org.name,
        status: org.status,
        roleKeys: heldKeys(org.id).filter((key) => !INTERNAL_ROLE_KEYS.has(key)),
      }));

    return { internalRoles, organizations };
  }

  /**
   * Individual-profile fields, plus the preferred language (stored on the user).
   * License/specialty go through verification, not a plain patch.
   */
  async patchProfile(userId: UUIDv7, patch: ProfilePatchRequest): Promise<void> {
    const existing = await this.individualProfiles.findByUser({ userId });
    if (!existing) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Individual profile not found.", {
        correlationId: "me",
      });
    }
    // Zod's .optional() types a field as `T | undefined`, not merely
    // absent; exactOptionalPropertyTypes then rejects passing that
    // straight through to a plain `field?: T` target. Re-build the
    // patch with only the keys actually present.
    await this.individualProfiles.patch(
      { userId },
      {
        ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.dateOfBirth !== undefined ? { dateOfBirth: patch.dateOfBirth } : {}),
      },
    );
    if (patch.locale !== undefined) {
      await this.users.setLocale(userId, patch.locale);
    }
  }

  /**
   * edge-api stored or removed the photo in its bucket; record only whether
   * there is one, and when it changed (the app's cache key).
   */
  async setPhotoState(userId: UUIDv7, present: boolean): Promise<void> {
    const existing = await this.individualProfiles.findByUser({ userId });
    if (!existing) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Individual profile not found.", {
        correlationId: "me",
      });
    }
    await this.individualProfiles.setPhotoUpdatedAt({ userId }, present ? new Date() : null);
  }
}
