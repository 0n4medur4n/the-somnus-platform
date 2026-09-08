import { Inject, Injectable } from "@nestjs/common";
import { type AdminVerificationCase, makeEvent, type UUIDv7 } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { ProfessionalProfilesRepository } from "../../infrastructure/db/repositories/professional-profiles.repository.js";
import { RoleAssignmentsRepository } from "../../infrastructure/db/repositories/role-assignments.repository.js";
import { RolesRepository } from "../../infrastructure/db/repositories/roles.repository.js";
import {
  type EventPublisher,
  IDENTITY_EVENT_PUBLISHER,
} from "../../infrastructure/events/event-publisher.js";

/**
 * The professional verification queue (Addendum A Checkpoint 15.2, capability
 * `admin_verification_queue`).
 *
 * This is the gate Addendum A §A1 describes: "a professional who self-registers
 * is a normal individual until verified. The verification queue is the only way
 * to become a professional." Approving here is therefore the single moment at
 * which someone becomes able to reach another person's clinical data at all --
 * subject, still, to an access grant and the subject's consent (§11).
 */
@Injectable()
export class AdminVerificationService {
  constructor(
    private readonly professionalProfiles: ProfessionalProfilesRepository,
    private readonly roles: RolesRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    @Inject(IDENTITY_EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async queue(limit: number): Promise<AdminVerificationCase[]> {
    const rows = await this.professionalProfiles.listOpenVerificationCases(limit);
    return rows.slice(0, limit).map((row) => ({
      caseId: row.caseId,
      professionalProfileId: row.professionalProfileId,
      userId: row.userId,
      specialty: row.specialty,
      licenseNumber: row.licenseNumber,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
    }));
  }

  /**
   * Approving does two things that must not come apart: it marks the profile
   * verified AND grants the platform `professional` role. Either one alone
   * leaves the authorization policy denying access -- verified without the role
   * is `DENIED_PERMISSION_NOT_ASSIGNED`, the role without verification is
   * `DENIED_PROFESSIONAL_NOT_VERIFIED` -- so a half-completed approval would
   * read to the verifier as done while the professional still could not work.
   *
   * The reason is mandatory for both outcomes, including approval: an approval
   * that opened access to other people's health data with no recorded why is
   * exactly what an audit needs to be able to question later.
   */
  async decide(input: {
    caseId: UUIDv7;
    decision: "approve" | "reject";
    reason: string;
    reviewerId: UUIDv7;
    correlationId: string;
  }): Promise<AdminVerificationCase> {
    const existing = await this.professionalProfiles.findVerificationCase(input.caseId);
    if (!existing) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "No such verification case.", {
        correlationId: input.correlationId,
      });
    }

    const status = input.decision === "approve" ? "approved" : "rejected";
    const resolved = await this.professionalProfiles.resolveVerificationCase({
      caseId: input.caseId,
      status,
      reviewerId: input.reviewerId,
      notes: input.reason,
    });
    if (!resolved) {
      // Another verifier decided it first. Do not overwrite their decision.
      throw new SomnusError(ErrorCode.CONFLICT, "This case has already been decided.", {
        correlationId: input.correlationId,
      });
    }

    await this.professionalProfiles.setVerificationStatus(
      { userId: existing.userId },
      input.decision === "approve" ? "verified" : "rejected",
    );

    if (input.decision === "approve") {
      await this.grantProfessionalRole(existing.userId, input.reviewerId);
    }

    await this.events.publish(
      makeEvent({
        eventType: "admin.professional_verification.decided.v1",
        producer: "somnus-identity-service",
        correlationId: input.correlationId,
        actor: { type: "user", id: input.reviewerId },
        subject: { type: "verification_case", id: input.caseId },
        // The decision and how long it took -- the verification funnel of
        // Checkpoint 14.3. No licence number, no name, no reason text.
        data: {
          caseId: input.caseId,
          decision: input.decision === "approve" ? "approved" : "rejected",
          timeToDecisionMs: Math.max(0, Date.now() - existing.openedAt.getTime()),
        },
      }),
    );

    return {
      caseId: existing.caseId,
      professionalProfileId: existing.professionalProfileId,
      userId: existing.userId,
      specialty: existing.specialty,
      licenseNumber: existing.licenseNumber,
      status,
      openedAt: existing.openedAt.toISOString(),
    };
  }

  /** Platform-scoped, not organization-scoped: being a professional is not per-org. */
  private async grantProfessionalRole(userId: UUIDv7, reviewerId: UUIDv7): Promise<void> {
    const role = await this.roles.findByKey("professional");
    if (!role) {
      throw new SomnusError(ErrorCode.INTERNAL, "The professional role is not seeded.", {
        correlationId: "admin-verification",
      });
    }
    const held = await this.roleAssignments.listActiveForUser({ userId });
    if (held.some((assignment) => assignment.roleId === role.id)) return;

    await this.roleAssignments.assign({ userId, roleId: role.id, assignedBy: reviewerId });
  }
}
