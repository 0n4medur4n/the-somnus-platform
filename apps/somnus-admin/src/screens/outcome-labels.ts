import { useTranslation } from "react-i18next";

/**
 * Console names for Morpheo's outcome codes (ADR 0024): the main actions of the
 * priority order (EMERGENCIA … SIN_ORIENTACION) and the final-text templates
 * (T_INSOMNIO, T_PIERNAS…), named after the template titles of the embudo v0.2
 * (pp. 11-12). A code the console does not know yet is shown as the code: a
 * new outcome must never disappear from a count or a case.
 */
export function useOutcomeLabels() {
  const { t } = useTranslation();
  return {
    mainAction: (code: string) => t(`outcome.mainAction.${code}`, { defaultValue: code }),
    template: (code: string) => t(`outcome.template.${code}`, { defaultValue: code }),
  };
}
