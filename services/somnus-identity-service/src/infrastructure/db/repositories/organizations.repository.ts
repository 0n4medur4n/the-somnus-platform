import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { organizationLocations, organizations } from "../schema/index.js";
import type { OrgScope } from "../tenant-scope.js";

export type NewOrganization = { name: string };
export type NewLocation = OrgScope & { name: string; address?: string };

/**
 * `organizations` is a root entity: findById is legitimate (you must
 * already know the org id -- there is no broader tenant above an
 * organization to scope by). `organization_locations` belongs to an
 * org, so every location method is OrgScope.
 */
export class OrganizationsRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewOrganization): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(organizations).values({ id, name: input.name });
    return id;
  }

  async findById(id: UUIDv7) {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** findById (not scope) is correct here -- see the class doc: organizations is a root entity. */
  async update(
    id: UUIDv7,
    patch: Partial<Pick<typeof organizations.$inferInsert, "name" | "status">>,
  ) {
    if (Object.keys(patch).length === 0) return;
    await this.db.update(organizations).set(patch).where(eq(organizations.id, id));
  }

  async addLocation(input: NewLocation): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(organizationLocations).values({
      id,
      organizationId: input.organizationId,
      name: input.name,
      address: input.address,
    });
    return id;
  }

  async listLocations(scope: OrgScope) {
    return this.db
      .select()
      .from(organizationLocations)
      .where(eq(organizationLocations.organizationId, scope.organizationId));
  }
}
