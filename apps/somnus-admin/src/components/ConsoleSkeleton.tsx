import somnusWordmark from "../assets/brand/somnus-wordmark.png";
import { Skeleton } from "./ui/Skeleton.js";

/**
 * The whole page while the console is finding out who is signing in: the shell
 * the person is about to get (sidebar, header, a dashboard), so that a reload
 * fills in instead of jumping from a line of text to the full layout.
 *
 * Like `FullPageStatus` it is the page: it carries the `main` landmark and the
 * level-one heading, and announces the message once. The drawn shell is
 * decoration, hidden from assistive technology.
 */
export function ConsoleSkeleton({ message }: { message: string }) {
  return (
    <div className="min-h-dvh bg-somnus-background">
      <aside
        aria-hidden="true"
        className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-white/[0.06] bg-[#0b1122] lg:block"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 px-5 pb-4 pt-5">
            <img src={somnusWordmark} width={720} height={82} alt="" className="h-5 w-auto" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex flex-1 flex-col gap-5 px-3 pt-1">
            {[3, 4, 3].map((rows, group) => (
              <div key={group} className="flex flex-col gap-2">
                <Skeleton className="mx-3 h-2.5 w-20" />
                {Array.from({ length: rows }, (_, row) => `${group}-${row}`).map((id) => (
                  <div key={id} className="flex items-center gap-3 px-3 py-2">
                    <Skeleton className="h-[18px] w-[18px] shrink-0" />
                    <Skeleton className="h-3 flex-1" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-white/[0.06] p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
            <Skeleton className="mt-3 h-9 w-full" />
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <div
          aria-hidden="true"
          className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.06] bg-somnus-background/85 px-4 py-3 sm:px-8"
        >
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-44" />
          </div>
        </div>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8">
          <div role="status" aria-live="polite" aria-busy="true">
            <h1 className="sr-only">{message}</h1>
          </div>
          <div aria-hidden="true" className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {["a", "b", "c", "d"].map((id) => (
                <div
                  key={id}
                  className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-4"
                >
                  <Skeleton className="h-10 w-10 shrink-0" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-6 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-5 xl:col-span-2">
                <Skeleton className="mb-5 h-4 w-40" />
                <Skeleton className="h-40 w-full" />
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-5">
                <Skeleton className="mb-5 h-4 w-32" />
                <div className="flex flex-col gap-3">
                  {["a", "b", "c", "d"].map((id) => (
                    <Skeleton key={id} className="h-4 w-full" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
