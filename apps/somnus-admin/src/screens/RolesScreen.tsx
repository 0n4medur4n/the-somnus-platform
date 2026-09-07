import { INTERNAL_ROLE_KEYS, ROLE_KEYS, type RoleKey } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { SelectField } from "../components/SelectField.js";
import { edge } from "../lib/edge.js";
import { useAdminAction } from "./useAdminAction.js";

const ASSIGNABLE: RoleKey[] = ROLE_KEYS.filter((key) => INTERNAL_ROLE_KEYS.has(key));

/**
 * Internal role assignment (Addendum A Checkpoint 15.2, capability
 * `admin_roles_assign`). §A2.2 gives it to `platform_super_admin` and to no one
 * else, so this screen is only ever mounted when the server said so.
 *
 * Only internal roles are offered. External roles are earned -- by registering,
 * by being verified, by accepting an invitation -- and there is no screen that
 * hands one out.
 *
 * The server refuses self-assignment (the immutable negative from Checkpoint
 * 6.3, extended to the admin routes). The screen states that up front rather
 * than letting someone discover it as a 403.
 */
export function RolesScreen({ actingAdminUserId }: { actingAdminUserId: string }) {
  const { t } = useTranslation();
  const { run, busy, error, notice } = useAdminAction();
  const [targetUserId, setTargetUserId] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey | "">("");

  const isSelf = targetUserId.trim() === actingAdminUserId;
  const ready = targetUserId.trim().length > 0 && roleKey !== "" && !isSelf;

  async function assign() {
    // TypeScript narrows roleKey through `ready`, which already excludes "".
    if (!ready) return;
    const assigned = await run(
      () => edge.assignRole({ targetUserId: targetUserId.trim(), roleKey }),
      "roles.assigned",
    );
    if (assigned) {
      setTargetUserId("");
      setRoleKey("");
    }
  }

  return (
    <section aria-labelledby="roles-heading" className="flex flex-col gap-4">
      <h2 id="roles-heading" className="text-xl font-semibold text-somnus-text">
        {t("roles.title")}
      </h2>
      <p className="text-sm text-somnus-subtle">{t("roles.intro")}</p>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void assign();
        }}
      >
        <Field
          id="role-target"
          label={t("roles.targetLabel")}
          hint={t("roles.targetHint")}
          value={targetUserId}
          onChange={(event) => setTargetUserId(event.target.value)}
        />
        <SelectField
          id="role-key"
          label={t("roles.roleLabel")}
          placeholder={t("roles.roleLabel")}
          value={roleKey}
          options={ASSIGNABLE.map((key) => ({ value: key, label: t(`role.${key}`) }))}
          onChange={(event) => setRoleKey(event.target.value as RoleKey)}
        />

        {isSelf ? (
          <p role="alert" className="text-somnus-danger">
            {t("roles.noSelfAssign")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-somnus-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" aria-live="polite" className="text-somnus-success">
            {notice}
          </p>
        ) : null}

        <Button type="submit" disabled={busy || !ready}>
          {t("roles.assign")}
        </Button>
      </form>
    </section>
  );
}
