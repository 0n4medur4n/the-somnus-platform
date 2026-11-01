import type { ReactNode } from "react";

/**
 * Placeholders for what is still loading, in the shape of what will appear.
 *
 * They are decoration: a screen reader gets the one status message of the region
 * that holds them (`LoadingRegion`), never a list of empty boxes. The shimmer is
 * switched off by the reduced-motion rule in index.css, and the tint follows the
 * theme (dark, light, high contrast).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`somnus-skeleton ${className}`} />;
}

const LINES = ["a", "b", "c", "d", "e", "f"] as const;

/** Text-like bars, the last one shorter. */
export function SkeletonLines({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  const shown = LINES.slice(0, Math.min(lines, LINES.length));
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2.5 ${className}`}>
      {shown.map((id, index) => (
        <Skeleton
          key={id}
          className={`h-3.5 ${index === shown.length - 1 && shown.length > 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/**
 * A region that is loading: announced once, politely, as a status; the
 * placeholder shapes inside it are hidden from assistive technology.
 */
export function LoadingRegion({
  message,
  className = "",
  children,
}: {
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{message}</span>
      <div aria-hidden="true" className={className}>
        {children}
      </div>
    </div>
  );
}

/** A surface-coloured card holding placeholder rows, like the cards of the screens. */
export function SkeletonCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-somnus-muted/30 bg-somnus-surface/40 p-5">
      {children}
    </div>
  );
}

const CARDS = ["a", "b", "c", "d"] as const;

/** A page's worth of cards while its data arrives; `title` adds a heading bar above them. */
export function CardsSkeleton({
  message,
  cards = 3,
  title = false,
}: {
  message: string;
  cards?: number;
  title?: boolean;
}) {
  return (
    <LoadingRegion message={message} className="flex flex-col gap-4">
      {title ? <Skeleton className="h-8 w-56" /> : null}
      {CARDS.slice(0, Math.min(cards, CARDS.length)).map((id) => (
        <SkeletonCard key={id}>
          <Skeleton className="h-5 w-1/3" />
          <SkeletonLines lines={2} />
        </SkeletonCard>
      ))}
    </LoadingRegion>
  );
}
