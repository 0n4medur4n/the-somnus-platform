import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const publicConfig = {
  VITE_EDGE_API_URL: "https://edge.example.com",
  VITE_FIREBASE_API_KEY: `AIza${"a".repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: "somnus-test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "somnus-test",
};
const executableConfig = `const config=${JSON.stringify(publicConfig)};`;
function bundle() {
  const directory = mkdtempSync(join(tmpdir(), "somnus-hosting-"));
  directories.push(directory);
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "index.html"), '<script src="/assets/app.js"></script>');
  writeFileSync(
    join(directory, "hosting-config.json"),
    JSON.stringify({ environment: "dev", ...publicConfig }),
  );
  writeFileSync(join(directory, "assets/app.js"), executableConfig);
  return directory;
}
function check(directory: string) {
  return spawnSync(process.execPath, ["scripts/check-hosting-bundle.mjs", directory], {
    encoding: "utf8",
  });
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}somnus-hosting-`)) {
      throw new Error("Unsafe temporary test directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Hosting deploy guard regression (negative cases are immutable)", () => {
  it.each(["dev", "staging", "production"])("accepts a clean %s bundle", (environment) => {
    const directory = bundle();
    writeFileSync(
      join(directory, "hosting-config.json"),
      JSON.stringify({ environment, ...publicConfig }),
    );
    expect(check(directory).status).toBe(0);
  });
  it.each([
    "http://localhost:8080/v1/me",
    "LOCALHOST",
    "demo-api-key",
    "somnus-dev-test",
    "http://127.0.0.1:9099",
    "http://127.1.2.3:8080",
    "http://0.0.0.0:8080",
    "http://[::1]:9099",
    "demo-test.firebaseapp.com",
    "http://emulator:4400",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIRESTORE_EMULATOR_HOST",
  ])("exits nonzero for bundled marker %s", (marker) => {
    const directory = bundle();
    writeFileSync(join(directory, "assets/app.js"), `const config = ${JSON.stringify(marker)};`);
    const result = check(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local/emulator marker");
  });
  it("scans nested assets, HTML and source maps", () => {
    for (const file of ["index.html", "assets/app.js.map", "assets/lazy/chunk.js"]) {
      const directory = bundle();
      mkdirSync(join(directory, "assets/lazy"));
      writeFileSync(join(directory, file), "demo-api-key");
      expect(check(directory).status).toBe(1);
    }
  });
  it("rejects missing output and a local bundle without Hosting metadata", () => {
    const directory = bundle();
    expect(check(join(directory, "missing")).status).toBe(1);
    rmSync(join(directory, "hosting-config.json"));
    expect(check(directory).status).toBe(1);
  });
  it("rejects an invalid environment", () => {
    const directory = bundle();
    writeFileSync(join(directory, "hosting-config.json"), '{"environment":"local"}');
    expect(check(directory).status).toBe(1);
  });
  it("permits only React Router's exact dummy-origin expression", () => {
    const directory = bundle();
    const router =
      'let i="http://localhost";e&&(i=e.location.origin!=="null"?e.location.origin:e.location.href)';
    writeFileSync(join(directory, "assets/app.js"), executableConfig + router);
    expect(check(directory).status).toBe(0);
    writeFileSync(join(directory, "assets/app.js"), `${router};fetch("http://localhost")`);
    expect(check(directory).status).toBe(1);
  });
  it("keeps both Hosting workflows and direct deploys guarded", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci.slice(ci.indexOf("  deploy-hosting:"))).toContain("build:hosting --mode hosting-dev");
    const promotion = readFileSync(".github/workflows/deploy-environment.yml", "utf8");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable in YAML
    expect(promotion).toContain('build:hosting --mode "hosting-${HOSTING_ENVIRONMENT}"');
    const config = JSON.parse(readFileSync("firebase.json", "utf8")) as {
      hosting: { target: string; predeploy?: string[] }[];
    };
    expect(config.hosting.find((target) => target.target === "app")?.predeploy).toContain(
      "node scripts/check-hosting-bundle.mjs apps/somnus-app/dist",
    );
  });
  it("rejects metadata values omitted from the actual executable bundle", () => {
    const directory = bundle();
    writeFileSync(join(directory, "assets/app.js"), "const env={PROD:true};");
    const result = check(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing from executable JavaScript");
  });
});
