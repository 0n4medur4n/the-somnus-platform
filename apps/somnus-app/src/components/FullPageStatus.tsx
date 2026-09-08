/**
 * A full-page status screen (loading / verifying). It is the whole page
 * while it is on screen -- rendered instead of AppLayout by RequireAuth,
 * and instead of the registration form by AuthCallback -- so it carries
 * the page's own `main` landmark and level-one heading, not just a status
 * region (build plan §20 9.1 a11y baseline: landmarks, headings). Without
 * them, a user who lands here on a slow connection gets a page axe rightly
 * reports as having no main landmark and no h1.
 *
 * role="status" + aria-live="polite" sits on the wrapper so the message is
 * announced without stealing focus, and is announced once rather than twice.
 */
export function FullPageStatus({ message }: { message: string }) {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh items-center justify-center p-6">
      <div role="status" aria-live="polite">
        <h1 className="text-base font-normal text-somnus-subtle">{message}</h1>
      </div>
    </main>
  );
}
