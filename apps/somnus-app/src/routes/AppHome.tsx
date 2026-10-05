import { useTranslation } from "react-i18next";
import { accountViewOf } from "../auth/account-view.js";
import { useAuth } from "../auth/useAuth.js";
import { MorpheoHome } from "./MorpheoHome.js";

export function AppHome() {
  const { state } = useAuth();
  if (state.status === "authenticated" && accountViewOf(state.me).isMorpheoUser) {
    return <MorpheoHome />;
  }
  return <GeneralHome />;
}

/** The home of everyone who is not a Morpheo user (professionals, organizations). */
function GeneralHome() {
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
