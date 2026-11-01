import type { ReactNode } from "react";

/**
 * Placeholders for what is still loading, in the shape of what will appear.
 *
 * They are decoration: a screen reader gets the one status message of the region
 * that holds them (`LoadingRegion`), never a list of empty boxes. The shimmer is
 * switched off by the reduced-motion rule in index.css.
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

/** Bars of different heights where a chart will be. */
export function ChartSkeleton({ className = "" }: { className?: string }) {
  const heights = ["h-1/3", "h-1/2", "h-2/3", "h-2/5", "h-3/4", "h-1/2", "h-3/5", "h-1/3"];
  return (
    <div aria-hidden="true" className={`flex h-40 items-end gap-3 ${className}`}>
      {heights.map((height, index) => (
        <Skeleton key={index} className={`flex-1 ${height}`} />
      ))}
    </div>
  );
}
