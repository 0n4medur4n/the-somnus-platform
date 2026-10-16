import type { NotificationTask } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";

/** The worker's Notification module consumes tasks here (build plan §5.7). */
export const NOTIFICATION_TASKS_PATH = "/internal/v1/notifications/tasks";

/** DI token: where edge-api hands an email to be sent. */
export const NOTIFICATION_QUEUE = Symbol("NOTIFICATION_QUEUE");

export interface NotificationQueue {
  /** Resolves once the task is accepted for delivery; throws when it is not. */
  enqueue(task: NotificationTask, correlationId: string): Promise<void>;
}

/**
 * Local development and tests: no queue, the task is posted to the worker and
 * the caller waits for the send.
 */
export class DirectWorkerNotificationQueue implements NotificationQueue {
  constructor(private readonly worker: CloudRunClient) {}

  async enqueue(task: NotificationTask, correlationId: string): Promise<void> {
    await this.worker.post(NOTIFICATION_TASKS_PATH, { correlationId, body: task });
  }
}

export type CloudTasksQueueOptions = {
  /** `projects/<p>/locations/<l>/queues/<q>`. */
  queue: string;
  workerBaseUrl: string;
  /** OIDC audience the worker's Cloud Run IAM checks. */
  audience: string;
  /** Service account Cloud Tasks signs the push as (holds run.invoker on the worker). */
  invokerServiceAccount: string;
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const CLOUD_TASKS_API = "https://cloudtasks.googleapis.com/v2";

/**
 * Deployed: the task goes on a Cloud Tasks queue and the caller is answered as
 * soon as it is queued. Cloud Tasks pushes it to the worker (waking it if it
 * is asleep) and retries on a 503, up to the queue's max attempts -- the
 * Notification module's dedupe by idempotency key makes a retry safe.
 *
 * Called over the REST API with the runtime's own access token; the task body
 * holds the recipient and the link, so it is never logged here.
 */
export class CloudTasksNotificationQueue implements NotificationQueue {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CloudTasksQueueOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async enqueue(task: NotificationTask, correlationId: string): Promise<void> {
    const { queue, workerBaseUrl, audience, invokerServiceAccount } = this.options;
    const token = await this.options.getAccessToken();
    const response = await this.fetchImpl(`${CLOUD_TASKS_API}/${queue}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: new URL(NOTIFICATION_TASKS_PATH, workerBaseUrl).toString(),
            headers: { "content-type": "application/json", "x-correlation-id": correlationId },
            body: Buffer.from(JSON.stringify(task), "utf8").toString("base64"),
            oidcToken: { serviceAccountEmail: invokerServiceAccount, audience },
          },
        },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    if (!response.ok) {
      // Status only: the API's error body can echo the request.
      throw new Error(`cloud tasks enqueue failed: ${response.status}`);
    }
  }
}
