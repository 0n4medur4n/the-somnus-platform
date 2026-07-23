import { Injectable } from "@nestjs/common";
import type { AccessGrant, AccessGrantCreateRequest, UUIDv7 } from "@somnus/api-contracts";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
import { AccessGrantsRepository } from "../../infrastructure/db/repositories/access-grants.repository.js";

/** Self-service: the actor is always the subject granting access over their own data (build plan §11). */
@Injectable()
export class AccessGrantsService {
  constructor(private readonly accessGrants: AccessGrantsRepository) {}

  async createForActor(actorId: UUIDv7, input: AccessGrantCreateRequest): Promise<AccessGrant> {
    const id = await this.accessGrants.create({
      userId: actorId,
      professionalUserId: input.professionalUserId,
      grantedBy: actorId,
      scope: input.scope,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
    });
    return {
      id,
      professionalUserId: input.professionalUserId,
      subjectUserId: actorId,
      scope: input.scope,
      status: "active",
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
  }

  async listForActor(actorId: UUIDv7): Promise<AccessGrant[]> {
    const rows = await this.accessGrants.listActiveForSubject({ userId: actorId });
    return rows.map((row) => ({
      id: row.id,
      professionalUserId: row.professionalUserId,
      subjectUserId: row.subjectUserId,
      scope: row.scope,
      status: row.status,
      ...(row.organizationId ? { organizationId: row.organizationId } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    }));
  }

  async revokeForActor(actorId: UUIDv7, grantId: UUIDv7): Promise<void> {
    await this.accessGrants.revoke({ userId: actorId, grantId });
  }
}
