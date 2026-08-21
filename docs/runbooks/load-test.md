# Runbook: load test (public path)

Build plan **Checkpoint 13.3**. Load-tests the public path — **login,
assessment, claim, report download** — including **cold-start percentiles**, and
records the baselines used to set the monitoring alert thresholds. Exit-relevant:
alert thresholds are set from *observed* baselines, not guesses.

Harness: [loadtest/public-path.js](../../loadtest/public-path.js) (k6). It models
the real edge routes end to end and measures cold starts separately from
steady-state latency.

> Run against a **deployed dev or staging** environment. Never load-test
> production under real user traffic — schedule a maintenance window and use the
> staging environment as the production proxy.

---

## 1. Why cold starts matter here

Min-instances is **0** on every service (build plan §2), so the first request to
a service that has scaled to zero pays a cold start (container start + app boot +
first DB connection). Users on the public path hit this whenever a service has
been idle. The `cold_start` scenario measures it deliberately (readiness probe
after idle) and reports `cold_start_ttfb` percentiles, kept separate from the
warm `http_req_duration` so a cold p99 does not hide inside the steady-state
numbers.

## 2. Prerequisites

- **k6** installed (`k6 version`).
- A **deployed** environment and its public edge URL (`BASE_URL`).
- For the authenticated tail (login → claim → report), a **real Firebase ID
  token** for a test user. Mint one by signing the test user in against the
  environment's Firebase project (Identity Toolkit REST
  `accounts:signInWithPassword`, or exchange a custom token). The **anonymous**
  portion (content → create → answer → summary) runs with **no** token, so a
  first pass needs no auth setup.
- The answer payload in the script is a `TODO` placeholder — fill it from the
  live `GET /v1/assessments/content` contract so the answer step does not 400.

## 3. Run it

```bash
# Anonymous path only (no auth needed):
k6 run -e BASE_URL=https://<edge-dev-url> loadtest/public-path.js

# Full path including the authenticated tail:
k6 run \
  -e BASE_URL=https://<edge-dev-url> \
  -e FIREBASE_ID_TOKEN=<id-token> \
  loadtest/public-path.js
```

Tune `options.scenarios.public_journey.stages` (VUs / duration) to the load you
want to characterize. Start small — this hits real services that scale from zero.

## 4. Read the results

| Metric | Meaning | What to record |
|--------|---------|----------------|
| `cold_start_ttfb` | First-byte latency on a scaled-to-zero service | p50 / p95 / p99 |
| `http_req_duration{scenario:public_journey}` | Warm steady-state latency | p95 / p99 |
| `http_req_failed` | Transport/HTTP error rate | rate |
| `journey_errors` | Failed business checks along the path | rate |

The k6 `thresholds` in the script are **conservative placeholders** (warm p95 <
1.5 s, cold p95 < 8 s, errors < 1%). Replace them with values derived from the
first real run so the test guards against regressions from the true baseline.

## 5. Set the alert thresholds from the baselines

Feed the observed baselines back into the monitoring alerts the build plan calls
for. The edge 5xx alert is already a per-environment Terraform variable
(`edge_5xx_threshold`, `modules/environment`); the rest are alerts to add/tune as
their signals come online.

| Signal (build plan §13.3) | Source metric | How to set from baseline |
|---------------------------|---------------|--------------------------|
| Elevated 5xx | `run.googleapis.com/request_count{response_code_class="5xx"}` | Set `edge_5xx_threshold` a margin above the observed steady-state 5xx/min (near 0); re-apply Terraform. |
| Failed readiness | Cloud Run startup/liveness probe failures | Alert on sustained probe failures; the cold-start p99 informs the probe timeout. |
| Pool exhaustion | App DB-pool metric / connection errors in logs | Threshold above the peak concurrent connections seen at target VUs. |
| Dead-letter tasks | Cloud Tasks queue depth / dead-letter count | Alert on any sustained dead-letter growth. |
| Report failures | report-service error rate / failed render logs | Threshold above the observed failed-render rate (target 0). |
| Auth anomalies | edge 401/403 rate, Firebase auth errors | Baseline the normal 401/403 rate; alert on deviation. |
| Cost spikes | Billing budget alerts | Budgets already set per project (`budget_amount_units`); tune from observed spend. |

## 6. Results log

Record each run so thresholds trace to real numbers. Re-run after any change that
could shift latency (new dependency, region change, image base bump).

| Date | Env | VUs | cold p95 (ms) | warm p95 (ms) | error rate | Notes / threshold changes |
|------|-----|-----|---------------|---------------|-----------|---------------------------|
| _pending_ | dev | | | | | first baseline run required before prod sign-off |
| _pending_ | staging | | | | | production proxy |

> ⚠️ These rows are part of the Checkpoint 13.3 exit. Fill in at least a dev and a
> staging baseline, and set the Terraform alert thresholds from them, before the
> production-readiness sign-off (§22 DoD sweep).
