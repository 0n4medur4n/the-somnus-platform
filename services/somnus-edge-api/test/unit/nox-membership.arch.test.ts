import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Addendum A §A1 / Checkpoint 14.2, the required negative: **no route in the
 * edge or in the SPA lets anyone into a Nox organization without a valid
 * invitation or an admin action.**
 *
 * This is an architectural test over the route table rather than a behavioural
 * one, because the risk it guards is a route that should never have existed:
 * a "join organization" endpoint, a public signup for Nox, a POST that creates
 * a membership directly. A behavioural test can only exercise routes someone
 * remembered to write a test for; this one fails the build the moment such a
 * route appears anywhere in either table.
 *
 * The tables are read from source, the same way no-tidb.arch.test.ts reads
 * dependencies -- no app boot, no database, no emulator.
 */

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

type Route = {
  method: string;
  path: string;
  /** True when the route sits behind SessionGuard, on the class or the handler. */
  guarded: boolean;
  file: string;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".controller.ts")) out.push(full);
  }
  return out;
}

/**
 * SessionGuard anywhere in a `@UseGuards(...)` list, not just alone. Matching
 * the literal `@UseGuards(SessionGuard)` used to work only because every
 * controller had exactly one guard; the admin console stacks a second one
 * (`@UseGuards(SessionGuard, AdminCapabilityGuard)`) and the old check read that
 * as UNGUARDED -- a false "this route is public" on the most sensitive routes in
 * the service.
 */
function hasSessionGuard(line: string): boolean {
  return /@UseGuards\([^)]*SessionGuard/.test(line);
}

function joinPath(base: string, sub: string): string {
  const cleanBase = base.replace(/^\/|\/$/g, "");
  const cleanSub = sub.replace(/^\/|\/$/g, "");
  return `/${[cleanBase, cleanSub].filter(Boolean).join("/")}`;
}

/** Extracts every declared edge route, with whether SessionGuard applies to it. */
function readEdgeRoutes(): Route[] {
  const routes: Route[] = [];

  for (const file of walk(`${packageRoot}src`)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let basePath: string | null = null;
    let classGuarded = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      const controller = line.match(/@Controller\(\{\s*path:\s*"([^"]*)"/);
      if (controller) {
        basePath = controller[1] ?? "";
        // A class-level guard sits between @Controller and `export class`.
        classGuarded = false;
        for (let j = i + 1; j < lines.length && !/export class/.test(lines[j] ?? ""); j++) {
          if (hasSessionGuard(lines[j] ?? "")) classGuarded = true;
        }
        continue;
      }

      const verb = line.match(/^\s*@(Get|Post|Patch|Put|Delete)\(\s*(?:"([^"]*)")?\s*\)/);
      if (!verb || basePath === null) continue;

      // A handler-level guard sits between the verb decorator and the method.
      let handlerGuarded = false;
      for (
        let j = i + 1;
        j < lines.length && !/^\s*(async\s+)?\w+\s*\(/.test(lines[j] ?? "");
        j++
      ) {
        if (hasSessionGuard(lines[j] ?? "")) handlerGuarded = true;
      }

      routes.push({
        method: (verb[1] ?? "").toUpperCase(),
        path: joinPath(basePath, verb[2] ?? ""),
        guarded: classGuarded || handlerGuarded,
        file: file.slice(packageRoot.length),
      });
    }
  }

  return routes;
}

/** The SPA route table, split by whether the route sits inside <RequireAuth />. */
function readSpaRoutes(): { publicPaths: string[]; guardedPaths: string[] } {
  const source = readFileSync(`${repoRoot}apps/somnus-app/src/App.tsx`, "utf8");
  const guardStart = source.indexOf("element: <RequireAuth />");
  expect(guardStart, "App.tsx no longer has a <RequireAuth /> route group").toBeGreaterThan(-1);

  const childrenStart = source.indexOf("children: [", guardStart);
  const childrenEnd = source.indexOf("],", childrenStart);
  const guardedBlock = source.slice(childrenStart, childrenEnd);
  const rest = source.slice(0, guardStart) + source.slice(childrenEnd);

  const paths = (block: string): string[] =>
    [...block.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");

  return { publicPaths: paths(rest), guardedPaths: paths(guardedBlock) };
}

const edgeRoutes = readEdgeRoutes();
const spaRoutes = readSpaRoutes();

describe("edge route table: the public surface is a closed, reviewed list", () => {
  it("found the route table at all", () => {
    expect(edgeRoutes.length).toBeGreaterThan(10);
  });

  /**
   * Every route reachable without a session. Adding one means editing this
   * list on purpose, in a diff a reviewer sees -- which is the only way a new
   * unauthenticated entry point should ever appear.
   */
  it("exposes exactly the reviewed set of unauthenticated routes", () => {
    const publicRoutes = edgeRoutes
      .filter((r) => !r.guarded)
      .map((r) => `${r.method} ${r.path}`)
      .sort();

    expect(publicRoutes).toEqual(
      [
        "GET /health/live",
        "GET /health/ready",
        "GET /version",
        // Legal documents must be readable before consent is given (§13).
        "GET /v1/legal-documents/current",
        // Login bootstrap: protected by a valid Firebase ID token, not a cookie.
        "POST /v1/sessions",
        // The anonymous assessment flow (build plan §14).
        "GET /v1/assessments/content",
        "POST /v1/assessments",
        "POST /v1/assessments/:sessionId/answers",
        "GET /v1/assessments/:sessionId/summary",
        "POST /v1/assessments/:sessionId/claim-token",
        // The invitation preview (Addendum A Checkpoint 14.2): read-only, and
        // the only way to tell an invited person their invitation is dead
        // before a magic link is sent.
        "POST /v1/invitations/preview",
      ].sort(),
    );
  });
});

describe("no route creates a Nox membership without an invitation or an admin action", () => {
  it("has no route that creates an organization membership directly", () => {
    const offenders = edgeRoutes.filter(
      (r) => /\/members/.test(r.path) && ["POST", "PUT"].includes(r.method),
    );
    expect(
      offenders.map((r) => `${r.method} ${r.path} (${r.file})`),
      "membership creation must go through invitation accept, never a direct route",
    ).toEqual([]);
  });

  it("exposes exactly two invitation routes: accept (session-guarded) and preview (read-only)", () => {
    const invitationRoutes = edgeRoutes
      .filter((r) => r.path.startsWith("/v1/invitations"))
      .map((r) => `${r.method} ${r.path} ${r.guarded ? "guarded" : "public"}`)
      .sort();

    expect(invitationRoutes).toEqual([
      "POST /v1/invitations/accept guarded",
      "POST /v1/invitations/preview public",
    ]);
  });

  it("has no Nox signup route under any spelling", () => {
    // `/v1/registration` is the individual account flow and is session-guarded:
    // it needs a verified Firebase identity and it joins no organization.
    const forbidden = /signup|sign-up|join|onboard|enrol/i;
    const offenders = edgeRoutes.filter((r) => forbidden.test(r.path));
    expect(offenders.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("keeps the roster and the invite issuing behind a session", () => {
    const orgRoutes = edgeRoutes.filter((r) => r.path.startsWith("/v1/organizations"));
    expect(orgRoutes.length).toBeGreaterThan(0);
    for (const route of orgRoutes) {
      expect(route.guarded, `${route.method} ${route.path} must be session-guarded`).toBe(true);
    }
  });
});

/**
 * Addendum A §A2.1 / Checkpoint 15.1. The admin surface is the most sensitive
 * in the service, so its guarding is asserted structurally as well as
 * behaviourally: an `/admin/v1/*` route that ships without the session guard is
 * a build failure, not something to be caught by whoever remembers to test it.
 *
 * This assertion was worth writing: stacking a second guard
 * (`@UseGuards(SessionGuard, AdminCapabilityGuard)`) is exactly the shape the
 * original guard detection here misread as UNGUARDED.
 */
describe("every admin route sits behind the session guard", () => {
  const adminRoutes = edgeRoutes.filter((r) => r.path.startsWith("/admin/v1"));

  it("has an admin surface to check", () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
  });

  it("guards all of it", () => {
    const unguarded = adminRoutes.filter((r) => !r.guarded).map((r) => `${r.method} ${r.path}`);
    expect(unguarded, "an /admin/v1 route must never be reachable without a session").toEqual([]);
  });

  it("keeps the admin surface out of the public route list entirely", () => {
    const publicPaths = edgeRoutes.filter((r) => !r.guarded).map((r) => r.path);
    expect(publicPaths.filter((p) => p.startsWith("/admin"))).toEqual([]);
  });
});

describe("SPA route table: no Nox signup page", () => {
  it("keeps every organization screen behind RequireAuth", () => {
    const publicOrgRoutes = spaRoutes.publicPaths.filter((p) => p.includes("organization"));
    expect(publicOrgRoutes).toEqual([]);
    expect(spaRoutes.guardedPaths).toContain("/organization");
    expect(spaRoutes.guardedPaths).toContain("/organization/members");
    expect(spaRoutes.guardedPaths).toContain("/organization/invitations");
  });

  it("exposes exactly the reviewed set of public screens", () => {
    expect([...spaRoutes.publicPaths].sort()).toEqual(
      [
        "/login",
        "/auth/callback",
        // Anonymous Morpheo assessment (build plan §14).
        "/assessment",
        // The ONLY entry point into a Nox organization (Addendum A §A1).
        "/invitation/accept",
        "/",
        "*",
      ].sort(),
    );
  });

  it("has no signup screen: the invitation link is the only door", () => {
    const forbidden = /signup|sign-up|join|register/i;
    expect(spaRoutes.publicPaths.filter((p) => forbidden.test(p))).toEqual([]);
    expect(spaRoutes.guardedPaths.filter((p) => forbidden.test(p))).toEqual([]);
  });
});
