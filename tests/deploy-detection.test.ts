import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The promotion pipeline's change detection, exercised rather than described.
 *
 * `deploy.yml`'s `detect` job decides which deployables a commit touches. Get it
 * wrong in the direction of "nothing changed" and the pipeline reports success
 * while shipping nothing -- which is exactly what happened to the admin console:
 * Addendum A §A2.1 added a third Hosting site, and the detection patterns were
 * never extended, so an admin-only commit produced `any=false`.
 *
 * A test that asserts the file *contains* a pattern would not have caught that,
 * because the pattern it should contain is precisely what nobody thought of. So
 * this extracts the real shell out of the real workflow and runs it, then asks
 * what it concluded. The logic under test is the deployed logic; if someone edits
 * the classification, this runs the edited version.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf8");
const environmentWorkflow = readFileSync(
  join(REPO_ROOT, ".github/workflows/deploy-environment.yml"),
  "utf8",
);

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/**
 * Pulls the classification half of the `Detect changes` step out of the workflow.
 *
 * The step's first half derives `changed` from git history and the GitHub event;
 * that needs a real push to be meaningful. Everything from `is_all()` onward is
 * pure classification over a list of paths, and that is the half being tested --
 * so it is lifted verbatim and handed a list directly.
 */
function classificationScript(): string {
  const start = workflow.indexOf("          is_all() {");
  if (start === -1) {
    throw new Error(
      "Could not find the classification logic in deploy.yml. If the `detect` step was " +
        "restructured, update this test to match -- do not delete it.",
    );
  }
  const end = workflow.indexOf("\n", workflow.indexOf('          echo "summary -> '));
  return workflow
    .slice(start, end)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

const script = classificationScript();

describe("the extracted logic is really the workflow's", () => {
  it("carries the parts that make it the detection step and not something else", () => {
    // Guards against a silent bad extraction producing vacuously green results.
    expect(script).toContain("is_all()");
    expect(script).toContain("touched()");
    expect(script).toContain("GITHUB_OUTPUT");
    expect(script).toContain("shared_ts");
    expect(script).not.toContain("git diff");
  });
});

type Detection = {
  services: string[];
  marketing: boolean;
  app: boolean;
  admin: boolean;
  any: boolean;
  configured: boolean;
};

/**
 * `jq -cn '$ARGS.positional' --args ...` on PATH.
 *
 * GitHub's ubuntu runners ship jq; a Windows dev machine generally does not. The
 * shim is only prepended when the real thing is missing, so CI exercises real jq
 * and a laptop still gets a meaningful run. It covers exactly the one invocation
 * the workflow makes: plain string arguments to a JSON array.
 */
function jqShimDirectory(): string | null {
  const probe = spawnSync("bash", ["-c", "command -v jq"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim().length > 0) return null;

  const directory = mkdtempSync(join(tmpdir(), "somnus-jq-"));
  directories.push(directory);
  const shim = [
    "#!/usr/bin/env bash",
    "args=(); seen=0",
    'for a in "$@"; do',
    '  if [ "$seen" = 1 ]; then args+=("$a"); fi',
    '  if [ "$a" = "--args" ]; then seen=1; fi',
    "done",
    'out="["; first=1',
    `for a in \${args[@]+"\${args[@]}"}; do`,
    '  if [ $first -eq 0 ]; then out="$out,"; fi',
    '  out="$out\\"$a\\""; first=0',
    "done",
    'echo "$out]"',
    "",
  ].join("\n");
  const path = join(directory, "jq");
  writeFileSync(path, shim);
  chmodSync(path, 0o755);
  return directory;
}

const shimDirectory = jqShimDirectory();

/** Runs the real classification over a given set of changed paths. */
function detect(changed: string[] | "ALL", artifactsProject = "the-somnus"): Detection {
  const directory = mkdtempSync(join(tmpdir(), "somnus-detect-"));
  directories.push(directory);

  const scriptPath = join(directory, "detect.sh");
  const outputPath = join(directory, "github_output");
  writeFileSync(outputPath, "");

  const changedValue = changed === "ALL" ? "ALL" : changed.join("\n");
  const body = script;
  writeFileSync(
    scriptPath,
    ["set -euo pipefail", `changed=${JSON.stringify(changedValue)}`, body, ""].join("\n"),
  );

  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      ARTIFACTS_PROJECT_ID: artifactsProject,
      EVENT_NAME: "",
      PATH: `${shimDirectory ? `${shimDirectory}:` : ""}${process.env["PATH"] ?? ""}`,
    },
  });

  if (result.status !== 0) {
    throw new Error(`detection script failed (${result.status}): ${result.stderr}`);
  }

  const outputs = new Map<string, string>();
  for (const line of readFileSync(outputPath, "utf8").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) outputs.set(line.slice(0, index), line.slice(index + 1));
  }

  return {
    services: JSON.parse(outputs.get("services") ?? "[]") as string[],
    marketing: outputs.get("marketing") === "true",
    app: outputs.get("app") === "true",
    admin: outputs.get("admin") === "true",
    any: outputs.get("any") === "true",
    configured: outputs.get("configured") === "true",
  };
}

describe("a change scoped only to the admin console", () => {
  it("is detected, and does not report that there is nothing to deploy", () => {
    // The regression this whole file exists for. Before Addendum A §A2.1 was
    // wired into the pipeline, this produced any=false and shipped nothing.
    const result = detect(["apps/somnus-admin/src/screens/UsersScreen.tsx"]);

    expect(result.admin).toBe(true);
    expect(result.any).toBe(true);
  });

  it("does not drag the other two frontends or any service along with it", () => {
    // §A2.1's stated reason for a separate site is a separate deploy cadence;
    // detection has to honour that or the isolation is only on paper.
    const result = detect(["apps/somnus-admin/src/routes/ConsoleHome.tsx"]);

    expect(result.app).toBe(false);
    expect(result.marketing).toBe(false);
    expect(result.services).toEqual([]);
  });

  it("is detected for any file under the console, not just src", () => {
    expect(detect(["apps/somnus-admin/package.json"]).admin).toBe(true);
    expect(detect(["apps/somnus-admin/vite.config.ts"]).admin).toBe(true);
  });
});

describe("the other frontends stay correctly scoped", () => {
  it("an app-only change does not deploy the admin console", () => {
    const result = detect(["apps/somnus-app/src/App.tsx"]);

    expect(result.app).toBe(true);
    expect(result.admin).toBe(false);
    expect(result.marketing).toBe(false);
  });

  it("a marketing-only change does not deploy the admin console", () => {
    const result = detect(["apps/somnus-marketing/src/pages/index.astro"]);

    expect(result.marketing).toBe(true);
    expect(result.admin).toBe(false);
    expect(result.app).toBe(false);
  });

  it("a service-only change touches no frontend", () => {
    const result = detect(["services/somnus-identity-service/src/main.ts"]);

    expect(result.services).toEqual(["somnus-identity-service"]);
    expect(result.admin).toBe(false);
    expect(result.app).toBe(false);
    expect(result.marketing).toBe(false);
  });
});

describe("changes that legitimately reach the admin console", () => {
  it("a shared TypeScript package rebuilds it along with everything else", () => {
    // The console imports @somnus/api-contracts like the other TS deployables.
    const result = detect(["packages/api-contracts/src/index.ts"]);

    expect(result.admin).toBe(true);
    expect(result.app).toBe(true);
    expect(result.marketing).toBe(true);
    expect(result.services.length).toBeGreaterThan(0);
  });

  it("firebase.json reaches both SPA sites, since it configures both", () => {
    const result = detect(["firebase.json"]);

    expect(result.admin).toBe(true);
    expect(result.app).toBe(true);
  });

  it("a change to the reusable deploy workflow redeploys the frontends it runs", () => {
    const result = detect([".github/workflows/deploy-environment.yml"]);

    expect(result.admin).toBe(true);
    expect(result.app).toBe(true);
  });

  it("a first push (no reliable base) rebuilds everything, console included", () => {
    const result = detect("ALL");

    expect(result.admin).toBe(true);
    expect(result.any).toBe(true);
  });
});

describe("the pipeline still reports nothing to do when nothing relevant changed", () => {
  it("a docs-only change deploys none of it", () => {
    const result = detect(["docs/runbooks/promotion-pipeline.md", "README.md"]);

    expect(result.admin).toBe(false);
    expect(result.app).toBe(false);
    expect(result.marketing).toBe(false);
    expect(result.services).toEqual([]);
    expect(result.any).toBe(false);
  });
});

describe("the pipeline stays dormant until it is configured", () => {
  it("reports configured=false when ARTIFACTS_PROJECT_ID is unset", () => {
    // This is why the missing admin coverage was invisible: nothing downstream of
    // `detect` has ever run. See docs/runbooks/promotion-pipeline.md.
    expect(detect(["apps/somnus-admin/src/App.tsx"], "").configured).toBe(false);
  });

  it("reports configured=true once it is set", () => {
    expect(detect(["apps/somnus-admin/src/App.tsx"], "the-somnus").configured).toBe(true);
  });
});

/**
 * Detecting "the admin console changed" is only half of it: the flag has to
 * survive the trip into the reusable workflow and come out as an actual deploy.
 *
 * There is one `deploy-environment.yml`, invoked three times -- so the place three
 * copies of anything exist is deploy.yml's promotion calls, and a flag added to
 * one of them and forgotten in the other two is the mistake worth guarding.
 */
describe("the admin flag reaches an actual deploy step", () => {
  it("the reusable workflow accepts it as a declared boolean input", () => {
    const inputs = environmentWorkflow.slice(
      environmentWorkflow.indexOf("    inputs:"),
      environmentWorkflow.indexOf("permissions:"),
    );
    const declaration = inputs.slice(inputs.indexOf("      admin:"));

    expect(inputs, "deploy-environment.yml declares no `admin` input").toContain("      admin:");
    expect(declaration).toContain("required: true");
    expect(declaration).toContain("type: boolean");
  });

  it("there is exactly one admin deploy step, gated on that input", () => {
    expect(environmentWorkflow.match(/--only hosting:admin/g) ?? []).toHaveLength(1);

    const step = environmentWorkflow.slice(
      environmentWorkflow.indexOf("- name: Build + deploy the admin console"),
    );
    expect(step).toContain(`if: \${{ inputs.admin }}`);
    expect(step).toContain("target:apply hosting admin");
    expect(step).toContain("vars.ADMIN_SITE_ID");
  });

  it("the shared frontend setup runs when only the console changed", () => {
    // Without this the setup steps are skipped and the deploy step runs with no
    // node, no pnpm and no dependencies installed. Only the *shared* gates are
    // examined -- the compound ones. Each frontend's own deploy step is gated on
    // itself alone, and must stay that way.
    const gates = environmentWorkflow.match(/if: \$\{\{ inputs\.marketing \|\|[^}]*\}\}/g) ?? [];

    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      expect(gate, `a frontend setup gate omits the console: ${gate}`).toContain("inputs.admin");
    }
  });
});

/**
 * A push classifies changes and may build an image. Publishing a revision is one
 * manual call, and only to dev. The reusable workflow still declares the admin
 * input; this dispatch does not deploy frontends.
 */
describe("publishing a revision is one manual call to dev", () => {
  const invocations =
    workflow.match(/uses: \.\/\.github\/workflows\/deploy-environment\.yml/g) ?? [];

  it("deploy.yml calls the reusable workflow once", () => {
    expect(invocations).toHaveLength(1);
  });

  it("that call runs only from a manual dispatch", () => {
    const call = workflow.slice(workflow.indexOf("  deploy:\n"));
    expect(call).toContain("github.event_name == 'workflow_dispatch'");
    expect(call).toContain("marketing: false");
    expect(call).toContain("app: false");
    expect(call).toContain("admin: false");
  });

  it("the environment choice is dev and nothing else", () => {
    const options = workflow.slice(
      workflow.indexOf("      environment:\n"),
      workflow.indexOf("      image_tag:"),
    );
    expect(options).toContain("- dev");
    expect(options).not.toContain("- staging");
    expect(options).not.toContain("- production");
  });

  it("the detect job still publishes the admin flag", () => {
    expect(workflow).toContain(`      admin: \${{ steps.detect.outputs.admin }}`);
  });
});

describe("workflow scripts do not interpolate actions expressions", () => {
  function runBodies(yaml: string): string[] {
    const lines = yaml.split("\n");
    const bodies: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const inline = line.match(/^(\s+)run:\s+(.+)$/);
      if (inline?.[2] && !inline[2].startsWith("|") && !inline[2].startsWith(">")) {
        bodies.push(inline[2]);
        continue;
      }
      const block = line.match(/^(\s+)run:\s+\|\s*$/);
      if (!block?.[1]) continue;
      const indent = block[1].length;
      const buf: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (next.trim() === "") {
          buf.push(next);
          continue;
        }
        const lead = next.match(/^ */)?.[0].length ?? 0;
        if (lead <= indent) break;
        buf.push(next);
      }
      bodies.push(buf.join("\n"));
    }
    return bodies;
  }

  it("neither deploy workflow puts an expression inside a run script", () => {
    for (const yaml of [workflow, environmentWorkflow]) {
      for (const body of runBodies(yaml)) {
        expect(body).not.toContain("${{");
      }
    }
  });
});
