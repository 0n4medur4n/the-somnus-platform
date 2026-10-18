import { useTranslation } from "react-i18next";

const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;

/** The usage instructions, always one click away inside the Drive. */
export function DriveGuideContent() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5">
      {SECTIONS.map((id) => (
        <section key={id} className="flex flex-col gap-1">
          <h3 className="font-medium text-somnus-text">{t(`drive.guideContent.${id}Title`)}</h3>
          <p className="text-sm leading-relaxed text-somnus-subtle">
            {t(`drive.guideContent.${id}Body`)}
          </p>
        </section>
      ))}
    </div>
  );
}
