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
 *
 * Two assessment flows, two pairs (FUNNEL_V2_ENABLED is read by morpheo, the
 * app asks which flow runs): morpheo :8080 with v2 off behind edge :8090 for
 * the v1 specs, and morpheo :8081 with v2 on behind edge :8091 for the specs
 * tagged @v2. Side by side, so nothing is restarted between the two runs.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const root = process.cwd();
const procs = [];

/**
 * The E2E stack's own rate-limit budget (build plan §21).
 *
 * edge-api's limiter is global and keyed by client IP, not scoped to a route --
 * `/health/live` counts against it too, as its own negative test shows. The
 * whole suite arrives from 127.0.0.1, so every request the run makes (the
 * health polls this script makes, plus twenty-odd calls per test across the
 * nineteen sequential tests) shares one budget of 100 per minute. Later tests
 * then take 429s that have nothing to do with what they are testing: a session
 * exchange fails, and the screen blames the emailed link.
 *
 * This is the limiter working as designed, so the limit does not move -- dev,
 * staging and production all still run on edge-api's schema default, which
 * nothing anywhere overrides. Only this harness gets a bigger budget, and it
 * stays a real limit: a runaway loop still trips it.
 *
 * `tests/e2e-rate-limit.test.ts` fails if this value ever stops diverging from
 * that default, so the divergence cannot be closed from the production side.
 */
const E2E_RATE_LIMIT_MAX = "5000";

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
function startMorpheo(name, port, cwd, extraEnv) {
  return spawnService(
    name,
    "uv",
    ["run", "uvicorn", "morpheo.main:app", "--host", "127.0.0.1", "--port", port],
    cwd,
    extraEnv,
    true,
  );
}

function edgeEnv(port, morpheoPort) {
  return {
    PORT: port,
    SERVICE_NAME: "somnus-edge-api",
    NODE_ENV: "development",
    FIREBASE_PROJECT_ID: "somnus-dev-test",
    // Sessions live in their own project (see edge-config). Set explicitly so
    // the stack does not depend on the default matching.
    FIRESTORE_PROJECT_ID: "somnus-dev-test",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:9098",
    IDENTITY_BASE_URL: "http://localhost:3001",
    MORPHEO_BASE_URL: `http://localhost:${morpheoPort}`,
    INTERNAL_AUTH_MODE: "insecure-dev",
    COOKIE_SECURE: "false",
    // Only the ceiling moves; the window stays at the production default so
    // the two configurations differ on exactly one axis.
    RATE_LIMIT_MAX: E2E_RATE_LIMIT_MAX,
    CORS_ORIGINS: "http://localhost:5173,http://localhost:4173",
  };
}

function runPlaywright(edgeUrl, filterArgs) {
  const pwArgs = ["--filter", "@somnus/app", "exec", "playwright", "test", ...filterArgs];
  const grep = process.env["PW_GREP"];
  if (grep) pwArgs.push("-g", grep);
  const pw = spawn("pnpm", pwArgs, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      VITE_EDGE_API_URL: edgeUrl,
      VITE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099",
      VITE_FIREBASE_PROJECT_ID: "somnus-dev-test",
    },
  });
  return new Promise((resolve) => pw.on("exit", (code) => resolve(code ?? 1)));
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
  const morpheoDb = {
    DATABASE_URL: "mysql+pymysql://root:rootpw@127.0.0.1:3306/somnus_morpheo",
    ENV: "development",
  };
  startMorpheo("morpheo-v1", "8080", `${root}/services/morpheo-service`, {
    ...morpheoDb,
    FUNNEL_V2_ENABLED: "false",
  });
  startMorpheo("morpheo-v2", "8081", `${root}/services/morpheo-service`, {
    ...morpheoDb,
    FUNNEL_V2_ENABLED: "true",
    // The AI from recorded model outputs: no model is called in E2E.
    AI_FIXTURE_FILE: `${root}/services/morpheo-service/tests/fixtures/ai/recordings_v2.json`,
  });
  start("edge-api", `${root}/services/somnus-edge-api`, edgeEnv("8090", "8080"));
  start("edge-api-v2", `${root}/services/somnus-edge-api`, edgeEnv("8091", "8081"));

  await waitHealth("http://localhost:3001/health/live", "identity");
  await waitHealth("http://localhost:8080/health/live", "morpheo-v1");
  await waitHealth("http://localhost:8081/health/live", "morpheo-v2");
  await waitHealth("http://localhost:8090/health/live", "edge-api");
  await waitHealth("http://localhost:8091/health/live", "edge-api-v2");

  // The v1 specs with v2 off, then the @v2 specs with it on. Both always run.
  const v1 = await runPlaywright("http://localhost:8090", ["--grep-invert", "@v2"]);
  const v2 = await runPlaywright("http://localhost:8091", ["--grep", "@v2"]);
  exitCode = v1 !== 0 ? v1 : v2;
} catch (err) {
  console.error(err);
} finally {
  shutdown();
}
await sleep(500);
process.exit(exitCode);
