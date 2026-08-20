import type { NotificationType, SupportedLocale } from "@somnus/api-contracts";
import { EMAIL_STRINGS } from "./locales.js";

export type EmailMessage = {
  subject: string;
  html: string;
  text: string;
};

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => params[key] ?? "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a localized email for a notification type. The body carries only the
 * approved copy + non-clinical params; the secure `link` is the CTA. No health
 * detail is ever assembled here (build plan §3.7) — the template test asserts it.
 */
export function renderEmail(
  type: NotificationType,
  locale: SupportedLocale,
  link: string,
  params: Record<string, string>,
): EmailMessage {
  const strings = EMAIL_STRINGS[locale][type];
  const subject = interpolate(strings.subject, params);
  const body = interpolate(strings.body, params);

  const safeLink = escapeHtml(link);
  const html = [
    `<h1>${escapeHtml(strings.heading)}</h1>`,
    `<p>${escapeHtml(body)}</p>`,
    `<p><a href="${safeLink}">${escapeHtml(strings.cta)}</a></p>`,
  ].join("\n");
  const text = `${strings.heading}\n\n${body}\n\n${strings.cta}: ${link}`;

  return { subject, html, text };
}
