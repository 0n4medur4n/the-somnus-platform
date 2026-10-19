import { describe, expect, it, vi } from "vitest";

const { get, post, patch, del, putBytes, postFile, getFile } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  putBytes: vi.fn(),
  postFile: vi.fn(),
  getFile: vi.fn(),
}));
vi.mock("./api.js", () => ({ api: { get, post, patch, del, putBytes, postFile, getFile } }));

const { edge } = await import("./edge.js");
const { RawUpload } = await import("./raw-upload.js");

/**
 * The console's entire backend surface (Addendum A §A2.1). The point of these
 * is as much what is absent as what is present: the console has no method for a
 * consumer route, so it cannot accidentally start composing `/v1/me` or reading
 * someone's profile.
 */
describe("edge (admin console surface)", () => {
  it("exchanges the magic-link token on the shared session route", () => {
    void edge.createSession("id-token");
    expect(post).toHaveBeenCalledWith("/v1/sessions", { idToken: "id-token" });
  });

  it("uploads a corpus original raw, with its name URL-encoded in a header", () => {
    postFile.mockClear();
    const file = new File(["%PDF-1.4"], "guía nueva.pdf", { type: "application/pdf" });
    void edge.uploadCorpusFile("doc 1", file, "application/pdf");
    const [path, upload] = postFile.mock.calls[0] as [string, InstanceType<typeof RawUpload>];
    expect(path).toBe("/admin/v1/corpus/documents/doc%201/file");
    expect(upload).toBeInstanceOf(RawUpload);
    expect(upload.bytes).toBe(file);
    expect(upload.contentType).toBe("application/pdf");
    expect(upload.headers).toEqual({ "x-somnus-filename": "gu%C3%ADa%20nueva.pdf" });
  });

  it("lists an organization's members on the route edge serves", () => {
    // Regression: the Drive's /members -> /access rename once reached this call.
    void edge.organizationMembers("o1");
    expect(get).toHaveBeenCalledWith("/admin/v1/organizations/o1/members");
  });

  it("reads the shell from /admin/v1/me", () => {
    void edge.adminMe();
    expect(get).toHaveBeenCalledWith("/admin/v1/me");
  });

  it("signs out through the shared session route", () => {
    void edge.logout();
    expect(del).toHaveBeenCalledWith("/v1/sessions/current");
  });

  it("touches no path outside /admin/v1 and the shared session routes", () => {
    // Earlier tests in this file already drove some of these mocks.
    for (const spy of [get, post, patch, del, postFile, getFile]) spy.mockClear();

    // Every method is driven and every path it produced is checked, so the
    // assertion holds as the console grows rather than freezing today's list.
    // The console must never start composing a consumer route.
    const calls = [
      () => edge.searchUsers({ limit: 10 }),
      () => edge.userDetail("u1"),
      () => edge.setUserStatus("u1", { status: "suspended", reason: "why" }),
      () => edge.deletionRequests(),
      () => edge.decideDeletion("d1", { decision: "cancel", reason: "why" }),
      () => edge.organizations(),
      () => edge.createOrganization({ name: "Org" }),
      () => edge.setOrganizationStatus("o1", { status: "active", reason: "why" }),
      () => edge.organizationMembers("o1"),
      () => edge.platformInvitations(),
      () =>
        edge.invitePlatformUser({
          firstName: "Ana",
          lastName: "Garcia",
          email: "invite@example.com",
          role: "adult",
          locale: "ca",
        }),
      () => edge.revokePlatformInvitation("s1"),
      () => edge.staffInvitations(),
      () =>
        edge.inviteStaff({
          firstName: "Ana",
          lastName: "García",
          email: "ana@example.com",
          roleKey: "support_agent",
          locale: "es",
        }),
      () => edge.revokeStaffInvitation("s1"),
      () => edge.myStaffInvitation(),
      () => edge.acceptStaffInvitation(),
      () => edge.verificationQueue(),
      () => edge.decideVerification("c1", { decision: "approve", reason: "why" }),
      () =>
        edge.assignRole({
          targetUserId: "018f0000-0000-7000-8000-0000000000ff",
          roleKey: "support_agent",
        }),
      () => edge.contentReviewQueue(),
      () => edge.decideContentReview("i1", { decision: "approve", reason: "why" }),
      () => edge.statistics(),
      () => edge.auditQuery({ limit: 10 }),
      () => edge.auditExport({ limit: 10 }),
      () =>
        edge.breakGlassReveal({
          subjectUserId: "018f0000-0000-7000-8000-0000000000fe",
          category: "safety",
          justification: "Safeguarding escalation raised by the on-call clinician this morning.",
        }),
      // Checkpoint 16.3 -- the reference corpus.
      () => edge.searchCorpus(),
      () => edge.corpusDocument("doc-1"),
      () =>
        edge.createCorpusDocument({
          title: "Higiene del sue\u00f1o",
          citation: "The Somnus (2026).",
          sourceType: "guideline",
          locale: "es",
          scopes: [{ scopeType: "module", scopeKey: "INS" }],
        }),
      () => edge.editCorpusDocument("doc-1", { title: "Revisada" }),
      () => edge.publishCorpusDocument("doc-1", { changelog: "Alta." }),
      () => edge.retireCorpusDocument("doc-1", { reason: "Obsoleta.", changelog: "Retirada." }),
      () => edge.corpusSources(),
      () =>
        edge.uploadCorpusFile(
          "doc-1",
          new File(["%PDF-1.4"], "guía.pdf", { type: "application/pdf" }),
          "application/pdf",
        ),
      () => edge.fetchCorpusWebPage("doc-1", { url: "https://example.org/guia" }),
      () => edge.downloadCorpusFile("doc-1"),
      () => edge.adminMe(),
      () => edge.createSession("token"),
      () => edge.logout(),
      () => edge.requestSignInLink({ email: "a@b.co", locale: "es", client: "console" }),
    ];
    for (const call of calls) void call();

    const paths = [
      ...get.mock.calls,
      ...post.mock.calls,
      ...patch.mock.calls,
      ...del.mock.calls,
      ...postFile.mock.calls,
      ...getFile.mock.calls,
    ]
      .map(([path]) => path as string)
      .filter((path) => path !== undefined);

    expect(paths.length).toBe(calls.length);
    // Shared with the app, all about signing in: none reads anyone's data.
    const SHARED_SESSION_ROUTES = ["/v1/sessions", "/v1/sessions/current", "/v1/auth/email-link"];
    // The invited person's OWN staff invitation (owner decision 2026-10-18),
    // looked up by the session's verified address: they hold no internal role
    // yet, so it cannot live under /admin/v1, and it reads nobody else's data.
    const OWN_INVITATION_ROUTES = ["/v1/staff-invitation", "/v1/staff-invitation/accept"];
    for (const path of paths) {
      const allowed =
        path.startsWith("/admin/v1/") ||
        SHARED_SESSION_ROUTES.includes(path) ||
        OWN_INVITATION_ROUTES.includes(path);
      expect(allowed, `${path} is outside the console's surface`).toBe(true);
    }
  });

  /**
   * Addendum B §B3: append and retire, never delete.
   *
   * Asserted on the client rather than only on the screen, because a screen can
   * be changed by anyone with a text editor. There is no method here to call,
   * and `api.del` is reached by exactly one thing -- signing out.
   */
  it("has no way to delete a corpus document", () => {
    const methods = Object.keys(edge);
    expect(methods.filter((name) => /delete|remove|purge/i.test(name))).toEqual([]);
    expect(methods).toContain("retireCorpusDocument");

    for (const spy of [get, post, patch, del]) spy.mockClear();
    void edge.retireCorpusDocument("doc-1", { reason: "Obsoleta.", changelog: "Retirada." });
    expect(del).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/admin/v1/corpus/documents/doc-1/retire", {
      reason: "Obsoleta.",
      changelog: "Retirada.",
    });
  });

  /**
   * The staff Drive (ADR 0019). Every route stays under /admin/v1/drive, ids are
   * encoded before they reach a path, blocks travel as raw bytes, and nothing
   * goes through DELETE: permanent removal is a deliberate POST .../purge.
   */
  it("keeps every Drive call under /admin/v1/drive, with encoded ids", () => {
    for (const spy of [get, post, patch, del, putBytes]) spy.mockClear();
    const d = edge.drive;
    const bytes = new Uint8Array([1, 2, 3]);
    const sealed = { iv: "AAAAAAAAAAAAAAAA", ct: "AAAAAAAAAAAAAAAAAAAAAAAA" };
    const calls = [
      () => d.account(),
      () => d.directory(),
      () => d.shares(),
      () => d.share("s/1"),
      () => d.purgeShare("s1"),
      () => d.setRole("s1", "u1", "editor"),
      () => d.trash("s1", "n1"),
      () => d.restore("s1", "n1"),
      () => d.purgeNode("s1", "n1"),
      () => d.commit("s1", "n1", 2),
      () => d.readBlock("s1", "n1", 2, 0),
      () => d.move("s1", "n1", { parentId: "p1" }),
      () => d.rename("s1", "n1", { meta: sealed, signature: "x" }),
      () => d.saveState({ state: sealed }),
    ] as Array<() => unknown>;
    for (const call of calls) void call();
    void d.putBlock("s1", "n1", 2, 3, bytes);

    const paths = [...get.mock.calls, ...post.mock.calls].map(([path]) => path as string);
    expect(paths.length).toBe(calls.length);
    for (const path of paths) expect(path.startsWith("/admin/v1/drive/")).toBe(true);
    expect(paths).toContain("/admin/v1/drive/shares/s%2F1");
    expect(post).toHaveBeenCalledWith("/admin/v1/drive/shares/s1/access/u1/role", {
      role: "editor",
    });
    expect(putBytes).toHaveBeenCalledWith(
      "/admin/v1/drive/shares/s1/nodes/n1/revisions/2/blocks/3",
      bytes,
    );
    expect(del).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
