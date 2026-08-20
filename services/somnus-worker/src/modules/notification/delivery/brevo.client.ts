import type { EmailMessage } from "../templates/render.js";

export type EmailSender = { email: string; name: string };

/**
 * The email provider seam (build plan §3.7: Brevo transactional API, called only
 * from the worker). Mocked in every test — the real adapter is never hit without
 * a key. A later provider swap only reimplements this interface.
 */
export interface EmailProvider {
  /** Deliver the message; returns the provider's message id. Throws on failure. */
  send(to: string, message: EmailMessage): Promise<string>;
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export class BrevoClient implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly sender: EmailSender,
  ) {}

  async send(to: string, message: EmailMessage): Promise<string> {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });

    if (!response.ok) {
      // No response body is logged: it can echo the recipient. Status only.
      throw new Error(`brevo send failed: ${response.status}`);
    }

    const body = (await response.json()) as { messageId?: string };
    return body.messageId ?? "";
  }
}
