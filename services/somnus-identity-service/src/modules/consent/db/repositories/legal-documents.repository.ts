import { UUIDv7 } from "@somnus/api-contracts";
import { and, desc, eq } from "drizzle-orm";
import type { ConsentDb } from "../consent-db.client.js";
import { legalDocuments, legalDocumentVersions } from "../schema/index.js";
import type { ConsentPurposeKeyRow } from "./consent-purposes.repository.js";

type Locale = "es" | "en" | "ca" | "fr";

export class LegalDocumentsRepository {
  constructor(private readonly db: ConsentDb) {}

  async seedDocument(input: { purposeKey: ConsentPurposeKeyRow; name: string }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(legalDocuments).values({ id, ...input });
    return id;
  }

  async findByPurposeKey(purposeKey: ConsentPurposeKeyRow) {
    const rows = await this.db
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.purposeKey, purposeKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async publishVersion(input: {
    legalDocumentId: UUIDv7;
    version: number;
    locale: Locale;
    content: string;
    effectiveAt?: Date;
  }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(legalDocumentVersions).values({
      id,
      legalDocumentId: input.legalDocumentId,
      version: input.version,
      locale: input.locale,
      content: input.content,
      ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
    });
    return id;
  }

  /** The current version is the highest `version` published for that document+locale so far. */
  async findCurrentVersion(legalDocumentId: UUIDv7, locale: Locale) {
    const rows = await this.db
      .select()
      .from(legalDocumentVersions)
      .where(
        and(
          eq(legalDocumentVersions.legalDocumentId, legalDocumentId),
          eq(legalDocumentVersions.locale, locale),
        ),
      )
      .orderBy(desc(legalDocumentVersions.version))
      .limit(1);
    return rows[0] ?? null;
  }

  async findVersionById(id: UUIDv7) {
    const rows = await this.db
      .select()
      .from(legalDocumentVersions)
      .where(eq(legalDocumentVersions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listCurrentVersionsForLocale(locale: Locale) {
    const documents = await this.db.select().from(legalDocuments);
    const versions = await Promise.all(
      documents.map((document) => this.findCurrentVersion(document.id, locale)),
    );
    return versions.filter((v): v is NonNullable<typeof v> => v !== null);
  }

  /**
   * Locale-agnostic: a document's version number applies across every
   * translation of it, so "is this receipt superseded" compares
   * against the highest version published in ANY locale, not just the
   * one the receipt happened to be recorded in.
   */
  async findLatestVersionNumber(legalDocumentId: UUIDv7): Promise<number | null> {
    const rows = await this.db
      .select()
      .from(legalDocumentVersions)
      .where(eq(legalDocumentVersions.legalDocumentId, legalDocumentId))
      .orderBy(desc(legalDocumentVersions.version))
      .limit(1);
    return rows[0]?.version ?? null;
  }
}
