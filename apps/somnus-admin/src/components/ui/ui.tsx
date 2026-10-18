import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";
import { Icon, type IconName } from "./Icon.js";

/**
 * The console's building blocks: surfaces, figures and overlays in one place,
 * on the brand tokens (build plan §4), so every screen reads as one product.
 */

export function Card({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  return (
    <Tag
      {...rest}
      className={twMerge(
        "rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  id,
  children,
  action,
}: {
  id?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="text-base font-semibold text-somnus-text">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * One headline number. `tone` colours only the icon chip -- the number stays
 * in text ink, so meaning never rests on colour alone.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: IconName;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
  onClick?: () => void;
}) {
  const chip = {
    neutral: "bg-white/5 text-somnus-subtle",
    primary: "bg-somnus-primary/15 text-somnus-primary",
    success: "bg-somnus-success/15 text-somnus-success",
    warning: "bg-amber-400/15 text-amber-300",
    danger: "bg-somnus-danger/15 text-somnus-danger",
  }[tone];
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${chip}`}>
        <Icon name={icon} />
      </span>
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate text-sm text-somnus-subtle">{label}</span>
        <span className="text-2xl font-semibold tabular-nums text-somnus-text">{value}</span>
        {hint ? <span className="truncate text-xs text-somnus-subtle">{hint}</span> : null}
      </span>
    </>
  );
  const base =
    "flex items-center gap-4 rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-4";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${base} transition hover:border-somnus-primary/40 hover:bg-somnus-surface`}
    >
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
}) {
  const style = {
    neutral: "border-white/10 text-somnus-subtle",
    primary: "border-somnus-primary/40 text-somnus-primary",
    success: "border-somnus-success/40 text-somnus-success",
    warning: "border-amber-400/40 text-amber-300",
    danger: "border-somnus-danger/50 text-somnus-danger",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-somnus-primary/10 text-somnus-primary">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <p className="font-medium text-somnus-text">{title}</p>
      {children ? <div className="max-w-md text-sm text-somnus-subtle">{children}</div> : null}
    </div>
  );
}

/** An icon-only control. The name is required: an icon is not a label. */
export function IconButton({
  icon,
  label,
  onClick,
  active,
  className,
  ...rest
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      aria-pressed={active}
      {...rest}
      className={twMerge(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-somnus-subtle transition hover:bg-white/5 hover:text-somnus-text",
        active ? "bg-somnus-primary/15 text-somnus-primary" : "",
        className,
      )}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
    </button>
  );
}

/**
 * A modal dialog: labelled, Escape closes it, focus moves in on open and back
 * to where it was on close, and the page behind cannot be tabbed into.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = panel.current?.querySelector<HTMLElement>(
      "input, textarea, select, button:not([data-close])",
    );
    (focusable ?? panel.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = [
      ...panel.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex='-1'])",
      ),
    ];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#0f1528] shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
          <h2 id={titleId} className="truncate text-lg font-semibold text-somnus-text">
            {title}
          </h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label={t("ui.close")}
            className="rounded-lg p-1.5 text-somnus-subtle hover:bg-white/5 hover:text-somnus-text"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export type MenuItem = {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * A dropdown menu on a trigger: arrow keys move, Escape closes and returns
 * focus, a click outside closes. Items are real buttons.
 */
export function Menu({
  label,
  items,
  trigger,
  align = "right",
}: {
  label: string;
  items: MenuItem[];
  trigger?: (props: { onClick: () => void; expanded: boolean }) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function onKeyDown(event: ReactKeyboardEvent) {
    if (!open) return;
    const buttons = [
      ...(list.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    }
  }

  const toggle = () => setOpen((o) => !o);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard handling for the menu it wraps
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      {trigger ? (
        trigger({ onClick: toggle, expanded: open })
      ) : (
        <IconButton
          icon="more"
          label={label}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
        />
      )}
      {open ? (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={`absolute z-40 mt-1 min-w-52 overflow-hidden rounded-xl border border-white/10 bg-[#111a31] py-1 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-white/5 focus:bg-white/5 focus:outline-none disabled:opacity-40 ${item.danger ? "text-somnus-danger" : "text-somnus-text"}`}
            >
              <Icon name={item.icon} className="h-4 w-4 opacity-80" />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
