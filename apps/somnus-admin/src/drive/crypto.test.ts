import {
  DRIVE_PBKDF2_MIN_ITERATIONS,
  type DriveAccount,
  DriveEnrollRequestSchema,
  type DriveMemberKey,
} from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import {
  changePassphrase,
  contentHash,
  createAccount,
  DRIVE_PBKDF2_ITERATIONS,
  DriveCryptoError,
  decodeRecoveryCode,
  decryptBlock,
  encodeRecoveryCode,
  encryptBlock,
  fingerprintOf,
  fromB64,
  fromUtf8,
  metaHash,
  newSymmetricKey,
  openMeta,
  openState,
  randomBytes,
  recoverAccount,
  sealMeta,
  sealState,
  signNode,
  toB64,
  type UnlockedAccount,
  unlockWithPassphrase,
  unwrapNodeKey,
  unwrapShareKey,
  utf8,
  verifyNode,
  wrapNodeKey,
  wrapShareKeyFor,
} from "./crypto.js";

/** Fast KDF for tests that are not about the KDF; one test pins the real floor. */
const FAST = 1000;

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DriveCryptoError) return error.failure;
    throw error;
  }
  return "no error";
}

let counter = 0;
async function newPerson(
  passphrase = "una frase larga y secreta",
): Promise<{ account: DriveAccount; me: UnlockedAccount; recoveryCode: string }> {
  counter += 1;
  const created = await createAccount(passphrase, FAST);
  const account: DriveAccount = {
    userId: `018f0000-0000-7000-8000-0000000000${String(counter).padStart(2, "0")}`,
    email: `p${counter}@thesomnus.com`,
    ...created.request,
    state: null,
    keyVersion: 1,
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
  };
  return { account, me: await created.unlock(account), recoveryCode: created.recoveryCode };
}

describe("the account", () => {
  it("is created with the real KDF floor by default, and the request has no secret in it", async () => {
    expect(DRIVE_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(DRIVE_PBKDF2_MIN_ITERATIONS);
    const passphrase = "correct horse battery staple";
    const created = await createAccount(passphrase, FAST);
    expect(
      DriveEnrollRequestSchema.safeParse({
        ...created.request,
        passphraseWrap: { ...created.request.passphraseWrap, iterations: DRIVE_PBKDF2_ITERATIONS },
      }).success,
    ).toBe(true);

    const sent = JSON.stringify(created.request);
    expect(sent).not.toContain(passphrase);
    expect(sent).not.toContain(created.recoveryCode);
    expect(sent).not.toContain(created.recoveryCode.replace(/-/g, ""));
  });

  it("opens with the right passphrase and refuses a wrong one", async () => {
    const { account } = await newPerson("la frase correcta de verdad");
    const me = await unlockWithPassphrase(account, "la frase correcta de verdad");
    expect(me.fingerprint).toBe(await fingerprintOf(account.encPublicKey, account.signPublicKey));
    expect(await failure(unlockWithPassphrase(account, "la frase incorrecta"))).toBe(
      "wrong_secret",
    );
  });

  it("refuses sealed private keys the server swapped for another account's", async () => {
    const a = await newPerson("frase de la persona A");
    const b = await newPerson("frase de la persona B");
    const mixed = { ...a.account, privateKeys: b.account.privateKeys };
    expect(await failure(unlockWithPassphrase(mixed, "frase de la persona A"))).toBe("tampered");
  });

  it("recovers with the code, sets a new passphrase and issues a new code", async () => {
    const { account, recoveryCode } = await newPerson("olvidaré esta frase");
    const recovered = await recoverAccount(
      account,
      recoveryCode.toLowerCase(),
      "frase nueva",
      FAST,
    );
    expect(recovered.recoveryCode).not.toBe(recoveryCode);

    const updated = { ...account, ...recovered.rewrap } as DriveAccount;
    const reopened = await unlockWithPassphrase(updated, "frase nueva");
    expect(reopened.fingerprint).toBe(recovered.unlocked.fingerprint);
    expect(await failure(unlockWithPassphrase(updated, "olvidaré esta frase"))).toBe(
      "wrong_secret",
    );
    // The used code no longer opens anything.
    expect(await failure(recoverAccount(updated, recoveryCode, "otra", FAST))).toBe("wrong_secret");
  });

  it("refuses a wrong or malformed recovery code", async () => {
    const { account } = await newPerson();
    const wrong = encodeRecoveryCode(randomBytes(20));
    expect(await failure(recoverAccount(account, wrong, "x", FAST))).toBe("wrong_secret");
    expect(await failure(recoverAccount(account, "ABCD", "x", FAST))).toBe("wrong_secret");
  });

  it("changes the passphrase only when the current one is right", async () => {
    const { account } = await newPerson("frase vieja de ejemplo");
    expect(await failure(changePassphrase(account, "no es esta", "nueva", FAST))).toBe(
      "wrong_secret",
    );
    const wrap = await changePassphrase(account, "frase vieja de ejemplo", "frase nueva", FAST);
    const me = await unlockWithPassphrase({ ...account, passphraseWrap: wrap }, "frase nueva");
    expect(me.userId).toBe(account.userId);
  });

  it("seals the verified-keys list so only its owner can read it", async () => {
    const { me } = await newPerson();
    const other = await newPerson();
    const state = { contacts: { u1: { fingerprint: "AAAA BBBB", verified: true } } };
    const sealed = await sealState(me, state);
    expect(await openState(me, sealed)).toEqual(state);
    expect(await openState(me, null)).toEqual({ contacts: {} });
    expect(await failure(openState(other.me, sealed))).toBe("tampered");
  });
});

describe("the recovery code", () => {
  it("round-trips 160 bits through eight readable groups", () => {
    const bytes = randomBytes(20);
    const code = encodeRecoveryCode(bytes);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(decodeRecoveryCode(code)).toEqual(bytes);
  });

  it("forgives case, spacing and the letters people mistake for digits", () => {
    const bytes = new Uint8Array(20);
    const code = encodeRecoveryCode(bytes);
    expect(code.startsWith("0000")).toBe(true);
    const typed = ` ${code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o")} `;
    expect(decodeRecoveryCode(typed)).toEqual(bytes);
  });

  it("rejects anything that is not a whole code", () => {
    expect(decodeRecoveryCode("")).toBeNull();
    expect(decodeRecoveryCode("U".repeat(32))).toBeNull();
  });
});

describe("sharing a folder key", () => {
  it("only the intended colleague can open it, and only if a known colleague signed it", async () => {
    const owner = await newPerson();
    const colleague = await newPerson();
    const outsider = await newPerson();
    const shareId = "018f0000-0000-7000-8000-00000000aaaa";
    const shareKey = randomBytes(32);

    const wrapped = await wrapShareKeyFor({
      me: owner.me,
      shareId,
      recipientUserId: colleague.me.userId,
      recipientEncPublicKey: colleague.account.encPublicKey,
      keyGeneration: 1,
      shareKey,
    });
    const memberKey: DriveMemberKey = { ...wrapped, keyGeneration: 1, signedBy: owner.me.userId };

    const opened = await unwrapShareKey({
      me: colleague.me,
      shareId,
      memberKey,
      signerPublicKey: owner.account.signPublicKey,
    });
    expect(opened).toEqual(shareKey);

    // Someone else's copy does not open for the outsider.
    expect(
      await failure(
        unwrapShareKey({
          me: outsider.me,
          shareId,
          memberKey,
          signerPublicKey: owner.account.signPublicKey,
        }),
      ),
    ).toBe("bad_signature");
    // Nor in another folder, nor at another generation.
    expect(
      await failure(
        unwrapShareKey({
          me: colleague.me,
          shareId: "018f0000-0000-7000-8000-00000000bbbb",
          memberKey,
          signerPublicKey: owner.account.signPublicKey,
        }),
      ),
    ).toBe("bad_signature");
    expect(
      await failure(
        unwrapShareKey({
          me: colleague.me,
          shareId,
          memberKey: { ...memberKey, keyGeneration: 2 },
          signerPublicKey: owner.account.signPublicKey,
        }),
      ),
    ).toBe("bad_signature");
  });

  it("refuses a folder key the server made up and wrapped itself", async () => {
    const colleague = await newPerson();
    const server = await newPerson();
    const shareId = "018f0000-0000-7000-8000-00000000cccc";
    // The server can wrap a key for anyone's public key -- but it can only sign
    // with a key of its own, which is not the key of the colleague it claims.
    const forged = await wrapShareKeyFor({
      me: server.me,
      shareId,
      recipientUserId: colleague.me.userId,
      recipientEncPublicKey: colleague.account.encPublicKey,
      keyGeneration: 1,
      shareKey: randomBytes(32),
    });
    const owner = await newPerson();
    expect(
      await failure(
        unwrapShareKey({
          me: colleague.me,
          shareId,
          memberKey: { ...forged, keyGeneration: 1, signedBy: owner.me.userId },
          signerPublicKey: owner.account.signPublicKey,
        }),
      ),
    ).toBe("bad_signature");
    expect(
      await failure(
        unwrapShareKey({
          me: colleague.me,
          shareId,
          memberKey: { ...forged, keyGeneration: 1, signedBy: owner.me.userId },
          signerPublicKey: null,
        }),
      ),
    ).toBe("unknown_signer");
  });
});

describe("nodes", () => {
  const shareId = "018f0000-0000-7000-8000-00000000dddd";
  const nodeId = "018f0000-0000-7000-8000-00000000eeee";

  it("a node key opens only in its own folder, node and key generation", async () => {
    const shareKey = await newSymmetricKey();
    const nodeKey = randomBytes(32);
    const wrapped = await wrapNodeKey({ shareKey, shareId, nodeId, keyGeneration: 1, nodeKey });
    const opened = await unwrapNodeKey({ shareKey, shareId, nodeId, keyGeneration: 1, wrapped });
    expect(opened.raw).toEqual(nodeKey);
    expect(
      await failure(
        unwrapNodeKey({
          shareKey,
          shareId,
          nodeId: "018f0000-0000-7000-8000-00000000ffff",
          keyGeneration: 1,
          wrapped,
        }),
      ),
    ).toBe("tampered");
  });

  it("the name is sealed, and a name moved to another node does not open", async () => {
    const nodeKey = await newSymmetricKey();
    const meta = {
      name: "Protocolo de seguridad SAFE-004.pdf",
      modifiedAt: "2026-10-17T10:00:00Z",
    };
    const sealed = await sealMeta({ nodeKey, shareId, nodeId, revision: 1, meta });
    expect(fromUtf8(fromB64(sealed.ct))).not.toContain("SAFE-004");
    expect(await openMeta({ nodeKey, shareId, nodeId, revision: 1, sealed })).toEqual(meta);
    expect(
      await failure(
        openMeta({
          nodeKey,
          shareId,
          nodeId: "018f0000-0000-7000-8000-00000000ffff",
          revision: 1,
          sealed,
        }),
      ),
    ).toBe("tampered");
  });

  it("blocks open only at their own index, count and revision", async () => {
    const nodeKey = await newSymmetricKey();
    const plain = [utf8("primer bloque"), utf8("segundo bloque")];
    const blocks = await Promise.all(
      plain.map((plaintext, index) =>
        encryptBlock({ nodeKey, nodeId, revision: 1, index, count: 2, plaintext }),
      ),
    );
    const open = (block: Uint8Array, index: number, count = 2, revision = 1) =>
      decryptBlock({ nodeKey, nodeId, revision, index, count, block });

    expect(fromUtf8(await open(blocks[0] as Uint8Array, 0))).toBe("primer bloque");
    // Swapped order, truncation (count 1), and replay from another revision all fail.
    expect(await failure(open(blocks[1] as Uint8Array, 0))).toBe("tampered");
    expect(await failure(open(blocks[0] as Uint8Array, 0, 1))).toBe("tampered");
    expect(await failure(open(blocks[0] as Uint8Array, 0, 2, 2))).toBe("tampered");
    // A single flipped bit fails too.
    const flipped = (blocks[1] as Uint8Array).slice();
    flipped[20] = (flipped[20] ?? 0) ^ 1;
    expect(await failure(open(flipped, 1))).toBe("tampered");
  });

  it("a signature covers the sealed name and the content, and only its author's key verifies it", async () => {
    const author = await newPerson();
    const other = await newPerson();
    const nodeKey = await newSymmetricKey();
    const sealed = await sealMeta({
      nodeKey,
      shareId,
      nodeId,
      revision: 1,
      meta: { name: "n", modifiedAt: "2026-10-17T10:00:00Z" },
    });
    const input = {
      shareId,
      nodeId,
      kind: "file" as const,
      revision: 1,
      metaHash: await metaHash(sealed),
      contentHash: await contentHash([utf8("a"), utf8("b")]),
    };
    const signature = await signNode(author.me, input);
    expect(await verifyNode(author.account.signPublicKey, input, signature)).toBe(true);
    expect(await verifyNode(other.account.signPublicKey, input, signature)).toBe(false);
    expect(
      await verifyNode(
        author.account.signPublicKey,
        { ...input, contentHash: await contentHash([utf8("b"), utf8("a")]) },
        signature,
      ),
    ).toBe(false);
    expect(
      await verifyNode(author.account.signPublicKey, { ...input, revision: 2 }, signature),
    ).toBe(false);
  });

  it("base64 round-trips binary of any size", () => {
    const bytes = randomBytes(100_000);
    expect(fromB64(toB64(bytes))).toEqual(bytes);
  });
});
