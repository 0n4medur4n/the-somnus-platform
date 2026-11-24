import { useTranslation } from "react-i18next";

/**
 * The session died while the text was still only in this tab.
 * Sign-in is an email link, so it happens in another tab. This one stays open.
 */
export function SessionExpiredNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-somnus-danger/40 bg-somnus-danger/10 px-4 py-2 text-sm text-somnus-danger"
    >
      <p className="min-w-0 flex-1">{t("drive.sessionExpired")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-somnus-danger/40 px-3 py-1 text-sm font-medium text-somnus-text hover:bg-white/5"
      >
        {t("drive.sessionExpiredRetry")}
      </button>
    </div>
  );
}
