import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
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
