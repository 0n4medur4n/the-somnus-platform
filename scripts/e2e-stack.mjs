/**
 * Orchestrates the somnus-app E2E stack (build plan §19 / §20 Checkpoint
 * 9.1). Meant to be wrapped by the Firebase emulators so Auth + Firestore
 * are up for the duration:
 *
 *   just dev-up                    # MySQL (somnus_identity + somnus_consent, migrated)
 *   pnpm -r --filter "./packages/*" build
 *   pnpm --filter @somnus/identity-service --filter @somnus/edge-api build
 *   pnpm --filter @somnus/app exec playwright install chromium
 *   pnpm exec firebase emulators:exec --only auth,firestore \
 *     --project somnus-dev-test \
 *     --config services/somnus-edge-api/test/firebase.emulators.json \
 *     "node scripts/e2e-stack.mjs"
 *
 * It starts the compiled identity (:3001) and edge-api (:8090) against the
 * emulators + docker MySQL, waits for their health, then runs Playwright
 * (which serves the SPA on :5173 itself). edge-api runs on 8090 to dodge a
 * common local Apache on 8080. Set PW_GREP to filter tests. Exits with
 * Playwright's code and tears the services down.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const root = process.cwd();
const procs = [];

function spawnService(name, command, args, cwd, extraEnv, useShell = false) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell,
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code) => console.log(`[${name}] process exited: ${code}`));
  procs.push(child);
  return child;
}

function start(name, cwd, extraEnv) {
  return spawnService(name, process.execPath, ["dist/main.js"], cwd, extraEnv);
}

// morpheo is the Python service (build plan §5.5); it runs under uvicorn, not
// `node dist/main.js`, against the docker MySQL `somnus_morpheo` (migrated by
// `just dev-up` / the CI job).
function startMorpheo(cwd, extraEnv) {
  return spawnService(
    "morpheo",
    "uv",
    ["run", "uvicorn", "morpheo.main:app", "--host", "127.0.0.1", "--port", "8080"],
    cwd,
    extraEnv,
    true,
  );
}

async function waitHealth(url, name, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.log(`[e2e-stack] ${name} healthy after ${i + 1}s`);
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`[e2e-stack] ${name} not healthy at ${url}`);
}

function shutdown() {
  for (const c of procs) {
    try {
      c.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

let exitCode = 1;
try {
  start("identity", `${root}/services/somnus-identity-service`, {
    PORT: "3001",
    SERVICE_NAME: "somnus-identity-service",
    NODE_ENV: "development",
  });
  startMorpheo(`${root}/services/morpheo-service`, {
    DATABASE_URL: "mysql+pymysql://root:rootpw@127.0.0.1:3306/somnus_morpheo",
    ENV: "development",
  });
  start("edge-api", `${root}/services/somnus-edge-api`, {
    PORT: "8090",
    SERVICE_NAME: "somnus-edge-api",
    NODE_ENV: "development",
    FIREBASE_PROJECT_ID: "somnus-dev-test",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:9098",
    IDENTITY_BASE_URL: "http://localhost:3001",
    MORPHEO_BASE_URL: "http://localhost:8080",
    INTERNAL_AUTH_MODE: "insecure-dev",
    COOKIE_SECURE: "false",
    CORS_ORIGINS: "http://localhost:5173,http://localhost:4173",
  });

  await waitHealth("http://localhost:3001/health/live", "identity");
  await waitHealth("http://localhost:8080/health/live", "morpheo");
  await waitHealth("http://localhost:8090/health/live", "edge-api");

  const grep = process.env["PW_GREP"];
  const pwArgs = ["--filter", "@somnus/app", "exec", "playwright", "test"];
  if (grep) pwArgs.push("-g", grep);
  const pw = spawn("pnpm", pwArgs, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      VITE_EDGE_API_URL: "http://localhost:8090",
      VITE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099",
      VITE_FIREBASE_PROJECT_ID: "somnus-dev-test",
    },
  });
  exitCode = await new Promise((resolve) => pw.on("exit", (code) => resolve(code ?? 1)));
} catch (err) {
  console.error(err);
} finally {
  shutdown();
}
await sleep(500);
process.exit(exitCode);
