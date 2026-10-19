import type { AdminUserDetail } from "@somnus/api-contracts";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

export function UserMetadata({ detail }: { detail: AdminUserDetail }) {
  const { t, i18n } = useTranslation();
  const person = detail.individualProfile;
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(value),
    );
  const rows = [
    ["id", detail.user.id],
    ["name", person ? `${person.firstName} ${person.lastName}` : null],
    ["type", person?.registrationRole ? t(`metadata.role.${person.registrationRole}`) : null],
    ["locale", t(`staff.locale.${detail.user.locale}`)],
    ["created", date(detail.user.createdAt)],
    ["updated", detail.updatedAt ? date(detail.updatedAt) : null],
    ["dateOfBirth", person?.dateOfBirth ? date(person.dateOfBirth) : null],
    ["phone", person?.phone],
    ["country", person?.country],
    ["city", person?.city],
    ["gender", person?.gender ? t(`metadata.genderValue.${person.gender}`) : null],
    ["license", detail.professionalProfile?.licenseNumber],
  ];
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 break-words text-sm">
        {rows.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="text-somnus-subtle">{t(`metadata.${key}`)}</dt>
            <dd>{value || t("metadata.missing")}</dd>
          </Fragment>
        ))}
      </dl>
      <h4 className="font-semibold">{t("metadata.roles")}</h4>
      {detail.roleAssignments?.length ? (
        <ul>
          {detail.roleAssignments.map((assignment) => (
            <li key={`${assignment.roleKey}:${assignment.organizationId ?? "platform"}`}>
              {t(`role.${assignment.roleKey}`)} ·{" "}
              {assignment.organizationId
                ? (detail.organizations?.find((o) => o.id === assignment.organizationId)?.name ??
                  assignment.organizationId)
                : t("metadata.platform")}{" "}
              · {date(assignment.assignedAt)}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("users.none")}</p>
      )}
      <h4 className="font-semibold">{t("users.organizations")}</h4>
      {detail.organizations?.length ? (
        <ul>
          {detail.organizations.map((org) => (
            <li key={org.id}>
              {org.name} · {t(`status.${org.status}`)} ·{" "}
              {t(`metadata.membership.${org.membershipStatus}`)}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("users.none")}</p>
      )}
      <p className="text-sm text-somnus-subtle">{t("metadata.productNotice")}</p>
    </>
  );
}
