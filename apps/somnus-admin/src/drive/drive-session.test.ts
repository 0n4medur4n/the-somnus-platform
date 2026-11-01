import { DRIVE_FILE_MAX_BYTES } from "@somnus/api-contracts";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";
import { changePassphrase, createAccount, fromUtf8, randomBytes, toB64, utf8 } from "./crypto.js";
import { type DriveFolderView, DriveSession } from "./drive-session.js";
import { FakeDriveServer } from "./fake-drive-server.js";
import type { DriveNote } from "./notes/notes-format.js";

/**
 * The Drive end to end in the browser half: real cryptography, a fake server
 * that keeps everything it is sent. The headline test is the first one -- the
 * server never receives a name, a note or a byte of content in the clear.
 */

const FAST = 1000;

// Real AES over megabytes of test data, under coverage instrumentation and
// alongside other suites: slower than the 5 s default, and that is not a bug.
vi.setConfig({ testTimeout: 60_000 });
const IDS = {
  ana: "018f0000-0000-7000-8000-0000000000a1",
  ben: "018f0000-0000-7000-8000-0000000000b2",
  eva: "018f0000-0000-7000-8000-0000000000e3",
};

async function join(server: FakeDriveServer, who: keyof typeof IDS): Promise<DriveSession> {
  const edge = server.edgeFor(IDS[who], `${who}@thesomnus.com`);
  const created = await createAccount(`la frase de ${who} es larga`, FAST);
  const account = await edge.enroll(created.request);
  return DriveSession.open(edge, account, await created.unlock(account));
}

async function folderNamed(session: DriveSession, name: string): Promise<DriveFolderView> {
  const shares = await session.listShares();
  const entry = shares.find((s) => s.name === name);
  if (!entry) throw new Error(`no folder ${name}`);
  return session.openShare(entry.shareId);
}

describe("what the server sees", () => {
  it("never a folder name, file name, note or file content in the clear", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await join(server, "ben");

    const secrets = {
      folder: "Protocolos clínicos internos",
      sub: "Algoritmo SAFE-004 revisión",
      note: "Instrucciones de uso del triaje nocturno",
      noteBody: "Paso 1: llamar al supervisor de guardia antes de las 23:00.",
      file: "reglas-escalado-confidencial.txt",
      fileBody: "REGLA 9: escalar a L1 si hay apneas presenciadas con somnolencia.",
    };

    await ana.createShare(secrets.folder);
    let folder = await folderNamed(ana, secrets.folder);
    await ana.createFolder(folder, folder.rootId, secrets.sub);
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: secrets.note,
      mime: "text/plain",
      bytes: utf8(secrets.noteBody),
      note: true,
    });
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: secrets.file,
      mime: "text/plain",
      bytes: utf8(secrets.fileBody),
    });
    await ana.addMember(folder, IDS.ben, "viewer");
    folder = await ana.openShare(folder.shareId);
    const note = folder.items.find((i) => i.meta?.name === secrets.note);
    if (!note) throw new Error("note missing");
    await ana.rename(folder, note, `${secrets.note} (v2)`);

    const everything = server.received.join("\n");
    for (const secret of Object.values(secrets)) {
      expect(everything).not.toContain(secret);
      // Not as base64 of the plain text either.
      expect(everything).not.toContain(toB64(utf8(secret)).slice(0, 16));
    }
    expect(everything).not.toContain("la frase de ana");
  });
});

describe("sharing between colleagues", () => {
  it("a colleague reads exactly what was written, and sees who wrote it, verified", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const ben = await join(server, "ben");
    await ana.refreshDirectory();

    await ana.createShare("Guías");
    const folder = await folderNamed(ana, "Guías");
    const body = randomBytes(1_300_000); // three blocks
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: "manual.pdf",
      mime: "application/pdf",
      bytes: body,
    });
    expect(await ben.listShares()).toEqual([]);

    await ana.addMember(folder, IDS.ben, "viewer");
    const seen = await folderNamed(ben, "Guías");
    expect(seen.role).toBe("viewer");
    const file = seen.items.find((i) => i.meta?.name === "manual.pdf");
    expect(file?.signature).toBe("valid");
    expect(file?.author).toMatchObject({ userId: IDS.ana, email: "ana@thesomnus.com" });
    expect(file?.node.blockCount).toBe(3);
    if (!file) throw new Error("file missing");
    expect(await ben.readFile(seen, file)).toEqual(body);
  });

  it("the colleague re-signs their copy of the folder key as their own on first open", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const ben = await join(server, "ben");
    await ana.refreshDirectory();
    await ana.createShare("Reglas");
    const folder = await folderNamed(ana, "Reglas");
    await ana.addMember(folder, IDS.ben, "editor");
    expect(server.shares.get(folder.shareId)?.members.get(IDS.ben)?.signedBy).toBe(IDS.ana);

    await ben.listShares();
    expect(server.shares.get(folder.shareId)?.members.get(IDS.ben)?.signedBy).toBe(IDS.ben);
    // And it still opens.
    expect((await folderNamed(ben, "Reglas")).name).toBe("Reglas");
  });

  it("a new revision of a note replaces its content for everyone", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await ana.createShare("Notas");
    let folder = await folderNamed(ana, "Notas");
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: "Cómo usar",
      mime: "text/plain",
      bytes: utf8("versión 1"),
      note: true,
    });
    folder = await ana.openShare(folder.shareId);
    const v1 = folder.items[0];
    if (!v1) throw new Error("missing");
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      existing: v1,
      name: "Cómo usar",
      mime: "text/plain",
      bytes: utf8("versión 2, más clara"),
      note: true,
    });
    folder = await ana.openShare(folder.shareId);
    const v2 = folder.items[0];
    if (!v2) throw new Error("missing");
    expect(v2.node.revision).toBe(2);
    expect(v2.meta?.note).toBe(true);
    expect(fromUtf8(await ana.readFile(folder, v2))).toBe("versión 2, más clara");
  });
});

describe("removing someone rotates the key", () => {
  it("the removed colleague's old copy opens nothing written afterwards", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const ben = await join(server, "ben");
    const eva = await join(server, "eva");
    await ana.refreshDirectory();

    await ana.createShare("Equipo");
    let folder = await folderNamed(ana, "Equipo");
    await ana.addMember(folder, IDS.ben, "viewer");
    await ana.addMember(folder, IDS.eva, "viewer");
    folder = await ana.openShare(folder.shareId);
    const shareId = folder.shareId;
    const benOldCopy = server.shares.get(shareId)?.members.get(IDS.ben)?.memberKey;

    await ana.removeMember(folder, IDS.ben);
    expect(server.shares.get(shareId)?.keyGeneration).toBe(2);
    expect(server.shares.get(shareId)?.members.has(IDS.ben)).toBe(false);

    folder = await ana.openShare(shareId);
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: "después",
      mime: "text/plain",
      bytes: utf8("solo para quien sigue"),
    });

    // Eva, who stays, still reads everything.
    const evaView = await folderNamed(eva, "Equipo");
    expect(evaView.items.map((i) => i.meta?.name)).toEqual(["después"]);

    // A server that re-admits Ben with his OLD copy cannot get him in: the
    // folder key changed, and his copy is for generation 1.
    if (!benOldCopy) throw new Error("missing");
    server.shares.get(shareId)?.members.set(IDS.ben, {
      role: "viewer",
      memberKey: benOldCopy,
      keyGeneration: 2,
      signedBy: IDS.ana,
      grantedBy: IDS.ana,
    });
    const benShares = await ben.listShares();
    expect(benShares[0]?.name).toBeNull();
    expect(benShares[0]?.problem).toBe("bad_signature");
  });
});

describe("a dishonest server", () => {
  async function withFile() {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await ana.createShare("Cofre");
    const folder = await folderNamed(ana, "Cofre");
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: "a.txt",
      mime: "text/plain",
      bytes: randomBytes(600_000),
    });
    const view = await ana.openShare(folder.shareId);
    const item = view.items[0];
    if (!item) throw new Error("missing");
    return { server, ana, view, item };
  }

  it("a swapped block is refused", async () => {
    const { server, ana, view, item } = await withFile();
    const id = item.node.id;
    const a = server.blocks.get(`${id}:1:0`) as Uint8Array;
    const b = server.blocks.get(`${id}:1:1`) as Uint8Array;
    server.blocks.set(`${id}:1:0`, b);
    server.blocks.set(`${id}:1:1`, a);
    await expect(ana.readFile(view, item)).rejects.toThrow();
  });

  it("a flipped bit is refused", async () => {
    const { server, ana, view, item } = await withFile();
    const key = `${item.node.id}:1:1`;
    const block = (server.blocks.get(key) as Uint8Array).slice();
    block[40] = (block[40] ?? 0) ^ 0x80;
    server.blocks.set(key, block);
    await expect(ana.readFile(view, item)).rejects.toThrow();
  });

  it("a forged folder key is refused before anything opens", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const ben = await join(server, "ben");
    await ana.refreshDirectory();
    await ana.createShare("Real");
    const real = await folderNamed(ana, "Real");
    await ana.addMember(real, IDS.ben, "viewer");
    // The server swaps Ben's copy for Ana's (a key that is not for him).
    const member = server.shares.get(real.shareId)?.members.get(IDS.ben);
    const anaCopy = server.shares.get(real.shareId)?.members.get(IDS.ana)?.memberKey;
    if (!member || !anaCopy) throw new Error("missing");
    member.memberKey = anaCopy;
    const shares = await ben.listShares();
    expect(shares[0]?.problem).toBe("bad_signature");
  });

  it("an impersonated colleague (swapped public key) is flagged, not trusted", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await join(server, "ben");
    await ana.refreshDirectory();
    expect(ana.trustOf(IDS.ben)).toBe("known");
    await ana.flushState();

    // The server swaps Ben's directory entry for a key it controls.
    const impostor = await createAccount("clave del servidor", FAST);
    const ben = server.accounts.get(IDS.ben);
    if (!ben) throw new Error("missing");
    server.accounts.set(IDS.ben, { ...ben, ...impostor.request });
    await ana.refreshDirectory();
    expect(ana.trustOf(IDS.ben)).toBe("changed");

    await ana.createShare("Privado");
    const folder = await folderNamed(ana, "Privado");
    await expect(ana.addMember(folder, IDS.ben, "viewer")).rejects.toMatchObject({
      reason: "key_changed",
    });
  });
});

describe("when a colleague changes their passphrase or resets their Drive", () => {
  async function joinKeepingEdge(server: FakeDriveServer) {
    const edge = server.edgeFor(IDS.ben, "ben@thesomnus.com");
    const created = await createAccount("la frase de ben es larga", FAST);
    const account = await edge.enroll(created.request);
    return { edge, account };
  }

  it("a new passphrase changes nothing anyone else can see", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { edge, account } = await joinKeepingEdge(server);
    await ana.refreshDirectory();
    const before = ana.fingerprintOf(IDS.ben);
    expect(ana.trustOf(IDS.ben)).toBe("known");

    const passphraseWrap = await changePassphrase(
      account,
      "la frase de ben es larga",
      "una frase nueva y distinta",
      FAST,
    );
    await edge.rewrap({ passphraseWrap });

    await ana.refreshDirectory();
    expect(ana.colleagues().map((c) => c.email)).toEqual(["ben@thesomnus.com"]);
    expect(ana.fingerprintOf(IDS.ben)).toBe(before);
    expect(ana.trustOf(IDS.ben)).toBe("known");
    await ana.createShare("Compartida");
    await ana.addMember(await folderNamed(ana, "Compartida"), IDS.ben, "viewer");
  });

  it("after a reset, the colleague can be confirmed and added again, and can open the folder", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { edge } = await joinKeepingEdge(server);
    await ana.refreshDirectory();
    expect(ana.trustOf(IDS.ben)).toBe("known");
    await ana.flushState();
    await ana.createShare("Protocolos");
    const folder = await folderNamed(ana, "Protocolos");

    // Ben lost everything and starts again, while Ana's Drive stays open.
    const fresh = await createAccount("otra frase larga de ben", FAST);
    const account = await edge.reset(fresh.request);

    // Ana's copy of the directory is old: she must not wrap for the key he lost.
    await expect(ana.addMember(folder, IDS.ben, "viewer")).rejects.toMatchObject({
      reason: "key_changed",
    });

    // Having confirmed his new fingerprint with him, she can.
    expect(ana.colleagues().map((c) => c.trust)).toEqual(["changed"]);
    await ana.markVerified(IDS.ben);
    await ana.addMember(folder, IDS.ben, "viewer");

    const ben = await DriveSession.open(edge, account, await fresh.unlock(account));
    const shared = await folderNamed(ben, "Protocolos");
    expect(shared.name).toBe("Protocolos");
  });

  it("a key rotation never wraps for a colleague whose key changed unseen", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await join(server, "ben");
    await join(server, "eva");
    await ana.refreshDirectory();
    ana.trustOf(IDS.ben);
    ana.trustOf(IDS.eva);
    await ana.createShare("Rotación");
    let folder = await folderNamed(ana, "Rotación");
    await ana.addMember(folder, IDS.ben, "viewer");
    await ana.addMember(folder, IDS.eva, "viewer");
    folder = await ana.openShare(folder.shareId);

    // The server, not Ben, swaps his key while Ana's Drive stays open.
    const impostor = await createAccount("clave del servidor", FAST);
    const entry = server.accounts.get(IDS.ben);
    if (!entry) throw new Error("missing");
    server.accounts.set(IDS.ben, { ...entry, ...impostor.request });

    await expect(ana.removeMember(folder, IDS.eva)).rejects.toMatchObject({
      reason: "key_changed",
    });
  });
});

describe("notes on a file", () => {
  const note = (id: string, text: string): DriveNote => ({
    id,
    authorId: IDS.ana,
    text,
    createdAt: "2026-11-01T10:00:00.000Z",
    done: false,
    anchor: { kind: "general" },
  });

  async function fileIn(session: DriveSession, folderName = "Protocolos") {
    await session.createShare(folderName);
    const folder = await folderNamed(session, folderName);
    const id = await session.writeFile(folder, {
      parentId: folder.rootId,
      name: "guia.md",
      mime: "text/markdown",
      bytes: utf8("# Guía"),
    });
    return { shareId: folder.shareId, id };
  }

  it("are never shown as a file of their own, and never reach the server readable", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { shareId, id } = await fileIn(ana);

    await ana.changeNotes(shareId, id, (notes) => [...notes, note("a", "Duda confidencial")]);

    const folder = await ana.openShare(shareId);
    expect(folder.items.map((i) => i.meta?.name)).toEqual(["guia.md"]);
    expect(folder.notes.has(id)).toBe(true);
    expect(server.received.join(" ")).not.toContain("Duda confidencial");
    expect((await ana.readNotes(shareId, id)).map((n) => n.text)).toEqual(["Duda confidencial"]);
  });

  it("are read by colleagues in the folder, whatever their role", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const ben = await join(server, "ben");
    const { shareId, id } = await fileIn(ana);
    await ana.addMember(await ana.openShare(shareId), IDS.ben, "viewer");
    await ana.changeNotes(shareId, id, (notes) => [...notes, note("a", "Para Ben")]);

    await ben.listShares();
    expect((await ben.readNotes(shareId, id)).map((n) => n.text)).toEqual(["Para Ben"]);
  });

  it("are empty for a file with none", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { shareId, id } = await fileIn(ana);
    expect(await ana.readNotes(shareId, id)).toEqual([]);
  });

  it("build on what is there, in the same file", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { shareId, id } = await fileIn(ana);
    await ana.changeNotes(shareId, id, (notes) => [...notes, note("a", "Una")]);
    await ana.changeNotes(shareId, id, (notes) => [...notes, note("b", "Dos")]);
    const folder = await ana.openShare(shareId);
    expect(folder.notes.get(id)?.node.revision).toBe(2);
    expect((await ana.readNotes(shareId, id)).map((n) => n.text)).toEqual(["Una", "Dos"]);
  });

  it("survive a colleague writing at the same moment: the change is applied to their copy", async () => {
    const server = new FakeDriveServer();
    const edge = server.edgeFor(IDS.ana, "ana@thesomnus.com");
    const created = await createAccount("la frase de ana es larga", FAST);
    const account = await edge.enroll(created.request);
    const ana = await DriveSession.open(edge, account, await created.unlock(account));
    const { shareId, id } = await fileIn(ana);
    await ana.changeNotes(shareId, id, (notes) => [...notes, note("a", "Primera")]);

    const startUpload = edge.startUpload.bind(edge);
    let raced = false;
    vi.spyOn(edge, "startUpload").mockImplementation(async (share, body) => {
      if (raced) return startUpload(share, body);
      raced = true;
      await ana.changeNotes(shareId, id, (notes) => [...notes, note("b", "De un colega")]);
      throw new ApiRequestError(409, "CONFLICT", "drive_stale_revision");
    });

    await ana.changeNotes(shareId, id, (notes) => [...notes, note("c", "Mía")]);
    expect((await ana.readNotes(shareId, id)).map((n) => n.text)).toEqual([
      "Primera",
      "De un colega",
      "Mía",
    ]);
  });

  it("do not retry anything that is not a stale revision", async () => {
    const server = new FakeDriveServer();
    const edge = server.edgeFor(IDS.ana, "ana@thesomnus.com");
    const created = await createAccount("la frase de ana es larga", FAST);
    const account = await edge.enroll(created.request);
    const ana = await DriveSession.open(edge, account, await created.unlock(account));
    const { shareId, id } = await fileIn(ana);
    const failing = vi
      .spyOn(edge, "startUpload")
      .mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "drive_role_insufficient"));
    await expect(ana.changeNotes(shareId, id, (notes) => notes)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("move with their file", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { shareId, id } = await fileIn(ana);
    await ana.changeNotes(shareId, id, (notes) => [...notes, note("a", "Una")]);
    let folder = await ana.openShare(shareId);
    await ana.createFolder(folder, folder.rootId, "Destino");
    folder = await ana.openShare(shareId);
    const target = folder.items.find((i) => i.meta?.name === "Destino");
    const file = folder.items.find((i) => i.node.id === id);
    if (!target || !file) throw new Error("missing");

    await ana.move(folder, file, target.node.id);

    folder = await ana.openShare(shareId);
    expect(folder.notes.get(id)?.node.parentId).toBe(target.node.id);
  });

  it("are deleted for good with their file", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { shareId, id } = await fileIn(ana);
    await ana.changeNotes(shareId, id, (notes) => [...notes, note("a", "Una")]);
    let folder = await ana.openShare(shareId);
    const file = folder.items.find((i) => i.node.id === id);
    if (!file) throw new Error("missing");

    await ana.trash(folder, file);
    await ana.purge(folder, file);

    folder = await ana.openShare(shareId);
    expect(folder.items).toEqual([]);
    expect(folder.notes.size).toBe(0);
  });

  it("refuse a node that is not in the folder", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const { shareId } = await fileIn(ana);
    await expect(ana.changeNotes(shareId, "no-existe", (notes) => notes)).rejects.toMatchObject({
      reason: "not_open",
    });
  });
});

describe("deleting a shared folder", () => {
  it("removes it for its owner and for everyone who shared it", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    const ben = await join(server, "ben");
    await ana.refreshDirectory();
    await ana.createShare("Borrable");
    const folder = await folderNamed(ana, "Borrable");
    await ana.addMember(folder, IDS.ben, "viewer");
    expect((await ben.listShares()).map((s) => s.name)).toEqual(["Borrable"]);

    await ana.deleteShare(folder.shareId);

    expect(await ana.listShares()).toEqual([]);
    expect(await ben.listShares()).toEqual([]);
  });
});

describe("limits", () => {
  it("refuses a file over the limit before encrypting or sending anything", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await ana.createShare("Grande");
    const folder = await folderNamed(ana, "Grande");
    const before = server.received.length;
    await expect(
      ana.writeFile(folder, {
        parentId: folder.rootId,
        name: "enorme.bin",
        mime: "application/octet-stream",
        bytes: new Uint8Array(DRIVE_FILE_MAX_BYTES + 1),
      }),
    ).rejects.toMatchObject({ reason: "file_too_large" });
    expect(server.received.length).toBe(before);
  });

  it("an empty note is still one authenticated block", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await ana.createShare("Vacío");
    let folder = await folderNamed(ana, "Vacío");
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: "vacía",
      mime: "text/plain",
      bytes: new Uint8Array(0),
      note: true,
    });
    folder = await ana.openShare(folder.shareId);
    const item = folder.items[0];
    if (!item) throw new Error("missing");
    expect(item.node.blockCount).toBe(1);
    expect((await ana.readFile(folder, item)).length).toBe(0);
  });
});

describe("colour and icon (owner decision 2026-10-29)", () => {
  it("are sealed with the name, survive a rename and a new revision, and reach other members", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await join(server, "ben");
    await ana.createShare("Protocolos");
    let folder = await folderNamed(ana, "Protocolos");
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      name: "Guía",
      mime: "text/plain",
      bytes: utf8("v1"),
      note: true,
    });
    folder = await ana.openShare(folder.shareId);
    let note = folder.items.find((i) => i.meta?.name === "Guía");
    if (!note) throw new Error("no note");
    await ana.setAppearance(folder, note, { color: "teal", icon: "stethoscope" });
    await ana.setShareAppearance(folder, { color: "purple", icon: "brain" });

    folder = await ana.openShare(folder.shareId);
    note = folder.items.find((i) => i.node.id === note?.node.id);
    expect(note?.meta).toMatchObject({ color: "teal", icon: "stethoscope" });
    expect(folder.appearance).toEqual({ color: "purple", icon: "brain" });
    expect((await ana.listShares())[0]?.appearance).toEqual({ color: "purple", icon: "brain" });

    // A rename and a new revision keep the look.
    if (!note) throw new Error("no note");
    await ana.rename(folder, note, "Guía v2");
    folder = await ana.openShare(folder.shareId);
    note = folder.items.find((i) => i.node.id === note?.node.id);
    if (!note) throw new Error("no note");
    await ana.writeFile(folder, {
      parentId: folder.rootId,
      existing: note,
      name: "Guía v2",
      mime: "text/plain",
      bytes: utf8("v2"),
      note: true,
    });
    folder = await ana.openShare(folder.shareId);
    expect(folder.items.find((i) => i.node.id === note?.node.id)?.meta).toMatchObject({
      name: "Guía v2",
      color: "teal",
      icon: "stethoscope",
    });

    // Clearing goes back to the default look.
    const current = folder.items.find((i) => i.node.id === note?.node.id);
    if (!current) throw new Error("no note");
    await ana.setAppearance(folder, current, {});
    folder = await ana.openShare(folder.shareId);
    const cleared = folder.items.find((i) => i.node.id === note?.node.id)?.meta;
    expect(cleared?.color).toBeUndefined();
    expect(cleared?.icon).toBeUndefined();

    // Never in the clear on the wire.
    expect(server.received.join(" ")).not.toContain("stethoscope");
    expect(server.received.join(" ")).not.toContain("teal");
  });

  it("drops a colour or an icon the console does not offer, even if a member wrote one", async () => {
    const server = new FakeDriveServer();
    const ana = await join(server, "ana");
    await ana.createShare("Carpeta");
    let folder = await folderNamed(ana, "Carpeta");
    await ana.createFolder(folder, folder.rootId, "Sub");
    folder = await ana.openShare(folder.shareId);
    const sub = folder.items[0];
    if (!sub) throw new Error("no folder");
    await ana.setAppearance(folder, sub, {
      color: "javascript:alert(1)" as never,
      icon: "<img src=x>" as never,
    });
    folder = await ana.openShare(folder.shareId);
    expect(folder.items[0]?.meta?.color).toBeUndefined();
    expect(folder.items[0]?.meta?.icon).toBeUndefined();
  });
});
