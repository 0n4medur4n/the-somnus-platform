import { Storage } from "@google-cloud/storage";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ProfilePhotoType } from "../../modules/me/profile-photo.js";

export const PROFILE_PHOTO_STORE = Symbol("PROFILE_PHOTO_STORE");

export type StoredPhoto = { bytes: Buffer; type: ProfilePhotoType };

/**
 * Where profile photos live. One object per person, named by their opaque
 * Somnus user id -- never their name or email -- so the key reveals nothing
 * and a person can only ever reach their own (the id comes from the session).
 */
export interface ProfilePhotoStore {
  put(userId: string, photo: StoredPhoto): Promise<void>;
  get(userId: string): Promise<StoredPhoto | null>;
  /** Idempotent: removing a photo that is not there succeeds. */
  remove(userId: string): Promise<void>;
}

const objectName = (userId: string): string => `profile-photos/${userId}`;

/**
 * The private Cloud Storage bucket (build plan §388: never public, reached
 * only through authenticated endpoints). Credentials are the service's own
 * identity on Cloud Run; edge-api holds no key.
 */
export class GcsProfilePhotoStore implements ProfilePhotoStore {
  private readonly bucket;

  constructor(bucketName: string, storage: Storage = new Storage()) {
    this.bucket = storage.bucket(bucketName);
  }

  async put(userId: string, photo: StoredPhoto): Promise<void> {
    await this.bucket.file(objectName(userId)).save(photo.bytes, {
      resumable: false,
      contentType: photo.type,
      metadata: { cacheControl: "private, no-store" },
    });
  }

  async get(userId: string): Promise<StoredPhoto | null> {
    const file = this.bucket.file(objectName(userId));
    try {
      const [bytes] = await file.download();
      const [metadata] = await file.getMetadata();
      const type = metadata.contentType === "image/jpeg" ? "image/jpeg" : "image/webp";
      return { bytes, type };
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async remove(userId: string): Promise<void> {
    await this.bucket.file(objectName(userId)).delete({ ignoreNotFound: true });
  }
}

/** Local development and tests: one process, no bucket. */
export class InMemoryProfilePhotoStore implements ProfilePhotoStore {
  private readonly photos = new Map<string, StoredPhoto>();

  async put(userId: string, photo: StoredPhoto): Promise<void> {
    this.photos.set(userId, { bytes: Buffer.from(photo.bytes), type: photo.type });
  }

  async get(userId: string): Promise<StoredPhoto | null> {
    return this.photos.get(userId) ?? null;
  }

  async remove(userId: string): Promise<void> {
    this.photos.delete(userId);
  }
}

/**
 * A deployed edge-api without a bucket configured. Memory would lose photos
 * between instances and on every restart, so a production process refuses
 * instead of pretending.
 */
export class UnconfiguredProfilePhotoStore implements ProfilePhotoStore {
  private fail(): never {
    throw new SomnusError(ErrorCode.CONFIGURATION_INVALID, "Profile photos are not configured.", {
      correlationId: "profile-photo",
    });
  }

  async put(): Promise<void> {
    this.fail();
  }

  async get(): Promise<StoredPhoto | null> {
    this.fail();
  }

  async remove(): Promise<void> {
    // Account erasure must not fail because a feature was never enabled: with
    // no bucket there is no photo to remove.
  }
}

export function createProfilePhotoStore(
  bucketName: string | undefined,
  nodeEnv: string | undefined,
): ProfilePhotoStore {
  if (bucketName) return new GcsProfilePhotoStore(bucketName);
  return nodeEnv === "production"
    ? new UnconfiguredProfilePhotoStore()
    : new InMemoryProfilePhotoStore();
}
