import { BrandLogo } from "./BrandLogo.js";
import { Skeleton, SkeletonCard, SkeletonLines } from "./Skeleton.js";

/**
 * The whole page while the app finds out whether there is a session: the shell
 * the person is about to get (header, menu, a page of cards), so that a reload
 * fills in instead of jumping from a line of text to the full layout.
 *
 * Like `FullPageStatus` it is the page: it carries the `main` landmark and the
 * level-one heading, and announces the message once. The drawn shell is
 * decoration, hidden from assistive technology. The shape is the Morpheo
 * space's; a professional's wider layout fills in from it.
 */
export function PageSkeleton({ message }: { message: string }) {
  return (
    <div className="min-h-dvh">
      <div aria-hidden="true" className="border-b border-somnus-muted/20">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 p-4 sm:gap-4">
          <BrandLogo brand="somnus" className="h-5 w-auto" />
          <div className="flex items-center gap-2 sm:gap-4">
            <Skeleton className="hidden h-9 w-9 rounded-full sm:block" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="mx-auto flex max-w-4xl gap-1 px-4 pb-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <main id="main" tabIndex={-1} className="mx-auto max-w-4xl p-4">
        <div role="status" aria-live="polite" aria-busy="true">
          <h1 className="sr-only">{message}</h1>
        </div>
        <div aria-hidden="true" className="flex flex-col gap-5">
          <Skeleton className="h-8 w-56" />
          <SkeletonCard>
            <Skeleton className="h-5 w-1/3" />
            <SkeletonLines lines={3} />
          </SkeletonCard>
          <SkeletonCard>
            <Skeleton className="h-5 w-2/5" />
            <SkeletonLines lines={2} />
            <Skeleton className="h-10 w-40" />
          </SkeletonCard>
        </div>
      </main>
    </div>
  );
}
