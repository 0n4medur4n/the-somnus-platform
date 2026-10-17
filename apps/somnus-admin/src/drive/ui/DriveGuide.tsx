import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";

const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;

/** The usage instructions, always one click away inside the Drive. */
export function DriveGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="drive-guide-heading"
      className="flex flex-col gap-4 rounded-lg border border-somnus-primary/30 bg-somnus-surface p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="drive-guide-heading" className="text-lg font-semibold text-somnus-text">
          {t("drive.guideContent.heading")}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          {t("drive.closeGuide")}
        </Button>
      </div>
      {SECTIONS.map((id) => (
        <div key={id} className="flex flex-col gap-1">
          <h3 className="font-medium text-somnus-text">{t(`drive.guideContent.${id}Title`)}</h3>
          <p className="text-sm text-somnus-subtle">{t(`drive.guideContent.${id}Body`)}</p>
        </div>
      ))}
    </section>
  );
}
