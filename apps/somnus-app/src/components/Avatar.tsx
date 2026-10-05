import type { MeResponse } from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";
import { edge } from "../lib/edge.js";

function initialsOf(me: MeResponse): string {
  const first = me.individualProfile?.firstName.trim()[0] ?? me.user.email[0] ?? "";
  const last = me.individualProfile?.lastName.trim()[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

/**
 * The person's photo, or their initials when there is none (or it fails to
 * load). The photo URL carries its change time, so a new photo shows at once.
 */
export function Avatar({ me, className }: { me: MeResponse; className?: string }) {
  const { t } = useTranslation();
  const version = me.individualProfile?.photoUpdatedAt;
  const [failed, setFailed] = useState<string | null>(null);
  const base = "flex shrink-0 items-center justify-center overflow-hidden rounded-full";

  if (version && failed !== version) {
    return (
      <img
        src={edge.photoUrl(version)}
        alt={t("profile.photoAlt")}
        onError={() => setFailed(version)}
        className={twMerge(base, "object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={twMerge(
        base,
        "bg-somnus-primary-strong font-semibold text-white select-none",
        className,
      )}
    >
      {initialsOf(me)}
    </span>
  );
}
