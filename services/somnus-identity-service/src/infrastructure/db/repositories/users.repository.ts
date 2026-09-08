import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq, like, sql } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { userIdentities, users } from "../schema/index.js";

export type NewUser = {
  email: string;
  locale?: "es" | "en" | "ca" | "fr";
};

export type NewUserIdentity = {
  userId: UUIDv7;
  providerUserId: string;
};

/**
 * `users` is the root identity entity, not tenant data -- looking it
 * up by its own id is not the "unscoped tenant query" build plan §8
 * forbids (that rule is about data that BELONGS TO a user/org, looked
 * up without naming which one). See tenant-scope.ts.
 */
export class UsersRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewUser): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(users).values({ id, email: input.email, locale: input.locale ?? "es" });
    return id;
  }

  async findById(id: UUIDv7) {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * The admin console's user search (Addendum A §A2.2 `admin_users_read`).
   *
   * Deliberately NOT UserScope: finding a person you do not yet have an id for
   * is the whole operation, and it is gated by the capability matrix rather
   * than by scope. It returns account metadata only -- no profile, no clinical
   * anything (§A2.3) -- and it always bounds the result, because an admin
   * screen must never be able to page through the entire user table.
   *
   * `limit + 1` is fetched so the caller can tell a full page from a truncated
   * one and say "narrow your search" instead of silently hiding people.
   */
  async searchForAdmin(filter: {
    email?: string;
    status?: (typeof users.status.enumValues)[number];
    limit: number;
  }) {
    const conditions = [
      ...(filter.email ? [like(users.email, `%${filter.email}%`)] : []),
      ...(filter.status ? [eq(users.status, filter.status)] : []),
    ];
    return this.db
      .select({
        id: users.id,
        email: users.email,
        locale: users.locale,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : sql`1 = 1`)
      .orderBy(users.createdAt)
      .limit(filter.limit + 1);
  }

  async findByEmail(email: string) {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  /** Build plan §20 Checkpoint 6.3: fixture support for the deleted/suspended-actor negative tests. */
  async setStatus(id: UUIDv7, status: (typeof users.status.enumValues)[number]): Promise<void> {
    await this.db.update(users).set({ status }).where(eq(users.id, id));
  }

  async linkIdentity(input: NewUserIdentity): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db
      .insert(userIdentities)
      .values({ id, userId: input.userId, providerUserId: input.providerUserId });
    return id;
  }

  async findByProviderUserId(providerUserId: string) {
    const rows = await this.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.providerUserId, providerUserId))
      .limit(1);
    return rows[0] ?? null;
  }
}
