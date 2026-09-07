import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "../lib/api.js";

/**
 * Runs one console operation and turns whatever comes back into something the
 * admin can act on.
 *
 * The mapping matters more than it looks. A 403 here does not mean "you are not
 * an admin" -- the shell already established that -- it means the server refused
 * *this* operation, which is a different sentence. A 409 means someone else
 * changed the thing while this screen was open, and the honest response is to
 * say so rather than to retry and overwrite them.
 */
export function useAdminAction() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async <T>(operation: () => Promise<T>, successKey?: string): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await operation();
        if (successKey) setNotice(t(successKey));
        return result;
      } catch (caught) {
        if (caught instanceof ApiRequestError) {
          if (caught.status === 403) setError(t("errors.forbidden"));
          else if (caught.status === 409) setError(t("errors.conflict"));
          else if (caught.status === 404) setError(t("errors.notFound"));
          else setError(t("errors.generic"));
        } else {
          setError(t("errors.generic"));
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return { run, busy, error, notice };
}
