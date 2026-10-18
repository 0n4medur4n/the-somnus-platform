import { ADMIN_USERS_OVERVIEW_WEEKS, type AdminUsersOverview } from "@somnus/api-contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `date`. */
export function weekStartUtc(date: Date): Date {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const weekday = (new Date(midnight).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(midnight - weekday * DAY_MS);
}

/** The first day the overview needs sign-ups from: the Monday of the oldest charted week. */
export function overviewSince(now: Date): Date {
  return new Date(weekStartUtc(now).getTime() - (ADMIN_USERS_OVERVIEW_WEEKS - 1) * 7 * DAY_MS);
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Turns identity's raw aggregates into the overview the console charts: zero-
 * filled weeks oldest first, rolling 7- and 30-day sign-ups, and every status
 * and registration role present even when its count is zero. Pure, so the
 * arithmetic is tested without a database.
 */
export function buildUsersOverview(input: {
  now: Date;
  byStatus: ReadonlyArray<{ status: string; total: number }>;
  byRole: ReadonlyArray<{ role: string | null; total: number }>;
  daily: ReadonlyArray<{ day: string; total: number }>;
}): AdminUsersOverview {
  const status = { active: 0, suspended: 0, deleted: 0 };
  for (const row of input.byStatus) {
    if (row.status in status) status[row.status as keyof typeof status] += Number(row.total);
  }
  const roles = { adult: 0, parent: 0, professional: 0, unknown: 0 };
  for (const row of input.byRole) {
    const key = row.role && row.role in roles ? (row.role as keyof typeof roles) : "unknown";
    roles[key] += Number(row.total);
  }

  const firstWeek = overviewSince(input.now).getTime();
  const weekly = Array.from({ length: ADMIN_USERS_OVERVIEW_WEEKS }, (_, i) => ({
    weekStart: isoDay(new Date(firstWeek + i * 7 * DAY_MS)),
    count: 0,
  }));
  const today = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  );
  let last7 = 0;
  let last30 = 0;
  for (const row of input.daily) {
    const day = Date.parse(`${row.day}T00:00:00.000Z`);
    if (Number.isNaN(day)) continue;
    const total = Number(row.total);
    const index = Math.floor((day - firstWeek) / (7 * DAY_MS));
    const week = weekly[index];
    if (week) week.count += total;
    const age = (today - day) / DAY_MS;
    if (age >= 0 && age < 7) last7 += total;
    if (age >= 0 && age < 30) last30 += total;
  }

  return {
    total: status.active + status.suspended + status.deleted,
    byStatus: status,
    byRegistrationRole: roles,
    newLast7Days: last7,
    newLast30Days: last30,
    weekly,
    generatedAt: input.now.toISOString(),
  };
}
