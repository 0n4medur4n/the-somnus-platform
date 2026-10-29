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
  // Document editor (owner decision 2026-10-19).
  bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z",
  italic: "M10 5h8M6 19h8M14 5l-4 14",
  underline: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
  strike:
    "M5 12h14M16 7.5C15.4 5.9 13.9 5 12 5c-2.5 0-4 1.4-4 3.2M8.3 16c.6 1.8 2 3 3.9 3 2.5 0 4-1.4 4-3.3",
  listBullet: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  listOrdered: "M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c0-1 2.5-1 2.5.5L4 18h3",
  quote: "M7 11h4v6H5v-4c0-3 1-5 4-6M17 11h4v6h-6v-4c0-3 1-5 4-6",
  code: "M9 8l-4 4 4 4m6-8l4 4-4 4",
  alignLeft: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignCenter: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignRight: "M4 6h16M10 10h10M4 14h16M10 18h10",
  alignJustify: "M4 6h16M4 10h16M4 14h16M4 18h16",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  minus: "M5 12h14",
  document: "M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  arrowLeft: "M19 12H5m6-6l-6 6 6 6",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  // Drive appearance and links (owner decision 2026-10-29).
  palette:
    "M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01",
  // Drive item icons (owner decision 2026-10-29: icons, not emoji).
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  pin: "M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21zm0-8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  bookmark: "M7 4h10v17l-5-4-5 4z",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-4-9l2.8 2.8L16 9.5",
  clipboard:
    "M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M9 12h6M9 16h4",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 14h9",
  stethoscope:
    "M6 3v5a4 4 0 0 0 8 0V3M10 12v3a5 5 0 0 0 10 0v-2M22 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  pill: "M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7zM8.5 8.5l7 7",
  brain:
    "M12 5a3 3 0 0 0-5.6-1.5A3 3 0 0 0 4 8a3 3 0 0 0 0 5 3 3 0 0 0 2.4 4.5A3 3 0 0 0 12 19zm0 0a3 3 0 0 1 5.6-1.5A3 3 0 0 1 20 8a3 3 0 0 1 0 5 3 3 0 0 1-2.4 4.5A3 3 0 0 1 12 19",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  bed: "M3 7v13M3 16h18v4M21 16v-3a3 3 0 0 0-3-3h-8v6M7 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4m6-4v4",
  lightbulb:
    "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  scale: "M12 4v16M8 20h8M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z",
  euro: "M17 6.5A7 7 0 1 0 17 17.5M4 10h9M4 14h9",
  wrench:
    "M15 4a4 4 0 0 0-3.8 5.2L4 16.4A2.1 2.1 0 0 0 7 19.4l7.2-7.2A4 4 0 0 0 20 9l-2.5 2.5-2.5-.5-.5-2.5z",
  rocket:
    "M12 15l-3-3c1-4 4-8 10-8 0 6-4 9-8 10zM9 12H5l2-3h4M12 15v4l3-2v-4M7 17c-1.5 1-2 3-2 3s2-.5 3-2",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  tag: "M3 12V4h8l9 9-8 8zM7.5 8.5h.01",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  mail: "M4 6h16v12H4zm0 0l8 6 8-6",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  briefcase: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
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
