import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { edge } from "../lib/edge.js";
import { useActiveOrg } from "../org/OrgContext.js";

export function OrganizationMembers() {
  const { t } = useTranslation();
  const { activeOrg } = useActiveOrg();

  const membersQuery = useQuery({
    queryKey: ["members", activeOrg?.id],
    queryFn: () => edge.listMembers(activeOrg?.id ?? ""),
    enabled: activeOrg !== null,
  });

  return (
    <section aria-labelledby="members-heading" className="flex max-w-2xl flex-col gap-4">
      <h1 id="members-heading" className="text-2xl font-semibold">
        {t("organization.membersTitle")}
      </h1>

      {activeOrg === null ? (
        <p className="text-somnus-muted">
          <Link to="/organization" className="text-somnus-primary underline">
            {t("organization.title")}
          </Link>
        </p>
      ) : membersQuery.isLoading ? (
        <p role="status" aria-live="polite" className="text-somnus-muted">
          {t("common.loading")}
        </p>
      ) : membersQuery.data && membersQuery.data.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="member-list">
          {membersQuery.data.map((member) => (
            <li key={member.id} className="rounded-md bg-somnus-surface px-3 py-2">
              {member.userId}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-somnus-muted">{t("organization.membersEmpty")}</p>
      )}
    </section>
  );
}
