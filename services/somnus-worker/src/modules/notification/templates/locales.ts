import type { NotificationType, SupportedLocale } from "@somnus/api-contracts";

export type EmailStrings = {
  subject: string;
  heading: string;
  body: string;
  cta: string;
};

/**
 * Localized email copy for each notification type (build plan §3.7 / §5.7 / four
 * locales). Emails carry a secure link and non-clinical context ONLY — never
 * health details, assessment content, or an L-level. The typed Record forces
 * every locale × every type to exist, so a missing translation fails the build.
 *
 * `{{organizationName}}` / `{{inviterName}}` are interpolated from the task's
 * non-clinical params; the secure link is rendered separately as the CTA.
 */
export const EMAIL_STRINGS: Record<SupportedLocale, Record<NotificationType, EmailStrings>> = {
  es: {
    invitation: {
      subject: "Te han invitado a The Somnus",
      heading: "Invitación",
      body: "Has recibido una invitación para unirte a {{organizationName}}. Usa el enlace seguro para aceptarla.",
      cta: "Aceptar invitación",
    },
    report_ready: {
      subject: "Tu informe está listo",
      heading: "Informe disponible",
      body: "Tu informe ya está disponible. Usa el enlace seguro para verlo.",
      cta: "Ver informe",
    },
  },
  en: {
    invitation: {
      subject: "You've been invited to The Somnus",
      heading: "Invitation",
      body: "You've been invited to join {{organizationName}}. Use the secure link to accept it.",
      cta: "Accept invitation",
    },
    report_ready: {
      subject: "Your report is ready",
      heading: "Report available",
      body: "Your report is now available. Use the secure link to view it.",
      cta: "View report",
    },
  },
  ca: {
    invitation: {
      subject: "T'han convidat a The Somnus",
      heading: "Invitació",
      body: "Has rebut una invitació per unir-te a {{organizationName}}. Fes servir l'enllaç segur per acceptar-la.",
      cta: "Acceptar invitació",
    },
    report_ready: {
      subject: "El teu informe està a punt",
      heading: "Informe disponible",
      body: "El teu informe ja està disponible. Fes servir l'enllaç segur per veure'l.",
      cta: "Veure informe",
    },
  },
  fr: {
    invitation: {
      subject: "Vous avez été invité·e à The Somnus",
      heading: "Invitation",
      body: "Vous avez reçu une invitation à rejoindre {{organizationName}}. Utilisez le lien sécurisé pour l'accepter.",
      cta: "Accepter l'invitation",
    },
    report_ready: {
      subject: "Votre rapport est prêt",
      heading: "Rapport disponible",
      body: "Votre rapport est maintenant disponible. Utilisez le lien sécurisé pour le consulter.",
      cta: "Voir le rapport",
    },
  },
};
