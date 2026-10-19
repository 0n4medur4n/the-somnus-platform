import { type Bucket, Storage } from "@google-cloud/storage";
import { ErrorCode, SomnusError } from "@somnus/errors";

/**
 * Where the staff Drive keeps everything (owner decision 2026-10-18, ADR 0019):
 * objects in one private Cloud Storage bucket, no database.
 *
 * The Drive needs exactly four operations, and one guarantee: a write can be
 * made conditional on the object's current generation. That compare-and-swap is
 * what keeps a folder's manifest consistent when two people change it at once,
 * and what makes a key rotation a single atomic write.
 */
export type StoredObject = { data: Buffer; generation: string };

/** The generation that means "this object must not exist yet". */
export const MUST_NOT_EXIST = "0";

export class PreconditionFailed extends Error {
  constructor(readonly objectName: string) {
    super(`precondition failed: ${objectName}`);
    this.name = "PreconditionFailed";
  }
}

export interface ObjectStore {
  /** False only for a deployed worker with no bucket configured. */
  readonly configured: boolean;
  get(name: string): Promise<StoredObject | null>;
  /** With `ifGeneration`, the write happens only if the object is still at it. */
  put(name: string, data: Buffer, options?: { ifGeneration?: string }): Promise<void>;
  /** Idempotent: deleting what is not there succeeds. */
  delete(name: string): Promise<void>;
  list(prefix: string): Promise<Array<{ name: string; size: number }>>;
}

/** Deletes everything under a prefix. Returns how many objects went. */
export async function deletePrefix(store: ObjectStore, prefix: string): Promise<number> {
  const objects = await store.list(prefix);
  await Promise.all(objects.map((o) => store.delete(o.name)));
  return objects.length;
}

function statusOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/**
 * The private bucket. Credentials are the worker's own identity on Cloud Run;
 * the worker holds no key. Objects are ciphertext, public keys and folder
 * manifests -- nothing the platform can read.
 */
export class GcsObjectStore implements ObjectStore {
  readonly configured = true;
  private readonly bucket: Bucket;

  constructor(bucketName: string, storage: Storage = new Storage()) {
    this.bucket = storage.bucket(bucketName);
  }

  async get(name: string): Promise<StoredObject | null> {
    try {
      const [metadata] = await this.bucket.file(name).getMetadata();
      const generation = String(metadata.generation);
      // Read exactly the generation just seen, so data and generation agree.
      const [data] = await this.bucket.file(name, { generation }).download();
      return { data, generation };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async put(name: string, data: Buffer, options: { ifGeneration?: string } = {}): Promise<void> {
    try {
      await this.bucket.file(name).save(data, {
        resumable: false,
        contentType: "application/octet-stream",
        metadata: { cacheControl: "private, no-store" },
        ...(options.ifGeneration !== undefined
          ? { preconditionOpts: { ifGenerationMatch: Number(options.ifGeneration) } }
          : {}),
      });
    } catch (error) {
      if (statusOf(error) !== 412) throw error;
      // The SDK retries a conditional write by itself (a precondition makes it
      // idempotent). When the first attempt landed but its answer was lost -- a
      // cold start, a reset connection -- the retry meets OUR OWN write and gets
      // 412. Seen in production on 2026-10-18: the Drive account was created and
      // the person was told it already existed. If what is stored now is exactly
      // what this call wrote, the write succeeded; anything else is a real conflict.
      if (await this.holds(name, data)) return;
      throw new PreconditionFailed(name);
    }
  }

  private async holds(name: string, data: Buffer): Promise<boolean> {
    try {
      const [current] = await this.bucket.file(name).download();
      return current.equals(data);
    } catch {
      return false;
    }
  }

  async delete(name: string): Promise<void> {
    await this.bucket.file(name).delete({ ignoreNotFound: true });
  }

  async list(prefix: string): Promise<Array<{ name: string; size: number }>> {
    const [files] = await this.bucket.getFiles({ prefix, autoPaginate: true });
    return files.map((f) => ({ name: f.name, size: Number(f.metadata.size ?? 0) }));
  }
}

/** Local development and tests: the same semantics, in one process. */
export class MemoryObjectStore implements ObjectStore {
  readonly configured = true;
  private readonly objects = new Map<string, StoredObject>();
  private nextGeneration = 1;

  async get(name: string): Promise<StoredObject | null> {
    const found = this.objects.get(name);
    return found ? { data: Buffer.from(found.data), generation: found.generation } : null;
  }

  async put(name: string, data: Buffer, options: { ifGeneration?: string } = {}): Promise<void> {
    if (options.ifGeneration !== undefined) {
      const current = this.objects.get(name)?.generation ?? MUST_NOT_EXIST;
      if (current !== options.ifGeneration) throw new PreconditionFailed(name);
    }
    this.nextGeneration += 1;
    this.objects.set(name, { data: Buffer.from(data), generation: String(this.nextGeneration) });
  }

  async delete(name: string): Promise<void> {
    this.objects.delete(name);
  }

  async list(prefix: string): Promise<Array<{ name: string; size: number }>> {
    return [...this.objects.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, o]) => ({ name, size: o.data.length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Tests only: every object name, to assert what is (and is not) stored. */
  names(): string[] {
    return [...this.objects.keys()].sort();
  }
}

/**
 * A deployed worker with no bucket. Memory would lose the Drive on every
 * restart, so it refuses instead -- except that there is nothing to erase,
 * which account deletion learns from `configured`.
 */
export class UnconfiguredObjectStore implements ObjectStore {
  readonly configured = false;

  private fail(): never {
    throw new SomnusError(ErrorCode.CONFIGURATION_INVALID, "The Drive is not configured.", {
      correlationId: "drive",
    });
  }

  async get(): Promise<StoredObject | null> {
    this.fail();
  }

  async put(): Promise<void> {
    this.fail();
  }

  async delete(): Promise<void> {
    this.fail();
  }

  async list(): Promise<Array<{ name: string; size: number }>> {
    this.fail();
  }
}

export function createObjectStore(
  bucketName: string | undefined,
  nodeEnv: string | undefined,
): ObjectStore {
  if (bucketName) return new GcsObjectStore(bucketName);
  return nodeEnv === "production" ? new UnconfiguredObjectStore() : new MemoryObjectStore();
}
