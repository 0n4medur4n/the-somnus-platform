import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/useAuth.js";

export function AppHome() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const firstName =
    state.status === "authenticated" ? state.me.individualProfile?.firstName : undefined;

  return (
    <section aria-labelledby="home-heading" className="flex flex-col gap-3">
      <h1 id="home-heading" className="text-2xl font-semibold">
        {t("app.homeTitle")}
      </h1>
      <p className="text-somnus-text">
        {firstName ? t("app.welcome", { name: firstName }) : t("app.welcomeNoName")}
      </p>
    </section>
  );
}
