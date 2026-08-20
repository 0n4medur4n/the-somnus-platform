import { afterEach, describe, expect, it, vi } from "vitest";
import { BrevoClient } from "../src/modules/notification/delivery/brevo.client.js";

const message = { subject: "Hola", html: "<p>Hola</p>", text: "Hola" };
const sender = { email: "no-reply@somnus.example", name: "The Somnus" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrevoClient", () => {
  it("POSTs to the Brevo API with the key header and returns the message id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "brevo-42" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const id = await new BrevoClient("secret-key", sender).send("to@example.com", message);

    expect(id).toBe("brevo-42");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("secret-key");
    expect(String(init.body)).toContain("to@example.com");
  });

  it("throws on a non-2xx response (status only, no body echoed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    await expect(new BrevoClient("k", sender).send("to@example.com", message)).rejects.toThrow(
      "500",
    );
  });
});
