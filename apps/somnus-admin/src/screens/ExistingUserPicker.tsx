import type { AdminUserSummary } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { edge } from "../lib/edge.js";

/** Account metadata only; authorization and role assignment remain server decisions. */
export function ExistingUserPicker({
  id,
  label,
  hint,
  excludedUserId,
  onQueryChange,
  onSelect,
}: {
  id: string;
  label: string;
  hint?: string;
  excludedUserId?: string;
  onQueryChange?: (query: string) => void;
  onSelect: (user: AdminUserSummary) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await edge.searchUsers({ email: query.trim(), status: "active", limit: 25 });
      setResults(response.users.filter((user) => user.status === "active"));
      setTruncated(response.truncated);
    } catch {
      setFailed(true);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field
            id={id}
            label={label}
            {...(hint ? { hint } : {})}
            value={query}
            maxLength={320}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults(null);
              onQueryChange?.(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
        </div>
        <Button type="button" disabled={busy || !query.trim()} onClick={() => void search()}>
          {t("users.searchCta")}
        </Button>
      </div>
      {failed ? <p role="alert">{t("errors.generic")}</p> : null}
      {truncated && results ? <p>{t("users.truncated")}</p> : null}
      {results?.length === 0 ? <p role="status">{t("userPicker.empty")}</p> : null}
      {results?.length ? (
        <ul className="flex flex-col gap-2">
          {results.map((user) => (
            <li key={user.id}>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || user.id === excludedUserId}
                onClick={() => {
                  setBusy(true);
                  setFailed(false);
                  void (async () => {
                    try {
                      await onSelect(user);
                      setQuery(user.email);
                      setResults(null);
                    } catch {
                      setFailed(true);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {t("userPicker.choose", { email: user.email })}
              </Button>
              {user.id === excludedUserId ? (
                <span className="ml-2 text-sm text-somnus-subtle">{t("roles.noSelfAssign")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
