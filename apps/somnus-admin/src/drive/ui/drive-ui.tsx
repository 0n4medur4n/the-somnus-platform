import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "../../lib/api.js";
import { DriveCryptoError } from "../crypto.js";
import { DriveSessionError, type Trust } from "../drive-session.js";

/** Turns anything the Drive can throw into a sentence for the person using it. */
export function driveErrorMessage(t: TFunction, error: unknown): string {
  if (error instanceof DriveCryptoError) return t(`drive.problem.${error.failure}`);
  if (error instanceof DriveSessionError) return t(`drive.errors.${error.reason}`);
  if (error instanceof ApiRequestError) {
    if (error.reason && t(`drive.errors.${error.reason}`, { defaultValue: "" }) !== "") {
      return t(`drive.errors.${error.reason}`);
    }
    if (error.status === 403) return t("errors.forbidden");
    if (error.status === 409) return t("errors.conflict");
    if (error.status === 404) return t("errors.notFound");
  }
  return t("errors.generic");
}

/** Runs one Drive operation with a busy flag and a translated error. */
export function useDriveTask() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await operation();
      } catch (caught) {
        setError(driveErrorMessage(t, caught));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );
  return { run, busy, error, setError };
}

export function formatBytes(bytes: number, locale: string): string {
  const units = ["byte", "kilobyte", "megabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Hands the person a decrypted file. Always as `application/octet-stream` with
 * a download name: a decrypted HTML or SVG opened from a blob URL would run in
 * the console's own origin, so nothing decrypted is ever navigated to.
 */
export function saveBytes(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Raster images only: an SVG can carry script, so it is downloaded, never shown. */
export const PREVIEWABLE_IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function isTextual(mime: string | undefined): boolean {
  return mime === "text/plain" || mime === "text/markdown" || mime === "text/csv";
}

const TRUST_STYLE: Record<Trust, string> = {
  self: "border-somnus-subtle/30 text-somnus-subtle",
  verified: "border-somnus-success/50 text-somnus-success",
  known: "border-somnus-subtle/30 text-somnus-subtle",
  changed: "border-somnus-danger/60 text-somnus-danger",
  unknown: "border-somnus-danger/40 text-somnus-danger",
};

export function TrustBadge({ trust }: { trust: Trust }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${TRUST_STYLE[trust]}`}>
      {t(`drive.trust.${trust}`)}
    </span>
  );
}

export function Fingerprint({ value }: { value: string }) {
  return (
    <code className="block rounded-md bg-somnus-background px-3 py-2 font-mono text-sm tracking-wide text-somnus-text">
      {value}
    </code>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "info" | "danger" | "success";
  children: string;
}) {
  const style =
    tone === "danger"
      ? "border-somnus-danger/50 bg-somnus-danger/10 text-somnus-danger"
      : tone === "success"
        ? "border-somnus-success/40 bg-somnus-success/10 text-somnus-success"
        : "border-somnus-subtle/25 bg-somnus-surface text-somnus-subtle";
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-md border p-3 text-sm ${style}`}
    >
      {children}
    </p>
  );
}

/** A passphrase's rough strength. A hint for the person, not a security control. */
export function passphraseStrength(value: string): "weak" | "fair" | "strong" {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (value.length >= 20 || (value.length >= 14 && classes >= 3)) return "strong";
  if (value.length >= 12) return "fair";
  return "weak";
}

export const MIN_PASSPHRASE_LENGTH = 12;

export function KindIcon({ kind }: { kind: "folder" | "note" | "file" }) {
  const paths: Record<typeof kind, string> = {
    folder:
      "M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h7A1.5 1.5 0 0 1 19 8.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 16.5z",
    note: "M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 7h8M8 13h8M8 16h5",
    file: "M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm8 0v5h5",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 22 22"
      className={`h-5 w-5 shrink-0 ${kind === "folder" ? "text-somnus-primary" : "text-somnus-subtle"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="4" y="9" width="12" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}
