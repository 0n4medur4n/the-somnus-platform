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

/** The fallback line under the button, for clients that hide or break it. */
const LINK_FALLBACK: Record<SupportedLocale, string> = {
  es: "Si el botón no funciona, copia este enlace en tu navegador:",
  en: "If the button does not work, copy this link into your browser:",
  ca: "Si el botó no funciona, copia aquest enllaç al navegador:",
  fr: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
};

const BRAND = "The Somnus";

/**
 * The shared layout. Tables and inline styles only: that is what Gmail, Outlook
 * and Apple Mail all render the same way. Light background, one clear button,
 * the raw link repeated as text for clients that drop the button.
 */
function layout(input: {
  locale: SupportedLocale;
  heading: string;
  body: string;
  cta: string;
  link: string;
  note: string | undefined;
}): string {
  const safeLink = escapeHtml(input.link);
  const note = input.note
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#5b6474;">${escapeHtml(input.note)}</p>`
    : "";
  return `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141a2b;">
<tr><td style="background:#0b1225;padding:22px 32px;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:0.2px;">${BRAND}</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:30px;font-weight:600;color:#141a2b;">${escapeHtml(input.heading)}</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:24px;color:#2b3345;">${escapeHtml(input.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#2f6ae0;">
<a href="${safeLink}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(input.cta)}</a>
</td></tr></table>
${note}
<p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#5b6474;">${escapeHtml(LINK_FALLBACK[input.locale])}<br><a href="${safeLink}" style="color:#2f6ae0;word-break:break-all;">${safeLink}</a></p>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #e6e9ef;font-size:12px;line-height:18px;color:#8a92a3;">${BRAND} &middot; thesomnus.com</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
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

  const html = layout({
    locale,
    heading: strings.heading,
    body,
    cta: strings.cta,
    link,
    note: strings.note,
  });
  const text = [
    strings.heading,
    "",
    body,
    "",
    `${strings.cta}: ${link}`,
    ...(strings.note ? ["", strings.note] : []),
    "",
    `${BRAND} · thesomnus.com`,
  ].join("\n");

  return { subject, html, text };
}
