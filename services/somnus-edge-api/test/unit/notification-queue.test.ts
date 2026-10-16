import { describe, expect, it, vi } from "vitest";
import {
  CloudTasksNotificationQueue,
  DirectWorkerNotificationQueue,
} from "../../src/infrastructure/notification-queue/notification-queue.js";

const TASK = {
  idempotencyKey: "sign-in-link:1",
  type: "sign_in_link" as const,
  to: "ada@example.com",
  locale: "es" as const,
  link: "https://app.thesomnus.com/auth/callback?mode=signIn&oobCode=C&lng=es",
  params: {},
};

describe("CloudTasksNotificationQueue", () => {
  const options = {
    queue: "projects/the-somnus/locations/europe-west3/queues/notifications",
    workerBaseUrl: "https://somnus-worker-abc-ey.a.run.app",
    audience: "https://somnus-worker-abc-ey.a.run.app",
    invokerServiceAccount: "somnus-edge-api@the-somnus.iam.gserviceaccount.com",
    getAccessToken: async () => "access-token",
  };

  it("creates a task that pushes the notification to the worker, signed as the invoker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await new CloudTasksNotificationQueue({ ...options, fetchImpl }).enqueue(TASK, "corr-1");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://cloudtasks.googleapis.com/v2/projects/the-somnus/locations/europe-west3/queues/notifications/tasks",
    );
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer access-token");
    const { task } = JSON.parse(init.body as string) as {
      task: {
        httpRequest: {
          url: string;
          httpMethod: string;
          headers: Record<string, string>;
          body: string;
          oidcToken: { serviceAccountEmail: string; audience: string };
        };
      };
    };
    expect(task.httpRequest.httpMethod).toBe("POST");
    expect(task.httpRequest.url).toBe(
      "https://somnus-worker-abc-ey.a.run.app/internal/v1/notifications/tasks",
    );
    expect(task.httpRequest.headers["x-correlation-id"]).toBe("corr-1");
    expect(task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: options.invokerServiceAccount,
      audience: options.audience,
    });
    expect(JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString("utf8"))).toEqual(TASK);
  });

  it("throws when the queue refuses the task, without echoing the API's answer", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"ada@example.com"}', { status: 403 }));
    const queue = new CloudTasksNotificationQueue({ ...options, fetchImpl });
    await expect(queue.enqueue(TASK, "corr-2")).rejects.toThrow(
      /^cloud tasks enqueue failed: 403$/,
    );
  });
});

describe("DirectWorkerNotificationQueue", () => {
  it("posts the task to the worker (local development and tests)", async () => {
    const post = vi.fn().mockResolvedValue({ status: 201, body: {} });
    await new DirectWorkerNotificationQueue({ post } as never).enqueue(TASK, "corr-3");
    expect(post).toHaveBeenCalledWith("/internal/v1/notifications/tasks", {
      correlationId: "corr-3",
      body: TASK,
    });
  });
});
