/**
 * The console's icon set: 24px stroke icons drawn here, so the console carries
 * no icon dependency. Decorative by default (aria-hidden); a control that is
 * only an icon gets its name from `aria-label` on the control, never from here.
 */
const PATHS = {
  dashboard: "M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-9h6V4h-6z",
  users:
    "M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3 3 0 0 1 0 5.8",
  verify: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6zm-3 9l2 2 4-4",
  userX:
    "M15 19v-1.5A3.5 3.5 0 0 0 11.5 14h-5A3.5 3.5 0 0 0 3 17.5V19M9 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 8l4 4m0-4l-4 4",
  key: "M15.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM12 12v8m0-3h3m-3-2h2",
  building:
    "M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15m0-9h5a1 1 0 0 1 1 1v8M3 20h18M8 8h2m-2 4h2m-2 4h2",
  sparkles:
    "M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z",
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zm0 15A1.5 1.5 0 0 0 6.5 21H19",
  library: "M4 20h16M6 17V8m4 9V8m4 9V8m4 9V8M3 8l9-5 9 5z",
  scroll:
    "M8 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2h12M8 4a2 2 0 0 0-2 2v10M10 9h6m-6 3h6",
  siren: "M7 18v-6a5 5 0 0 1 10 0v6M5 18h14v3H5zM12 3V1m7.8 3.2 1.4-1.4M4.2 4.2 2.8 2.8",
  chart: "M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6",
  drive:
    "M4 15h16l-2.4-8.4A2 2 0 0 0 15.7 5H8.3a2 2 0 0 0-1.9 1.6zm0 0v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M7 18h.01",
  lock: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4m4 4H4",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  download: "M12 4v12m0 0l-4-4m4 4l4-4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  folderShared:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm9 9v-.5a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v.5m-2.5-5.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z",
  folderPlus:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm9 3v5m-2.5-2.5h5",
  file: "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 0v5h5",
  note: "M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 0v5h5M9 13h6m-6 4h4",
  image:
    "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 13l4.5-5 3 3.5 2.5-2.5L20 17M15.5 9.5h.01",
  grid: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4-4",
  more: "M12 5.5h.01M12 12h.01M12 18.5h.01",
  pencil: "M4 20h4L19 9l-4-4L4 16zm9-13l4 4",
  move: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm7 6h6m-2-2 2 2-2 2",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  restore: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5v-5m0-3h.01",
  share:
    "M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5.3-10.5 2.6-1.5m-2.6 4.5 2.6 1.5",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4m-4 5a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  alert:
    "M12 9v4m0 4h.01M10.3 4.1 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4.5l3 2",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6m0 3h.01",
  fingerprint:
    "M12 11v3c0 2.5-.7 4.7-2 6.5M8.5 11a3.5 3.5 0 0 1 7 0v2c0 1.8-.3 3.5-.9 5M5.5 15c.3-1.2.5-2.6.5-4a6 6 0 0 1 10.5-4M19.2 8.5c.5.8.8 1.6.8 2.5v2c0 1.6-.2 3.1-.6 4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
