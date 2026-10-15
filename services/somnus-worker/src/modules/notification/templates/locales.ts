import type { NotificationType, SupportedLocale } from "@somnus/api-contracts";

export type EmailStrings = {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  /** A short line under the button (why you got this, what to do if you did not ask). */
  note?: string;
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
    sign_in_link: {
      subject: "Tu enlace para entrar en The Somnus",
      heading: "Entra en tu cuenta",
      body: "Pulsa el botón para entrar en The Somnus. No necesitas contraseña: este enlace es personal y solo funciona una vez.",
      cta: "Entrar en The Somnus",
      note: "Si no has pedido este enlace, ignora este correo: nadie podrá entrar sin acceso a tu bandeja de entrada.",
    },
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
    sign_in_link: {
      subject: "Your link to sign in to The Somnus",
      heading: "Sign in to your account",
      body: "Press the button to sign in to The Somnus. No password needed: this link is personal and works only once.",
      cta: "Sign in to The Somnus",
      note: "If you did not ask for this link, ignore this email: no one can sign in without access to your inbox.",
    },
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
    sign_in_link: {
      subject: "El teu enllaç per entrar a The Somnus",
      heading: "Entra al teu compte",
      body: "Prem el botó per entrar a The Somnus. No necessites contrasenya: aquest enllaç és personal i només funciona una vegada.",
      cta: "Entrar a The Somnus",
      note: "Si no has demanat aquest enllaç, ignora aquest correu: ningú no podrà entrar sense accés a la teva safata d'entrada.",
    },
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
    sign_in_link: {
      subject: "Votre lien de connexion à The Somnus",
      heading: "Connectez-vous à votre compte",
      body: "Appuyez sur le bouton pour vous connecter à The Somnus. Aucun mot de passe : ce lien est personnel et ne fonctionne qu'une seule fois.",
      cta: "Se connecter à The Somnus",
      note: "Si vous n'avez pas demandé ce lien, ignorez cet e-mail : personne ne peut se connecter sans accès à votre boîte de réception.",
    },
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
