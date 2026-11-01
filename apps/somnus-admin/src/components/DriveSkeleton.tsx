import somnusWordmark from "../assets/brand/somnus-wordmark.png";
import { Skeleton } from "./ui/Skeleton.js";

const TILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/**
 * The whole Drive page while its code and the session are still arriving: the
 * header and the folder-and-files shape of the workspace, so the tab fills in
 * rather than flashing a line of text. Like the console's, it is the page --
 * `main`, the heading and the one announced status -- and the drawing is
 * decoration.
 */
export function DriveSkeleton({ message }: { message: string }) {
  return (
    <div className="flex h-screen flex-col bg-somnus-background text-somnus-text">
      <div
        aria-hidden="true"
        className="flex items-center gap-3 border-b border-white/[0.06] bg-somnus-surface px-4 py-2.5"
      >
        <img src={somnusWordmark} width={720} height={82} alt="" className="h-4 w-auto" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <span className="flex-1" />
        <Skeleton className="hidden h-4 w-40 sm:block" />
        <Skeleton className="h-8 w-28" />
      </div>
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1">
        <aside
          aria-hidden="true"
          className="hidden w-64 shrink-0 flex-col gap-2 border-r border-white/[0.06] p-3 md:flex"
        >
          <Skeleton className="h-9 w-full" />
          <Skeleton className="mt-3 h-2.5 w-28" />
          {["a", "b", "c", "d"].map((id) => (
            <div key={id} className="flex items-center gap-3 px-2 py-1.5">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1 p-6">
          <div role="status" aria-live="polite" aria-busy="true">
            <h1 className="sr-only">{message}</h1>
          </div>
          <div aria-hidden="true" className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-48" />
              <span className="flex-1" />
              <Skeleton className="h-9 w-28" />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {TILES.map((id) => (
                <div
                  key={id}
                  className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-4"
                >
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
