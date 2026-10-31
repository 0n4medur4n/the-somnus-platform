import { execFile } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = process.cwd();
const sentinel = "NOX_DEV_MOCK_SENTINEL";
const previewBypass = "?preview=";

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else out.push(path);
  }
  return out;
}

async function build(args: string[], outDir: string): Promise<void> {
  const directory = join(appRoot, outDir);
  rmSync(directory, { recursive: true, force: true });
  const viteBin = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  try {
    await execFileAsync(process.execPath, [viteBin, "build", ...args, "--outDir", outDir], {
      cwd: appRoot,
      timeout: 120_000,
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    throw new Error(`vite build failed\n${failed.stdout ?? ""}\n${failed.stderr ?? ""}`);
  }
}

function expectNoMock(outDir: string): void {
  const built = filesIn(join(appRoot, outDir));
  expect(built.some((path) => path.endsWith(".js"))).toBe(true);
  for (const path of built) {
    const text = readFileSync(path, "utf8");
    expect(text, path).not.toContain(sentinel);
    expect(text, path).not.toContain(previewBypass);
    expect(text, path).not.toContain("nox-me.mock");
  }
}

describe("bundles outside development and test", () => {
  const mockSource = readFileSync(join(appRoot, "src/api/nox-me.mock.ts"), "utf8");
  const liveSource = readFileSync(join(appRoot, "src/api/nox-me.live.ts"), "utf8");

  it("the mock source carries the sentinel and the preview bypass; the live source does not", () => {
    expect(mockSource).toContain(sentinel);
    expect(mockSource).toContain(previewBypass);
    expect(liveSource).not.toContain(sentinel);
    expect(liveSource).not.toContain(previewBypass);
  });

  it("a build with no --mode contains neither", async () => {
    await build([], "dist/no-mode");
    expectNoMock("dist/no-mode");
  }, 120_000);

  it("a staging build contains neither", async () => {
    await build(["--mode", "staging"], "dist/staging");
    expectNoMock("dist/staging");
  }, 120_000);
});
