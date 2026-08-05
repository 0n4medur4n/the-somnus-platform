import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { AuthLayout } from "../layouts/AuthLayout.js";

export function NotFound() {
  const { t } = useTranslation();
  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-somnus-subtle">{t("notFound.description")}</p>
      <Link to="/app" className="text-somnus-primary underline">
        {t("notFound.back")}
      </Link>
    </AuthLayout>
  );
}
