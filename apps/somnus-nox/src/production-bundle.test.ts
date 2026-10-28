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

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else out.push(path);
  }
  return out;
}

describe("production build", () => {
  it("contains no dev mock", async () => {
    const mockSource = readFileSync(join(appRoot, "src/api/nox-me.mock.ts"), "utf8");
    expect(mockSource).toContain(sentinel);
    expect(readFileSync(join(appRoot, "src/api/nox-me.live.ts"), "utf8")).not.toContain(sentinel);

    rmSync(join(appRoot, "dist"), { recursive: true, force: true });
    const viteBin = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
    try {
      await execFileAsync(process.execPath, [viteBin, "build", "--mode", "production"], {
        cwd: appRoot,
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: "production" },
      });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      throw new Error(`vite build failed\n${failed.stdout ?? ""}\n${failed.stderr ?? ""}`);
    }

    const built = filesIn(join(appRoot, "dist"));
    expect(built.some((path) => path.endsWith(".js"))).toBe(true);
    for (const path of built) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toContain(sentinel);
      expect(text, path).not.toContain("nox-me.mock");
    }
  }, 120_000);
});
