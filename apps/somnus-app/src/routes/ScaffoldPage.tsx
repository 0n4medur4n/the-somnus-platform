import { useTranslation } from "react-i18next";

/**
 * Accessible placeholder for routes whose full behavior lands in a
 * later phase (build plan §20 Checkpoint 9.1 is the SPA *foundation*).
 * Still semantic and localized, with the a11y baseline, so these routes
 * are navigable and screen-reader friendly today.
 */
export function ScaffoldPage({
  titleKey,
  descriptionKey,
}: {
  titleKey: string;
  descriptionKey: string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="scaffold-heading" className="flex max-w-2xl flex-col gap-3">
      <h1 id="scaffold-heading" className="text-2xl font-semibold">
        {t(titleKey)}
      </h1>
      <p className="text-somnus-subtle">{t(descriptionKey)}</p>
    </section>
  );
}

export function Security() {
  return <ScaffoldPage titleKey="security.title" descriptionKey="security.description" />;
}

export function Professional() {
  return <ScaffoldPage titleKey="professional.title" descriptionKey="professional.description" />;
}

export function ProfessionalProfile() {
  return (
    <ScaffoldPage
      titleKey="professional.profileTitle"
      descriptionKey="professional.profileDescription"
    />
  );
}
