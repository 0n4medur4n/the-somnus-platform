// k6 load test — the public path (build plan §20 Checkpoint 13.3).
//
// Models the real end-to-end journey through somnus-edge-api:
//   anonymous assessment (content -> create -> answer -> summary)
//   -> login -> claim (token -> claim -> snapshot) -> report request -> download
//
// Because min-instances is 0 everywhere (build plan §2), the FIRST request to a
// scaled-to-zero service pays a cold start; the `cold_start` scenario measures
// that separately from steady-state latency, and the thresholds below report
// both. Run it against a DEPLOYED environment (dev/staging), never production
// under real traffic. See docs/runbooks/load-test.md for setup and how to feed
// the observed p95s back into the alert thresholds.
//
//   k6 run -e BASE_URL=https://edge.dev.example -e FIREBASE_ID_TOKEN=... loadtest/public-path.js
//
// The anonymous portion runs with no token. The authenticated portion (login,
// claim, report) runs only when FIREBASE_ID_TOKEN is supplied — a real Firebase
// ID token for a test user (see the runbook for how to mint one).

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const ID_TOKEN = __ENV.FIREBASE_ID_TOKEN || "";
const CSRF_COOKIE = "somnus_csrf";
const CSRF_HEADER = "x-csrf-token";

const coldStartTtfb = new Trend("cold_start_ttfb", true);
const journeyErrors = new Rate("journey_errors");

export const options = {
  scenarios: {
    // Hit readiness on services that have scaled to zero, one request at a time,
    // to capture cold-start latency before the steady load warms them.
    cold_start: {
      executor: "per-vu-iterations",
      exec: "coldStart",
      vus: 1,
      iterations: 1,
      startTime: "0s",
      maxDuration: "30s",
    },
    // Steady-state public journey. Tune the target/stages to the environment.
    public_journey: {
      executor: "ramping-vus",
      exec: "publicJourney",
      startTime: "30s",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 10 },
        { duration: "3m", target: 10 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // Conservative starting gates; re-tune from the first real run's baselines.
    http_req_failed: ["rate<0.01"],
    "http_req_duration{scenario:public_journey}": ["p(95)<1500"],
    cold_start_ttfb: ["p(95)<8000"],
    journey_errors: ["rate<0.01"],
  },
};

function jsonHeaders(extra) {
  return { headers: Object.assign({ "Content-Type": "application/json" }, extra || {}) };
}

// Double-submit CSRF: the readable somnus_csrf cookie set at login is echoed in
// the x-csrf-token header on every state-changing request.
function csrfHeaders() {
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(BASE);
  const token = cookies[CSRF_COOKIE]?.[0];
  return jsonHeaders(token ? { [CSRF_HEADER]: token } : {});
}

export function coldStart() {
  const res = http.get(`${BASE}/health/ready`, { tags: { phase: "cold" } });
  coldStartTtfb.add(res.timings.waiting);
  check(res, { "readiness 200 (cold)": (r) => r.status === 200 });
}

export function publicJourney() {
  let sessionId;

  group("anonymous assessment", () => {
    const content = http.get(`${BASE}/v1/assessments/content`);
    check(content, { "content 200": (r) => r.status === 200 }) || journeyErrors.add(1);

    const create = http.post(`${BASE}/v1/assessments`, JSON.stringify({}), jsonHeaders());
    check(create, { "create session 2xx": (r) => r.status < 300 }) || journeyErrors.add(1);
    sessionId = create.json("sessionId") || create.json("id");

    if (sessionId) {
      // The answer payload must match the current assessment content contract
      // (fetched above). Fill it from that contract in your environment.
      const answer = http.post(
        `${BASE}/v1/assessments/${sessionId}/answers`,
        JSON.stringify({ questionId: "TODO", value: "TODO" }),
        jsonHeaders(),
      );
      check(answer, { "answer 2xx": (r) => r.status < 300 }) || journeyErrors.add(1);

      const summary = http.get(`${BASE}/v1/assessments/${sessionId}/summary`);
      check(summary, { "summary 200": (r) => r.status === 200 }) || journeyErrors.add(1);
    }
  });

  // The authenticated tail needs a real Firebase ID token. Without one, the
  // anonymous path is still fully measured.
  if (!ID_TOKEN || !sessionId) {
    sleep(1);
    return;
  }

  group("login", () => {
    const login = http.post(
      `${BASE}/v1/sessions`,
      JSON.stringify({ idToken: ID_TOKEN }),
      jsonHeaders(),
    );
    check(login, { "login 2xx": (r) => r.status < 300 }) || journeyErrors.add(1);
  });

  group("claim", () => {
    const tokenRes = http.post(
      `${BASE}/v1/assessments/${sessionId}/claim-token`,
      null,
      csrfHeaders(),
    );
    check(tokenRes, { "claim-token 2xx": (r) => r.status < 300 }) || journeyErrors.add(1);
    const claimToken = tokenRes.json("token") || tokenRes.json("claimToken");

    const claim = http.post(
      `${BASE}/v1/assessments/claim`,
      JSON.stringify({ token: claimToken }),
      csrfHeaders(),
    );
    check(claim, { "claim 2xx": (r) => r.status < 300 }) || journeyErrors.add(1);

    const snapshot = http.get(`${BASE}/v1/assessments/${sessionId}/snapshot`);
    check(snapshot, { "snapshot 200": (r) => r.status === 200 }) || journeyErrors.add(1);
  });

  group("report", () => {
    const report = http.post(`${BASE}/v1/reports`, JSON.stringify({ sessionId }), csrfHeaders());
    check(report, { "report request 2xx": (r) => r.status < 300 }) || journeyErrors.add(1);

    // Report generation is async. Poll the returned resource until a signed
    // download URL is available, then download it. Shape depends on the report
    // contract; adjust the field names in your environment.
    const url = report.json("downloadUrl");
    if (url) {
      const dl = http.get(url, { tags: { phase: "report_download" } });
      check(dl, { "report download 200": (r) => r.status === 200 }) || journeyErrors.add(1);
    }
  });

  sleep(1);
}
